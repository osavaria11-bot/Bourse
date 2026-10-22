#!/usr/bin/env python3
"""Permanent, append-only paper investments; deliberately separate from backtests.

Frozen fractional units, buy and hold, cash distributions reinvested at the
ex-date close. No target-weight rebalancing. Every accepted session is hashed
and committed; later research and vendor history revisions never replay it.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import date, datetime, time, timedelta
import hashlib
import json
import math
from pathlib import Path
from urllib.parse import quote, urlencode
from zoneinfo import ZoneInfo

from fnb_sources import Client, previous_trading_day

TZ = ZoneInfo("America/Toronto")
START = "2026-10-19"
CAPITAL = 10000.
BENCHMARKS = ["FEQT", "VEQT", "VGRO", "VBAL"]
BASELINE = "data/fnb-history/2026-10.json"
METHOD = "buy_hold_fractional_ex_date_close_v1"


def read(path):
    return json.loads(Path(path).read_text())


def write(path, value):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
    temporary.replace(path)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()).hexdigest()


def trading_day(day):
    return previous_trading_day(day) == day


def next_session(day):
    day += timedelta(days=1)
    while not trading_day(day): day += timedelta(days=1)
    return day


def completed_session(now):
    now = now.astimezone(TZ)
    # Two-hour publication buffer; a morning retry only considers yesterday.
    day = now.date() if now.time() >= time(18) else now.date() - timedelta(days=1)
    while not trading_day(day): day -= timedelta(days=1)
    return day


def publication_launch(published):
    published = datetime.fromisoformat(published.replace("Z", "+00:00")).astimezone(TZ)
    day = published.date()
    close = time(13) if day.month == 12 and day.day == 24 else time(16)
    if not trading_day(day) or published.time() >= close: return next_session(day)
    return day


def definition(key, result, launch, source, kind="portfolio", published=None):
    weights = result["weights"]
    if abs(sum(weights.values()) - 1) > 1e-8 or any(not math.isfinite(w) or w <= 0 for w in weights.values()):
        raise ValueError("Invalid launch weights: " + key)
    d = {"id": key, "name": result.get("name") or result.get("label") or key, "color": result["color"], "kind": kind,
         "launch_date": launch, "capital": CAPITAL, "currency": "CAD", "weights": dict(sorted(weights.items())),
         "definition_source": source, "published_at": published, "method": METHOD}
    return {**d, "definition_sha256": digest(d)}


def register(root, registry):
    """Only add new identities. Never edit a definition after registration."""
    registry = deepcopy(registry)
    known = {a["id"] for a in registry["accounts"]}
    initial = read(root / BASELINE)
    candidates = [definition("savy-" + k, initial["results"][k], START, BASELINE) for k in initial["custom_order"]]
    candidates += [definition(k, initial["results"][k], START, BASELINE, "benchmark") for k in BENCHMARKS]
    for file in sorted((root / "data/fnb-history").glob("????-??.json")):
        d = read(file); opt = d["optimization"]; month = opt["month"]
        launch = START if month == "2026-10" else publication_launch(opt["generated_at"]).isoformat()
        candidates.append(definition("proposal-" + month, d["results"]["proposal"], launch,
                                     file.relative_to(root).as_posix(), published=opt["generated_at"]))
    from robust_fnb import catalogs, validate_catalog
    for catalog in catalogs(root):
        validate_catalog(catalog)
        launch = publication_launch(catalog["published_at"]).isoformat()
        for portfolio in catalog["portfolios"]:
            candidates.append(definition(portfolio["id"], portfolio, launch, catalog["catalog_path"],
                                         published=catalog["published_at"]))
    for candidate in candidates:
        if candidate["id"] not in known:
            registry["accounts"].append(candidate); known.add(candidate["id"])
        else:
            existing = next(a for a in registry["accounts"] if a["id"] == candidate["id"])
            if candidate != existing: raise ValueError("Frozen account definition changed: " + candidate["id"])
    return registry


def parse_prices(payload, symbol, first, last, fallback=None, prefer_fallback=False):
    """Recover contemporaneous closes from Yahoo's split-adjusted Close series.

    Yahoo retrospectively splits BOTH Close and historical dividend amounts.
    Undo all subsequent splits inside this through-today response, then apply
    each event exactly once to the units held on that session.
    """
    if payload.get("chart", {}).get("error"): raise ValueError(str(payload["chart"]["error"]))
    d = payload["chart"]["result"][0]; meta = d["meta"]
    if meta.get("symbol") != symbol or meta.get("currency") != "CAD" or meta.get("instrumentType") != "ETF":
        raise ValueError("Unexpected CAD ETF identity: " + symbol)
    if meta.get("exchangeTimezoneName") != "America/Toronto": raise ValueError("Unexpected listing timezone")
    day_of = lambda ts: datetime.fromtimestamp(int(ts), TZ).date().isoformat()
    events = d.get("events", {}); splits = {}; distributions = {}
    for event in events.get("splits", {}).values():
        day = day_of(event["date"]); ratio = float(event["numerator"]) / float(event["denominator"])
        if not math.isfinite(ratio) or ratio <= 0: raise ValueError("Invalid split")
        splits[day] = splits.get(day, 1.) * ratio
    for kind in ["dividends", "capitalGains"]:
        for event in events.get(kind, {}).values():
            day = day_of(event["date"]); amount = float(event["amount"])
            if not math.isfinite(amount) or amount < 0: raise ValueError("Invalid distribution")
            distributions[day] = distributions.get(day, 0.) + amount
    quote_data = d["indicators"]["quote"][0]
    adjusted = d["indicators"].get("adjclose", [{}])[0].get("adjclose", [])
    if len(adjusted) != len(d["timestamp"]): raise ValueError("Missing adjusted-close cross-check")
    out = {}
    observations = {day_of(ts): i for i, ts in enumerate(d["timestamp"])}
    for day in sorted(set(observations) | set(fallback or {})):
        if not first <= day <= last: continue
        i = observations.get(day)
        close, adj = (quote_data["close"][i], adjusted[i]) if i is not None else (None, None)
        replacement = (fallback or {}).get(day) if prefer_fallback or close is None or adj is None else None
        if replacement: close, adj = replacement["close"], replacement["adjusted_close"]
        if close is None or adj is None: continue
        if not all(math.isfinite(x) and x > 0 for x in [close, adj]): raise ValueError("Invalid close")
        later = math.prod(ratio for sd, ratio in splits.items() if sd > day)
        out[day] = {"close": close if replacement else close * later, "adjusted_close": adj,
            "distribution": distributions.get(day, 0.) * later, "split": splits.get(day, 1.),
            "symbol": symbol, "source_url": replacement["source_url"] if replacement else "https://finance.yahoo.com/quote/" + quote(symbol) + "/history/",
            "price_source": "TMX Money" if replacement else "Yahoo Finance", "corporate_actions_source": "Yahoo Finance"}
    return out


def tmx_closes(client, ticker, first, last):
    """Dated official-market history, never a live quote or an old last sale.

    This is the same public history query used by the TMX Money quote page.
    Raw/adjusted observations are fetched together for the same listed ETF.
    """
    query = """query($symbol:String!,$start:String,$end:String,$limit:Int){
      identity:getQuoteBySymbol(symbol:$symbol){symbol currency datatype}
      raw:getCompanyPriceHistory(symbol:$symbol,start:$start,end:$end,limit:$limit,adjusted:false,unadjusted:true){datetime closePrice}
      adjusted:getCompanyPriceHistory(symbol:$symbol,start:$start,end:$end,limit:$limit,adjusted:true,unadjusted:false){datetime closePrice}}"""
    payload = {"query": query, "variables": {"symbol": ticker, "start": first, "end": last,
        "limit": max(20, (date.fromisoformat(last) - date.fromisoformat(first)).days + 1)}}
    d = client.json("https://app-money.tmx.com/graphql", payload)["data"]
    identity = d["identity"]
    if identity["symbol"] != ticker or identity["currency"] != "CAD" or identity["datatype"].lower() != "etf":
        raise ValueError("Unexpected TMX CAD ETF identity")
    adjusted = {row["datetime"][:10]: row["closePrice"] for row in d["adjusted"]}
    return {row["datetime"][:10]: {"close": row["closePrice"], "adjusted_close": adjusted[row["datetime"][:10]],
        "source_url": "https://money.tmx.com/en/quote/" + quote(ticker)} for row in d["raw"]
        if row["datetime"][:10] in adjusted and row["closePrice"] is not None and adjusted[row["datetime"][:10]] is not None}


def collect(config, tickers, first, last, client=None, preferred_tmx=(), anchors=None):
    client = client or Client()
    def one(ticker):
        symbol = config["funds"][ticker]["quote_symbol"]
        # Request through NOW, even during catch-up: future splits alter vendor history.
        params = {"period1": int(datetime.combine(date.fromisoformat(first), time(), TZ).timestamp()),
                  "period2": int(datetime.combine(date.fromisoformat(last) + timedelta(days=1), time(), TZ).timestamp()),
                  "interval": "1d", "events": "div,splits,capitalGains"}
        url = "https://query1.finance.yahoo.com/v8/finance/chart/" + quote(symbol) + "?" + urlencode(params)
        payload = client.json(url)
        yahoo = parse_prices(payload, symbol, first, last)
        parsed = yahoo
        expected = []; day = date.fromisoformat(first)
        while day.isoformat() <= last:
            if trading_day(day): expected.append(day.isoformat())
            day += timedelta(days=1)
        anchor = (anchors or {}).get(ticker)
        revised = anchor and anchor["date"] in yahoo and abs(yahoo[anchor["date"]]["close"] / anchor["close"] - 1) > .0001
        if ticker in preferred_tmx or revised or any(day not in parsed for day in expected):
            # TMX identifies Canadian Cboe listings with :CC, not the bare TSX symbol.
            market_symbol = ticker + ":CC" if symbol.endswith(".NE") else ticker
            official = tmx_closes(client, market_symbol, first, last)
            if any(day not in official for day in expected):
                raise ValueError("Missing consistent TMX closing history: " + ticker)
            # Use one source for both ends of each return. Mixing a newly
            # populated Yahoo anchor with an accepted TMX close can fabricate a
            # revision even when TMX still confirms the immutable ledger price.
            parsed = parse_prices(payload, symbol, first, last, official, prefer_fallback=True)
            if anchor and anchor["date"] in parsed and abs(parsed[anchor["date"]]["close"] / anchor["close"] - 1) > .0001:
                # A revision is accepted only when two independent histories
                # agree on BOTH endpoints. Preserve the original ledger and
                # carry the evidence into the next daily record, never rebase units.
                revised_day = anchor["date"]
                following = next_session(date.fromisoformat(revised_day)).isoformat()
                if any(day not in yahoo or day not in parsed or abs(yahoo[day]["close"] / parsed[day]["close"] - 1) > .0001
                       for day in [revised_day, following]):
                    raise ValueError("Unconfirmed historical close revision: " + ticker)
                parsed[revised_day]["verified_revision"] = {
                    "date": revised_day, "accepted_close": anchor["close"],
                    "revised_close": parsed[revised_day]["close"], "next_date": following,
                    "next_close": parsed[following]["close"],
                    "evidence": [{"source": "Yahoo Finance", "source_url": yahoo[revised_day]["source_url"],
                                  "close": yahoo[revised_day]["close"], "next_close": yahoo[following]["close"]},
                                 {"source": "TMX Money", "source_url": parsed[revised_day]["source_url"],
                                  "close": parsed[revised_day]["close"], "next_close": parsed[following]["close"]}]}
        return ticker, parsed
    with ThreadPoolExecutor(max_workers=4) as pool: return dict(pool.map(one, sorted(tickers)))


def calculate(account, prices, previous=None):
    if previous is None:
        units = {t: account["capital"] * w / prices[t]["close"] for t, w in account["weights"].items()}
    else:
        units = {t: u * prices[t]["split"] * (1 + prices[t]["distribution"] / prices[t]["close"])
                 for t, u in previous["units"].items()}
    return {"value": sum(u * prices[t]["close"] for t, u in units.items()), "units": units}


def make_day(day, registry, quotes, previous, recorded_at):
    active = [a for a in registry["accounts"] if a["launch_date"] <= day]
    required = {t for a in active for t in a["weights"]}
    prices = {}
    for t in sorted(required):
        if day not in quotes.get(t, {}): raise ValueError(f"Missing official closing observation: {t} {day}")
        prices[t] = deepcopy(quotes[t][day])
        if previous and t in previous["prices"]:
            p, old = prices[t], previous["prices"][t]
            anchor = quotes[t].get(previous["date"])
            if not anchor: raise ValueError("Missing adjacent-session return check: " + t)
            # Adjusted levels come from ONE response, so later dividends/splits cancel.
            gross = p["adjusted_close"] / anchor["adjusted_close"]
            close_ratio = p["close"] * p["split"] / anchor["close"]
            div_ratio = p["distribution"] * p["split"] / anchor["close"]
            low = close_ratio + div_ratio
            high = close_ratio / (1 - div_ratio) if div_ratio < 1 else float("inf")
            if not min(low, high) - .0002 <= gross <= max(low, high) + .0002:
                raise ValueError("Distribution/split does not reconcile with total return: " + t)
            if abs(anchor["close"] / old["close"] - 1) > .0001:
                revision = anchor.get("verified_revision", {})
                if (revision.get("date") != previous["date"] or revision.get("accepted_close") != old["close"] or
                    revision.get("revised_close") != anchor["close"] or revision.get("next_date") != day or
                    revision.get("next_close") != p["close"] or
                    {e.get("source") for e in revision.get("evidence", [])} != {"Yahoo Finance", "TMX Money"} or
                    any(abs(e["close"] / anchor["close"] - 1) > .0001 or abs(e["next_close"] / p["close"] - 1) > .0001
                        for e in revision["evidence"])):
                    raise ValueError("Previously accepted nominal close revised: " + t)
                prices[t]["previous_close_revision"] = revision
    accounts = {}
    for a in active:
        prev = previous["accounts"].get(a["id"]) if previous else None
        if prev is None and a["launch_date"] != day: raise ValueError("Refusing a retroactive launch: " + a["id"])
        accounts[a["id"]] = calculate(a, prices, prev)
    record = {"schema_version": 1, "date": day, "recorded_at": recorded_at,
              "previous_sha256": previous["sha256"] if previous else None, "prices": prices, "accounts": accounts}
    return {**record, "sha256": digest(record)}


def validate(registry, days):
    if registry["schema_version"] != 1: raise ValueError("Registry version")
    ids = [a["id"] for a in registry["accounts"]]
    if len(set(ids)) != len(ids): raise ValueError("Duplicate account")
    for a in registry["accounts"]:
        if digest({k: v for k, v in a.items() if k != "definition_sha256"}) != a["definition_sha256"]:
            raise ValueError("Changed frozen definition")
        if a["capital"] != CAPITAL or a["method"] != METHOD or abs(sum(a["weights"].values()) - 1) > 1e-8:
            raise ValueError("Invalid investment definition")
    previous = None
    for record in days:
        if digest({k: v for k, v in record.items() if k != "sha256"}) != record["sha256"]: raise ValueError("Changed daily archive")
        expected_day = next_session(date.fromisoformat(previous["date"])).isoformat() if previous else START
        if record["date"] != expected_day or record["previous_sha256"] != (previous["sha256"] if previous else None):
            raise ValueError("Broken session chain")
        for p in record["prices"].values():
            if not all(math.isfinite(p[k]) and p[k] > 0 for k in ["close", "adjusted_close", "split"]) or not math.isfinite(p["distribution"]) or p["distribution"] < 0:
                raise ValueError("Invalid archived price or event")
        active = [a for a in registry["accounts"] if a["launch_date"] <= record["date"]]
        if set(record["accounts"]) != {a["id"] for a in active}: raise ValueError("Incomplete daily account set")
        for a in active:
            prev = previous["accounts"].get(a["id"]) if previous else None
            expected = calculate(a, record["prices"], prev); actual = record["accounts"][a["id"]]
            if set(actual["units"]) != set(a["weights"]): raise ValueError("Holdings changed")
            for x, y in [(actual["value"], expected["value"]), *[(actual["units"][t], u) for t, u in expected["units"].items()]]:
                if not math.isfinite(x) or x <= 0 or not math.isclose(x, y, rel_tol=1e-11, abs_tol=1e-8):
                    raise ValueError("Daily investment reconciliation failed")
        previous = record


def snapshot(registry, days, config):
    accounts = []
    for a in registry["accounts"]:
        history = [{"date": d["date"], "value": d["accounts"][a["id"]]["value"]} for d in days if a["id"] in d["accounts"]]
        launch = next((d for d in days if d["date"] == a["launch_date"]), None)
        positions = []
        for t, weight in a["weights"].items():
            positions.append({"ticker": t, "name": config["funds"][t]["name"], "weight": weight,
                "close": launch["prices"][t]["close"] if launch else None,
                "units": launch["accounts"][a["id"]]["units"][t] if launch else None})
        accounts.append({**a, "history": history, "initial_positions": positions})
    return {"schema_version": 1, "currency": "CAD", "capital": CAPITAL, "inception": START,
            "as_of": days[-1]["date"] if days else None, "updated_at": days[-1]["recorded_at"] if days else None,
            "ledger_sha256": days[-1]["sha256"] if days else None, "benchmarks": BENCHMARKS, "accounts": accounts,
            "methodology": {"model": METHOD, "distributions": "Distributions en espèces réinvesties en parts fractionnaires à la clôture de la date ex-distribution; fractionnements appliqués aux parts. Aucun rééquilibrage.",
                "costs": "CAD, frais internes des FNB inclus dans leurs cours; courtage, fiscalité et écarts d’exécution exclus.",
                "history": "Registre quotidien figé, distinct des backtests. Les nouvelles optimisations ont leur propre date de lancement et ne remplacent aucun compte.",
                "source": "Clôtures quotidiennes Yahoo Finance, complétées par l’historique daté TMX Money si nécessaire; distributions et fractionnements Yahoo Finance, contrôle par clôtures ajustées.",
                "source_url": "https://help.yahoo.com/kb/SLN28256.html", "schedule": "Chaque jour à 18 h 37 (Québec); reprises à 21 h 37, 6 h 17 et 7 h 47. Séances complètes uniquement.",
                "revisions": "Une correction de cours historique exige l’accord de Yahoo et TMX sur les deux clôtures adjacentes et est consignée dans la séance suivante. Les cours, parts et valeurs déjà archivés restent figés; le rendement quotidien relie les deux valeurs réellement enregistrées."}}


def load_state(root):
    directory = root / "data/fnb-performance"
    file = directory / "registry.json"
    paths = sorted((directory / "days").glob("????-??-??.json"))
    if not file.exists() and (paths or (root / "data/fnb-performance.json").exists()):
        raise ValueError("Registry missing: refusing to reset existing investments")
    registry = read(file) if file.exists() else {"schema_version": 1, "accounts": []}
    days = [read(path) for path in paths]
    validate(registry, days)
    return registry, days


def run(root, now, sources=None):
    registry, days = load_state(root)
    registry = register(root, registry)
    last = completed_session(now)
    day = next_session(date.fromisoformat(days[-1]["date"])) if days else date.fromisoformat(START)
    additions = []
    if day <= last:
        first = days[-1]["date"] if days else START
        required = {t for a in registry["accounts"] if a["launch_date"] <= last.isoformat() for t in a["weights"]}
        preferred_tmx = {t for t,p in (days[-1]["prices"].items() if days else []) if p.get("price_source") == "TMX Money"}
        anchors = {t: {"date": days[-1]["date"], "close": p["close"]} for t,p in days[-1]["prices"].items()} if days else {}
        quotes = sources if sources is not None else collect(read(root / "data/fnb-model.json"), required, first, last.isoformat(), preferred_tmx=preferred_tmx, anchors=anchors)
        while day <= last:
            record = make_day(day.isoformat(), registry, quotes, (additions or days or [None])[-1], now.isoformat(timespec="seconds"))
            additions.append(record); day = next_session(day)
    validate(registry, days + additions)
    data = snapshot(registry, days + additions, read(root / "data/fnb-model.json"))
    for record in additions:
        path = root / "data/fnb-performance/days" / (record["date"] + ".json")
        if path.exists(): raise ValueError("Refusing to overwrite a daily archive")
        write(path, record)
    write(root / "data/fnb-performance/registry.json", registry)
    write(root / "data/fnb-performance.json", data)
    status_file = root / "data/fnb-performance-status.json"
    old = read(status_file) if status_file.exists() else {}
    if additions or old.get("status") != "current" or old.get("expected_session") != last.isoformat():
        write(status_file, {"schema_version": 1, "status": "current", "checked_at": now.isoformat(timespec="seconds"),
            "as_of": data["as_of"], "expected_session": last.isoformat(), "added_sessions": len(additions)})
    print(f"Permanent FNB tracking: {len(registry['accounts'])} accounts; {len(additions)} new sessions; as of {data['as_of']}")
    return data


def main():
    p = argparse.ArgumentParser(); p.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1]); p.add_argument("--check", action="store_true")
    args = p.parse_args(); root = args.root
    if args.check:
        registry, days = load_state(root)
        if not registry["accounts"]: raise ValueError("Missing performance registry")
        # Research may have just published a new identity. Check frozen existing
        # definitions now; collection below is responsible for adding new ones.
        register(root, registry)
        if read(root / "data/fnb-performance.json") != snapshot(registry, days, read(root / "data/fnb-model.json")):
            raise ValueError("Performance snapshot disagrees with permanent ledger")
        print("Validated permanent FNB ledger:", len(days), "sessions"); return 0
    now = datetime.now(TZ)
    # Save launch definitions even if the first official close is late. Empty
    # histories are explicitly pending, never substituted with an older price.
    registry, days = load_state(root)
    registered = register(root, registry)
    if registered != registry:
        write(root / "data/fnb-performance/registry.json", registered)
        write(root / "data/fnb-performance.json", snapshot(registered, days, read(root / "data/fnb-model.json")))
    try: run(root, now)
    except Exception as exc:
        write(root / "data/fnb-performance-status.json", {"schema_version": 1, "status": "retrying", "checked_at": now.isoformat(timespec="seconds"),
            "expected_session": completed_session(now).isoformat(), "message": "Clôtures incomplètes : dernier historique validé conservé. Reprise automatique.", "error": str(exc)[:1600]})
        raise
    return 0


if __name__ == "__main__": raise SystemExit(main())
