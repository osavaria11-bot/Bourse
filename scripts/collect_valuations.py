#!/usr/bin/env python3
"""Archive observed forward valuations. Never backcast today's consensus into history."""
import argparse
import calendar
import concurrent.futures
from datetime import date, datetime, timedelta, timezone
from html.parser import HTMLParser
import json
import math
from pathlib import Path
import re
import time
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
HOST = "https://www.marketscreener.com"
MONTHS = {name.lower(): i for i, name in enumerate(calendar.month_name) if name}
TORONTO = ZoneInfo("America/Toronto")


class SourceError(ValueError):
    pass


class Tables(HTMLParser):
    """Small HTML table projection; ignores superscript footnote numbers."""
    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.tables = {}
        self.units = {}
        self.table = None
        self.row = None
        self.cell = None
        self.skip = 0
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "table":
            self.table = a.get("id", "")
            self.tables.setdefault(self.table, [])
        elif tag == "tr" and self.table is not None:
            self.row = []
        elif tag in ("td", "th") and self.row is not None:
            self.cell = {"text": "", "attrs": a, "links": []}
        elif tag == "sup" and self.cell is not None:
            self.skip += 1
        elif tag == "a" and self.cell is not None:
            self.cell["links"].append(a.get("href", ""))
        if self.table is not None and re.fullmatch(r"[A-Z]{3}(?: in [A-Za-z]+)?", a.get("title", "")):
            self.units.setdefault(self.table, set()).add(a["title"])

    def handle_data(self, value):
        if self.cell is not None and not self.skip:
            self.cell["text"] += value + " "

    def handle_endtag(self, tag):
        if tag == "sup":
            self.skip = max(0, self.skip - 1)
        elif tag in ("td", "th") and self.cell is not None:
            self.cell["text"] = " ".join(self.cell["text"].split())
            self.row.append(self.cell)
            self.cell = None
        elif tag == "tr" and self.row is not None:
            self.tables[self.table].append(self.row)
            self.row = None
        elif tag == "table":
            self.table = None


def number(value):
    if not isinstance(value, str) or not re.fullmatch(r"[+\-−]?[\d,]+(?:\.\d+)?(?:x|%)?", value.strip()):
        return None
    n = float(value.strip().rstrip("x%").replace(",", "").replace("−", "-"))
    return n if math.isfinite(n) else None


def read(path, fallback=None):
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, ValueError):
        return fallback


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n")
    temp.replace(path)


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Referer": HOST + "/"})
    with urllib.request.urlopen(request, timeout=25) as response:
        body = response.read(5_000_001)
    if len(body) > 5_000_000:
        raise SourceError("Réponse trop volumineuse")
    return body.decode("utf-8-sig")


def resolve(instrument, old=None):
    if old and re.fullmatch(r"https://www\.marketscreener\.com/quote/stock/[A-Z0-9_-]+-\d+/valuation/", old):
        return old
    symbol = instrument["symbol"].split(".")[0]
    query = symbol
    wanted_currency = instrument.get("source_currency", "CAD" if instrument["symbol"].endswith((".TO", ".NE")) else "USD")
    rows = Tables(fetch(HOST + "/search/?q=" + urllib.parse.quote(query))).tables.get("instrumentSearchTable", [])
    matches = []
    for row in rows:
        if len(row) < 7 or row[2]["text"] != symbol or row[-1]["text"] != "Stock" or not row[5]["text"].endswith(wanted_currency):
            continue
        links = [link for cell in row[:2] for link in cell["links"] if re.fullmatch(r"/quote/stock/[A-Z0-9_-]+-\d+/", link)]
        if links:
            matches.append(links[0])
    if len(set(matches)) != 1:
        raise SourceError("Cotation et société à rapprocher dans la source")
    return HOST + matches[0] + "valuation/"


def table_snapshot(source, instrument, source_url, now):
    parsed = Tables(source)
    table = parsed.tables.get("valuationEnterpriseTable", [])
    if len(table) < 5:
        raise SourceError("Table de consensus absente ou accès limité")
    heading = table[0]
    month = re.fullmatch(r"Fiscal Period: ([A-Za-z]+)", heading[0]["text"])
    if not month or month[1].lower() not in MONTHS:
        raise SourceError("Fin d’exercice non identifiée")
    fiscal_month = MONTHS[month[1].lower()]
    years = [int(cell["text"]) for cell in heading[1:] if re.fullmatch(r"20\d{2}", cell["text"])]
    if len(years) != len(heading) - 1 or years != sorted(set(years)):
        raise SourceError("Périodes financières ambiguës")
    rows = {row[0]["text"]: row[1:] for row in table[1:] if len(row) == len(heading)}
    required = ["Market Cap", "Enterprise Value (EV)", "EPS", "EBITDA", "Reference price", "P/E"]
    if any(key not in rows for key in required):
        raise SourceError("Données de calcul incomplètes")
    # Every required magnitude must use the same explicit currency. Ratios remain
    # valid for the canonical ordinary/ADR listing, never mixed with a CDR price.
    units = parsed.units.get("valuationEnterpriseTable", set())
    currencies = {title.split(" ")[0] for title in units}
    if len(currencies) != 1:
        raise SourceError("Devise financière ambiguë")
    currency = next(iter(currencies))
    unit_titles = [title for title in units if " in " in title]
    if not unit_titles or any(title != currency + " in Million" for title in unit_titles):
        raise SourceError("Échelle financière non vérifiée")
    forecasts = []
    actual_indices = []
    for i, year in enumerate(years):
        period_end = date(year, fiscal_month, calendar.monthrange(year, fiscal_month)[1]).isoformat()
        eps = rows["EPS"][i]
        ebitda = rows["EBITDA"][i]
        is_eps_est = "table-child--bg-estimates" in eps["attrs"].get("class", "")
        is_ebitda_est = "table-child--bg-estimates" in ebitda["attrs"].get("class", "")
        if not is_eps_est and not is_ebitda_est:
            actual_indices.append(i)
        if is_eps_est or is_ebitda_est:
            forecasts.append({"period_end": period_end,
                "eps": number(eps["text"]) if is_eps_est else None,
                "ebitda_millions": number(ebitda["text"]) if is_ebitda_est else None,
                "eps_analysts": analyst_count(eps), "ebitda_analysts": analyst_count(ebitda)})
    if not forecasts:
        raise SourceError("Aucune prévision identifiée comme telle")
    # The latest market capitalization may sit in an already reported year
    # (e.g. Visa after its September results), before the first forecast column.
    cap_indices = [i for i, cell in enumerate(rows["Market Cap"]) if (number(cell["text"]) or 0) > 0]
    if not cap_indices:
        raise SourceError("Capitalisation absente")
    current_index = cap_indices[-1]
    price = number(rows["Reference price"][current_index]["text"])
    cap = number(rows["Market Cap"][current_index]["text"])
    validation_index = years.index(int(forecasts[0]["period_end"][:4]))
    published_pe = number(rows["P/E"][validation_index]["text"])
    eps = forecasts[0]["eps"]
    if price is None or price <= 0 or cap is None or cap <= 0:
        raise SourceError("Cours ou capitalisation absents")
    if eps and published_pe and abs(price / eps - published_pe) > max(.25, abs(published_pe) * .03):
        raise SourceError("BPA et cours incompatibles : devise, ADR ou base comptable")
    if not actual_indices:
        ev = bridge_date = None
    else:
        i = actual_indices[-1]
        past_ev = number(rows["Enterprise Value (EV)"][i]["text"])
        past_cap = number(rows["Market Cap"][i]["text"])
        net_debt = number(rows["Net Debt"][i]["text"]) if "Net Debt" in rows else None
        ev = cap + net_debt if net_debt is not None else cap + past_ev - past_cap if past_ev is not None and past_cap is not None else None
        bridge_date = date(years[i], fiscal_month, calendar.monthrange(years[i], fiscal_month)[1]).isoformat()
    # The future EV columns embed projected debt/cash. They are intentionally
    # never used as today's EV, nor divided by another year's EBITDA.
    return {"date": now.astimezone(TORONTO).date().isoformat(), "observed_at": now.isoformat(),
        "source_url": source_url, "currency": currency, "price": price,
        "market_cap_millions": cap, "enterprise_value_millions": ev,
        "ev_bridge_date": bridge_date, "ev_method": "current_market_cap_plus_reported_net_debt" if actual_indices and net_debt is not None else "current_market_cap_plus_last_reported_ev_bridge",
        "fiscal_month": fiscal_month, "forecasts": forecasts}


def analyst_count(cell):
    match = re.search(r"estimate: (\d+)", cell["attrs"].get("title", ""))
    return int(match[1]) if match else None


def forward_denominator(snapshot, key, horizon):
    """Calendar-day blend of annual consensus, for months 1–12 or 13–24."""
    day = date.fromisoformat(snapshot["date"])
    forecasts = {p["period_end"]: p.get(key) for p in snapshot["forecasts"]}
    month = snapshot["fiscal_month"]
    year = day.year + int(day > date(day.year, month, calendar.monthrange(day.year, month)[1]))
    year += horizon - 1
    end = date(year, month, calendar.monthrange(year, month)[1])
    previous = date(year - 1, month, calendar.monthrange(year - 1, month)[1])
    following = date(year + 1, month, calendar.monthrange(year + 1, month)[1])
    anchor = day
    if horizon == 2:
        anchor = date(day.year + 1, day.month, min(day.day, calendar.monthrange(day.year + 1, day.month)[1]))
    weight = (end - anchor).days / (end - previous).days
    a, b = forecasts.get(end.isoformat()), forecasts.get(following.isoformat())
    if a is None or (weight < 1 and b is None) or not 0 <= weight <= 1:
        return None
    return a * weight + (b or 0) * (1 - weight)


def ratios(snapshot, financial=False):
    result = {}
    for horizon in (1, 2):
        eps = forward_denominator(snapshot, "eps", horizon)
        ebitda = forward_denominator(snapshot, "ebitda_millions", horizon)
        ev = snapshot["enterprise_value_millions"]
        result[str(horizon)] = {
            "pe": snapshot["price"] / eps if eps is not None and eps > 0 else None,
            "ev_ebitda": ev / ebitda if not financial and ev is not None and ev > 0 and ebitda is not None and ebitda > 0 else None,
            "eps": eps, "ebitda_millions": ebitda,
        }
    return result


def price_dates(payload, snapshot, now):
    if payload.get("error") is not False or not isinstance(payload.get("data"), list):
        raise SourceError("Historique de référence absent")
    data = payload["data"][0]
    if len(payload["data"]) < 2 or payload["data"][1][2] != snapshot["currency"]:
        snapshot["price_date"] = None
        snapshot["price_date_status"] = "unconfirmed"
        return snapshot
    quotes = [rows for name, rows in data.items() if "(Estimate)" not in name and "(Released)" not in name]
    if len(quotes) != 1:
        raise SourceError("Cotation source ambiguë")
    today = now.astimezone(TORONTO).date().isoformat()
    rows = []
    for stamp, value in quotes[0]:
        day = datetime.fromtimestamp(stamp / 1000, timezone.utc).date().isoformat()
        if day <= today and isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0:
            rows.append((day, value))
    if not rows:
        raise SourceError("Aucun cours daté")
    # A current table may lead/lag the history. Find its actual quoted date;
    # never relabel a previous price as the current closing price.
    matches = [row for row in rows[-5:] if abs(row[1] - snapshot["price"]) <= max(.006, snapshot["price"] * .00002)]
    snapshot["price_date"] = matches[-1][0] if matches else None
    snapshot["price_date_status"] = "verified" if matches else "unconfirmed"
    preceding = sorted({d for d, _ in rows if snapshot["price_date"] and d < snapshot["price_date"]})
    snapshot["previous_session_date"] = preceding[-1] if preceding else None
    return snapshot


def reprice(payload, snapshot, instrument, now):
    """Use a completed native-listing daily close; never an ADR/CDR price over
    an ordinary-share EPS. Table forecasts and amounts retain their currency.
    """
    result = payload.get("chart", {}).get("result")
    if payload.get("chart", {}).get("error") or not result or len(result) != 1:
        raise SourceError("Clôture Yahoo indisponible")
    chart = result[0]
    meta = chart.get("meta", {})
    expected = instrument.get("valuation_symbol", instrument["symbol"])
    if meta.get("symbol", "").upper() != expected.upper() or meta.get("currency") != snapshot["currency"]:
        raise SourceError("Clôture et consensus : cotation ou devise différente")
    tz = ZoneInfo(meta["exchangeTimezoneName"])
    local_today = now.astimezone(tz).date()
    period = meta.get("currentTradingPeriod", {}).get("regular", {})
    regular_start = datetime.fromtimestamp(period["start"], timezone.utc).astimezone(tz).date() if period.get("start") else None
    regular_end = datetime.fromtimestamp(period["end"], timezone.utc) if period.get("end") else None
    timestamps = chart.get("timestamp", [])
    closes = chart.get("indicators", {}).get("quote", [{}])[0].get("close", [])
    rows = []
    for stamp, close in zip(timestamps, closes):
        dt = datetime.fromtimestamp(stamp, timezone.utc)
        session = dt.astimezone(tz).date()
        if session > local_today or dt > now or not isinstance(close, (int, float)) or isinstance(close, bool) or not math.isfinite(close) or close <= 0:
            continue
        if session == local_today and (regular_start != session or regular_end is None or now < regular_end + timedelta(minutes=2)):
            continue
        rows.append((session.isoformat(), close))
    if not rows:
        raise SourceError("Aucune séance terminée dans la clôture source")
    day, close = rows[-1]
    if (now.astimezone(tz).date() - date.fromisoformat(day)).days > 7:
        raise SourceError("Clôture de plus de sept jours")
    ratio = close / snapshot["price"]
    if not .65 <= ratio <= 1.35:
        raise SourceError("Fractionnement ou variation importante à rapprocher avant calcul")
    reference_day = snapshot.get("price_date")
    for event in chart.get("events", {}).get("splits", {}).values():
        split_day = datetime.fromtimestamp(event["date"], timezone.utc).astimezone(tz).date().isoformat()
        if split_day <= day and (reference_day is None or split_day > reference_day):
            raise SourceError("Fractionnement à rapprocher avec le consensus avant calcul")
    # Keep original inputs for audit. Capitalization scales with the new close
    # using the source's implied share count; debt stays at its reported value.
    old_cap = snapshot["market_cap_millions"]
    adjustment = snapshot["enterprise_value_millions"] - old_cap if snapshot["enterprise_value_millions"] is not None else None
    snapshot["source_table_price"] = snapshot["price"]
    snapshot["source_table_price_date"] = snapshot.get("price_date")
    snapshot["source_table_market_cap_millions"] = old_cap
    snapshot["price"] = float(close)
    snapshot["market_cap_millions"] = old_cap * ratio
    snapshot["enterprise_value_millions"] = old_cap * ratio + adjustment if adjustment is not None else None
    snapshot["price_date"] = day
    preceding = sorted({d for d, _ in rows if d < day})
    snapshot["previous_session_date"] = preceding[-1] if preceding else None
    snapshot["price_date_status"] = "verified"
    snapshot["price_symbol"] = expected
    snapshot["price_source_url"] = "https://finance.yahoo.com/quote/" + urllib.parse.quote(expected) + "/history/"
    return snapshot


def closing_price(snapshot, instrument, now):
    symbol = instrument.get("valuation_symbol", instrument["symbol"])
    query = urllib.parse.urlencode({"range":"1mo", "interval":"1d", "events":"splits", "includePrePost":"false"})
    errors = []
    for host in ("query1.finance.yahoo.com", "query2.finance.yahoo.com"):
        try:
            payload = json.loads(fetch("https://" + host + "/v8/finance/chart/" + urllib.parse.quote(symbol) + "?" + query))
            return reprice(payload, snapshot, instrument, now)
        except Exception as error:
            errors.append(str(error))
    snapshot["price_refresh_error"] = errors[-1]
    return snapshot


def preserve(previous, snapshot):
    observations = list(previous.get("observations", [])) if previous else []
    if observations and snapshot["date"] < observations[-1]["date"]:
        raise SourceError("Un ancien relevé ne peut pas remplacer l’historique")
    if observations and snapshot["date"] == observations[-1]["date"]:
        if snapshot["observed_at"] <= observations[-1]["observed_at"]:
            return observations
        observations[-1] = snapshot
    else:
        observations.append(snapshot)
    return observations


def collect_one(instrument, output, now):
    path = output / (instrument["id"] + ".json")
    previous = read(path, {})
    try:
        url = resolve(instrument, previous.get("source_url"))
        snapshot = table_snapshot(fetch(url), instrument, url, now)
        code = re.search(r"-(\d+)/valuation/$", url)[1]
        history = json.loads(fetch(HOST + "/async/graph/af/emy?" + urllib.parse.urlencode({"codeZB": code, "type": "PER"})))
        price_dates(history, snapshot, now)
        closing_price(snapshot, instrument, now)
        snapshot["ratios"] = ratios(snapshot, instrument.get("financial", False))
        snapshot["definition"] = "annual_consensus_calendar_day_blend"
        # A dated observation is only a daily close if both collection and the
        # referenced price confirm the same finished regular session.
        local = now.astimezone(TORONTO)
        snapshot["complete_session"] = local.hour >= 17 and snapshot["price_date"] == snapshot["date"] and local.weekday() < 5
        observations = preserve(previous, snapshot)
        item = {"schema_version": 1, "kind": "savy_stock_valuation", "id": instrument["id"],
            "title": instrument["title"], "financial": instrument.get("financial", False),
            "source_url": url, "fetch_status": "fresh", "checked_at": now.isoformat(), "observations": observations}
        write(path, item)
        return {**instrument, "fetch_status": "fresh", "source_url": url, "latest": snapshot}
    except Exception as error:
        if previous.get("observations"):
            previous.update(fetch_status="cached", checked_at=now.isoformat(), error=str(error))
            write(path, previous)
            return {**instrument, "fetch_status": "cached", "source_url": previous.get("source_url"),
                "error": str(error), "latest": previous["observations"][-1]}
        return {**instrument, "fetch_status": "unavailable", "error": str(error), "latest": None}


def validate(output, universe):
    index = read(output / "index.json")
    if not index or index.get("kind") != "savy_valuations" or index.get("schema_version") != 1:
        raise SourceError("Index de valorisation absent")
    expected = {row["id"] for row in universe["instruments"]}
    if {row["id"] for row in index["instruments"]} != expected:
        raise SourceError("Univers incomplet ou FNB introduit")
    for row in index["instruments"]:
        if row.get("type") != "stock":
            raise SourceError("Les FNB ne font pas partie de cet univers")
        data = read(output / (row["id"] + ".json"), {})
        last = ""
        for snap in data.get("observations", []):
            day = date.fromisoformat(snap["date"]).isoformat()
            if day <= last or datetime.fromisoformat(snap["observed_at"]).astimezone(TORONTO).date().isoformat() != day:
                raise SourceError("Relevé antidaté ou dates désordonnées")
            if snap["ratios"] != ratios(snap, row.get("financial", False)):
                raise SourceError("Ratio incompatible avec son consensus archivé")
            last = day
    return index


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "data/valuations")
    parser.add_argument("--only", help="Identifiants publics à collecter, séparés par des virgules")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)
    universe = read(ROOT / "data/valuation-universe.json")
    if args.check:
        index = validate(args.output_dir, universe)
        print("Valuations checked:", index["coverage"])
        return 0
    now = datetime.now(timezone.utc)
    selected = set(args.only.split(",")) if args.only else None
    instruments = [row for row in universe["instruments"] if not selected or row["id"] in selected]
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        jobs = {pool.submit(collect_one, row, args.output_dir, now): row for row in instruments}
        for job in concurrent.futures.as_completed(jobs):
            row = job.result()
            results.append(row)
            print(row["id"], row["fetch_status"], row.get("error", ""), flush=True)
    if selected:
        old = read(args.output_dir / "index.json", {}).get("instruments", [])
        results.extend(row for row in old if row["id"] not in selected)
    results.sort(key=lambda r: r["id"])
    coverage = {key: sum(row["fetch_status"] == key for row in results) for key in ("fresh", "cached", "unavailable")}
    write(args.output_dir / "index.json", {"schema_version": 1, "kind": "savy_valuations", "generated_at": now.isoformat(),
        "coverage": coverage, "instruments": results})
    print("Coverage:", coverage)
    return 0 if coverage["fresh"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
