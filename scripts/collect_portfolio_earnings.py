#!/usr/bin/env python3
"""Collect earnings for the public catalogue. Private holdings never leave the client.

Use paired actual/consensus metrics from one provider and currency. Calendar-only
entries cannot claim a beat. The UI shows only reviewed French analyses with
three or four substantive points, bound to the issuer and exact dated report.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import math
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import quote, urljoin, urlsplit
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

try:
    from .generate_daily_briefing import atomic_write_json, read_json, SourceError
except ImportError:
    from generate_daily_briefing import atomic_write_json, read_json, SourceError

ROOT = Path(__file__).resolve().parents[1]
TORONTO = ZoneInfo("America/Toronto")
METHODOLOGY = "Calendrier et résultats du catalogue public; filtrage des titres détenus dans le navigateur. BPA publié et consensus d’un même fournisseur. Chiffres dans leur devise de publication. Messages clés affichés seulement après vérification : trois ou quatre points français sur les moteurs, perspectives et risques du trimestre. Dates estimées signalées; valeurs absentes non extrapolées."
ETFS = set("ACWV CASH CGL FBAL FCIN FCUV FEQT QQC SPYM VBAL VCN VDY VEE VEQT VFV VGRO VIU XBB XEF XEQT XGD XGRO XHY XIC XIG XIU XLF XSB XSP XSU XUS ZAG ZEB ZLB ZRE ZUH".split())
NYSE = set("APH APO BAC CLS CRM CVX DIS GS HD JNJ JPM MOD MRK NU NVO PFE TSM UNH V WFC XOM".split())
# These Canadian listings share the issuer's US results. Keep the local holding ID
# and explicitly display the reporting currency, including the Sandisk CDR.
US_LISTINGS = {
    "BAM": ("NYSE", "BAM"), "BCE": ("NYSE", "BCE"), "BMO": ("NYSE", "BMO"),
    "BN": ("NYSE", "BN"), "BNS": ("NYSE", "BNS"), "CCO": ("NYSE", "CCJ"),
    "CM": ("NYSE", "CM"), "CNQ": ("NYSE", "CNQ"), "CNR": ("NYSE", "CNI"),
    "CP": ("NYSE", "CP"), "CVE": ("NYSE", "CVE"), "DSG": ("NASDAQ", "DSGX"),
    "MSFTCDR": ("NASDAQ", "MSFT"),
    "ENB": ("NYSE", "ENB"), "FTS": ("NYSE", "FTS"), "HBM": ("NYSE", "HBM"),
    "MFC": ("NYSE", "MFC"), "NXE": ("NYSE", "NXE"), "RY": ("NYSE", "RY"),
    "SHOP": ("NASDAQ", "SHOP"), "SLF": ("NYSE", "SLF"), "SNDK": ("NASDAQ", "SNDK"),
    "SNDKUS": ("NASDAQ", "SNDK"), "SU": ("NYSE", "SU"), "TD": ("NYSE", "TD"),
    "TRP": ("NYSE", "TRP"), "WCN": ("NYSE", "WCN"),
}


def clean(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", value))).strip()


def safe_url(value: str) -> bool:
    try:
        url = urlsplit(value)
        return url.scheme == "https" and bool(url.hostname) and not url.username and not url.password
    except (ValueError, TypeError):
        return False


def fetch_text(url: str) -> str:
    request = Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "text/html"})
    with urlopen(request, timeout=22) as response:
        text = response.read(3_000_001)
    if len(text) > 3_000_000:
        raise SourceError("Source trop volumineuse")
    return text.decode("utf-8")


class TableParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tables, self.links = [], []
        self.table = self.row = self.cell = self.link = None

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if tag == "table":
            self.table = {"id": attrs.get("id"), "rows": []}
            self.tables.append(self.table)
        elif tag == "tr" and self.table is not None:
            self.row = []
            self.table["rows"].append(self.row)
        elif tag in ("td", "th") and self.row is not None:
            self.cell = []
            self.row.append(self.cell)
        if tag == "a" and attrs.get("href"):
            self.link = {"url": attrs["href"], "text": []}
            self.links.append(self.link)

    def handle_endtag(self, tag):
        if tag in ("td", "th"):
            self.cell = None
        elif tag == "tr":
            self.row = None
        elif tag == "table":
            self.table = None
        if tag == "a":
            self.link = None

    def handle_data(self, value):
        if self.cell is not None:
            self.cell.append(value)
        if self.link is not None:
            self.link["text"].append(value)

    def records(self, identifier=None):
        for table in self.tables:
            if identifier and table["id"] != identifier:
                continue
            rows = [[clean(" ".join(cell)) for cell in row] for row in table["rows"]]
            if not rows:
                continue
            headers = rows[0]
            yield from (dict(zip(headers, row)) for row in rows[1:] if len(row) == len(headers))


def number(value: str) -> float | None:
    text = value.strip().replace(",", "").replace("−", "-")
    if text in ("", "-", "—", "N/A", "N/D"):
        return None
    negative = "-" in text or (text.startswith("(") and text.endswith(")"))
    match = re.search(r"\d+(?:\.\d+)?", text)
    if not match:
        return None
    result = float(match[0]) * (-1 if negative else 1)
    suffix = re.search(r"([KMBT])\s*\)?$", text)
    if suffix:
        result *= {"K": 1e3, "M": 1e6, "B": 1e9, "T": 1e12}[suffix[1]]
    return result if math.isfinite(result) else None


def currency(value: str) -> str | None:
    return "CAD" if "C$" in value or "C-$" in value else "USD" if "$" in value else None


def metric(actual: str, estimate: str, source_url: str) -> dict:
    actual_value, estimate_value = number(actual), number(estimate)
    actual_currency, estimate_currency = currency(actual), currency(estimate)
    if actual_value is not None and estimate_value is not None and actual_currency != estimate_currency:
        estimate_value = None
    return {"actual": actual_value, "estimate": estimate_value,
            "currency": actual_currency or estimate_currency, "source_url": source_url}


def event_id(company: str, day: str) -> str:
    return hashlib.sha256(f"{company}:{day}".encode()).hexdigest()[:16]


def parse_marketbeat(text: str, company: str, url: str, now: datetime) -> list[dict]:
    parser = TableParser()
    parser.feed(text)
    table = next((table for table in parser.tables if table["id"] == "earnings-history"), None)
    if table is None:
        raise SourceError("Tableau de résultats MarketBeat absent")
    today = now.astimezone(TORONTO).date()
    events = []
    for row in parser.records("earnings-history"):
        match = re.match(r"(\d{1,2}/\d{1,2}/\d{4})", row.get("Date", ""))
        if not match:
            continue
        day = datetime.strptime(match[1], "%m/%d/%Y").date()
        eps = metric(row.get("Reported EPS", ""), row.get("Consensus Estimate", ""), url)
        revenue = metric(row.get("Actual Revenue", ""), row.get("Revenue Estimate", ""), url)
        # This provider uses zero revenue as an unavailable-data placeholder.
        # Keep the value unavailable instead of claiming a 100% revenue collapse.
        if revenue["actual"] == 0:
            revenue["actual"] = None
        if day > today:
            eps["actual"] = revenue["actual"] = None
        reported = eps["actual"] is not None or revenue["actual"] is not None
        report_url = next((urljoin(url, link["url"]) for link in parser.links
                           if re.search(r"/earnings/reports/" + f"{day.year}-{day.month}-{day.day}-", link["url"])), None)
        quarter = row.get("Quarter", "")
        events.append({"id": event_id(company, day.isoformat()), "report_date": day.isoformat(), "report_at": None,
                       "quarter": quarter if re.fullmatch(r"Q[1-4] \d{4}", quarter) else None,
                       "date_status": "reported" if reported else "estimated" if "Estimated" in row["Date"] else "calendar",
                       "eps": eps, "revenue": revenue, "messages": [],
                       "report_url": report_url if report_url and safe_url(report_url) else None,
                       "sources": [{"label": "MarketBeat · résultats et consensus", "url": url}]})
    # A dated prior-year comparison provides a concrete message even when no call
    # summary is available. Do not compare across reporting currencies or bases.
    for event in events:
        if event["date_status"] != "reported" or not event["quarter"]:
            continue
        quarter, year = event["quarter"].split()
        prior = next((row for row in events if row["quarter"] == f"{quarter} {int(year) - 1}"), None)
        if prior and event["revenue"]["currency"] == prior["revenue"]["currency"]:
            actual, previous = event["revenue"]["actual"], prior["revenue"]["actual"]
            if actual is not None and previous is not None and previous > 0:
                growth = (actual / previous - 1) * 100
                event["messages"].append({"text": f"Revenus : {growth:+.1f} % par rapport au même trimestre un an plus tôt.".replace(".", ",", 1),
                                          "language": "fr", "source_url": url, "kind": "calculated"})
    return events


def parse_yahoo(text: str, company: str, symbol: str, url: str, now: datetime, reporting_currency: str | None) -> list[dict]:
    parser = TableParser()
    parser.feed(text)
    if not any(table["rows"] and "Earnings Date" in [clean(" ".join(cell)) for cell in table["rows"][0]] for table in parser.tables):
        raise SourceError("Calendrier Yahoo absent")
    today = now.astimezone(TORONTO).date()
    events = []
    for row in parser.records():
        if row.get("Symbol") != symbol or "Earnings Date" not in row:
            continue
        match = re.match(r"([A-Za-z]+ \d{1,2}, \d{4})(?: at (\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?|[AP]M)\s*(EST|EDT))?", row["Earnings Date"])
        if not match:
            continue
        day = datetime.strptime(match[1], "%B %d, %Y").date()
        report_at = None
        if match[2]:
            hour = int(match[2]) % 12 + (12 if match[4].lower().startswith("p") else 0)
            offset = -4 if match[5] == "EDT" else -5
            report_at = datetime(day.year, day.month, day.day, hour, int(match[3] or 0), tzinfo=timezone(timedelta(hours=offset))).astimezone(timezone.utc).isoformat()
        actual = number(row.get("Reported EPS", "")) if day <= today else None
        if report_at and datetime.fromisoformat(report_at) > now:
            actual = None
        events.append({"id": event_id(company, day.isoformat()), "report_date": day.isoformat(), "report_at": report_at,
                       "quarter": None, "date_status": "reported" if actual is not None else "calendar",
                       "eps": {"actual": actual, "estimate": number(row.get("EPS Estimate", "")), "currency": reporting_currency, "source_url": url},
                       "revenue": {"actual": None, "estimate": None, "currency": None, "source_url": url},
                       "messages": [], "report_url": None, "sources": [{"label": "Yahoo Finance · calendrier et BPA", "url": url}]})
    return events


def parse_topics(text: str, url: str) -> list[dict]:
    # Headings only: never publish the transcript or the provider's full summary.
    heading = re.search(r'<h[1-6][^>]*>\s*Key Takeaways\s*</h[1-6]>', text, re.I)
    if not heading:
        return []
    fragment = text[heading.end():]
    fragment = re.split(r"</(?:ul|ol)>", fragment, maxsplit=1)[0]
    topics = []
    for item in re.findall(r"<li\b[^>]*>([\s\S]*?)</li>", fragment):
        bold = re.findall(r"<(?:strong|b)\b[^>]*>([\s\S]*?)</(?:strong|b)>", item)
        for part in bold:
            title = clean(part).rstrip(":")
            if title and re.search(r"[A-Za-z]{3,}", title) and len(title.split()) >= 3 and not re.search(r"^(Positive|Negative|Neutral) Sentiment$", title, re.I) and len(title.split()) <= 12:
                sentiment = "negative" if "Negative Sentiment" in item else "neutral" if "Neutral Sentiment" in item else "positive"
                topics.append((title, sentiment))
                break
    # Include a caution when one is present, without replacing the words of the source.
    chosen = topics[:2]
    caution = next((topic for topic in topics[2:] if topic[1] in ("negative", "neutral")), None)
    if caution:
        chosen.append(caution)
    elif len(topics) > 2:
        chosen.append(topics[2])
    budget, result = 24, []
    for title, _ in chosen:
        words = len(title.split())
        if words <= budget:
            result.append({"text": title, "language": "en", "source_url": url, "kind": "call_topic"})
            budget -= words
    return result


def source_for(definition: dict) -> tuple[str, str, str, str | None]:
    identifier, symbol = definition["id"], definition["quote_symbol"]
    if identifier in US_LISTINGS:
        exchange, company = US_LISTINGS[identifier]
        return company, f"https://www.marketbeat.com/stocks/{exchange}/{company}/earnings/", company, "USD"
    if symbol.endswith((".TO", ".NE")):
        exchange = "CNSX" if symbol.endswith(".NE") else "TSE"
        return symbol, f"https://www.marketbeat.com/stocks/{exchange}/{identifier}/earnings/", symbol, None
    exchange = "NYSE" if identifier in NYSE else "NASDAQ"
    return symbol, f"https://www.marketbeat.com/stocks/{exchange}/{symbol}/earnings/", symbol, "USD"


def collect_company(definition: dict, now: datetime, start: date, end: date, fetcher=fetch_text) -> dict:
    company, marketbeat_url, calendar_symbol, report_currency = source_for(definition)
    yahoo_url = "https://finance.yahoo.com/calendar/earnings/?symbol=" + quote(calendar_symbol) + "&size=100"
    events, errors, successful = {}, [], 0
    try:
        for event in parse_marketbeat(fetcher(marketbeat_url), company, marketbeat_url, now):
            events[event["report_date"]] = event
        successful += 1
    except Exception as error:
        errors.append("MarketBeat: " + str(error)[:120])
    try:
        for event in parse_yahoo(fetcher(yahoo_url), company, calendar_symbol, yahoo_url, now, report_currency):
            previous = events.get(event["report_date"])
            if not previous:
                events[event["report_date"]] = event
            else:
                already_reported = previous["eps"]["actual"] is not None or previous["revenue"]["actual"] is not None
                incoming_reported = event["eps"]["actual"] is not None or event["revenue"]["actual"] is not None
                if incoming_reported or not already_reported:
                    previous["report_at"] = event["report_at"]
                # Only fill a missing EPS pair as a whole. Never mix currencies,
                # actuals and estimates from different providers or quarters.
                if (previous["eps"]["actual"] is None and event["eps"]["actual"] is not None) or (previous["eps"]["estimate"] is None and event["eps"]["estimate"] is not None and (previous["eps"]["actual"] is None or event["eps"]["actual"] is not None)):
                    previous["eps"] = event["eps"]
                if previous["eps"]["actual"] is not None or previous["revenue"]["actual"] is not None:
                    previous["date_status"] = "reported"
                elif previous["date_status"] == "reported":
                    previous["date_status"] = "calendar"
                known_urls = {source["url"] for source in previous["sources"]}
                previous["sources"].extend(source for source in event["sources"] if source["url"] not in known_urls)
                if previous["report_at"] and datetime.fromisoformat(previous["report_at"]) > now:
                    previous["eps"]["actual"] = previous["revenue"]["actual"] = None
                    previous["date_status"] = "estimated" if previous["date_status"] == "estimated" else "calendar"
                    previous["messages"] = []
        successful += 1
    except Exception as error:
        errors.append("Yahoo: " + str(error)[:120])
    if not successful:
        raise SourceError("; ".join(errors))
    retained = sorted((event for event in events.values() if start <= date.fromisoformat(event["report_date"]) <= end), key=lambda row: row["report_date"])
    # Report pages are specific to an issuer and a dated quarter. One report per
    # company is enough for the latest quarter; older cards retain numeric facts.
    latest = next((event for event in reversed(retained) if event["date_status"] == "reported" and event["report_url"]), None)
    if latest:
        try:
            topics = parse_topics(fetcher(latest["report_url"]), latest["report_url"])
            if topics:
                latest["messages"] = topics
        except Exception as error:
            errors.append("Compte rendu: " + str(error)[:120])
    return {"fetch_status": "fresh", "fetched_at": now.isoformat(), "company_symbol": company,
            "source_url": marketbeat_url, "events": retained, "source_warnings": errors}


def apply_reviewed_messages(feed: dict, highlights: dict) -> dict:
    for event in feed["events"]:
        if event["date_status"] != "reported":
            continue
        key = feed["company_symbol"] + ":" + event["report_date"]
        reviewed = highlights.get("reports", {}).get(key)
        if (not reviewed or reviewed.get("report_url", reviewed.get("source_url")) != event["report_url"] or not safe_url(reviewed["source_url"])
                or not isinstance(reviewed.get("messages"), list) or not 3 <= len(reviewed["messages"]) <= 4
                or any(not isinstance(text, str) or not text.strip() or len(text) > 450 for text in reviewed["messages"])):
            continue
        event["messages"] = [{"text": text, "language": "fr", "source_url": reviewed["source_url"], "kind": "reviewed_summary"} for text in reviewed["messages"]]
        if all(source["url"] != reviewed["source_url"] for source in event["sources"]):
            event["sources"].append({"label": "Source des messages clés", "url": reviewed["source_url"]})
    return feed


def validate_reviewed_highlights(payload: dict) -> int:
    if (not isinstance(payload, dict) or payload.get("schema_version") != 1
            or payload.get("kind") != "reviewed_earnings_highlights" or not isinstance(payload.get("reports"), dict)):
        raise SourceError("Format des analyses de résultats invalide")
    try:
        stamp = datetime.fromisoformat(payload["reviewed_at"].replace("Z", "+00:00"))
        if not stamp.tzinfo or stamp > datetime.now(timezone.utc) + timedelta(minutes=5):
            raise ValueError("Invalid review time")
    except (KeyError, TypeError, AttributeError, ValueError) as error:
        raise SourceError("Date de vérification des analyses invalide") from error
    for key, reviewed in payload["reports"].items():
        if (not re.fullmatch(r"[A-Z0-9][A-Z0-9.-]{0,29}:\d{4}-\d{2}-\d{2}", key)
                or not isinstance(reviewed, dict) or not safe_url(reviewed.get("source_url"))
                or reviewed.get("report_url") is not None and not safe_url(reviewed["report_url"])):
            raise SourceError("Analyse sans entreprise, date ou source précise")
        try:
            day = date.fromisoformat(key.rsplit(":", 1)[1])
            if day > datetime.now(TORONTO).date():
                raise ValueError("Future result")
        except ValueError as error:
            raise SourceError("Date de résultat invalide") from error
        messages = reviewed.get("messages")
        if (not isinstance(messages, list) or not 3 <= len(messages) <= 4
                or any(not isinstance(text, str) or not text.strip() or len(text) > 450 for text in messages)
                or len(set(messages)) != len(messages)):
            raise SourceError(f"{key} doit contenir trois ou quatre points distincts")
    return len(payload["reports"])


def collect(catalog: dict, previous: dict | None, now: datetime, fetcher=fetch_text, highlights: dict | None = None) -> dict:
    today = now.astimezone(TORONTO).date()
    monday = today - timedelta(days=today.weekday())
    start, end = monday - timedelta(weeks=12), monday + timedelta(weeks=5, days=6)
    instruments, tasks, errors = {}, {}, {}
    definitions = catalog["series"]
    # De-duplicate underlying issuers (e.g. CDR + US listing) before HTTP calls.
    with ThreadPoolExecutor(max_workers=5) as pool:
        companies = {}
        for definition in definitions:
            identifier = definition["id"]
            if identifier in ETFS:
                instruments[identifier] = {"fetch_status": "not_applicable", "fetched_at": now.isoformat(), "company_symbol": identifier,
                                           "source_url": definition["source_url"], "events": [], "source_warnings": []}
                continue
            company = source_for(definition)[0]
            companies.setdefault(company, []).append(definition)
        for company, group in companies.items():
            tasks[pool.submit(collect_company, group[0], now, start, end, fetcher)] = group
        for future in as_completed(tasks):
            group = tasks[future]
            try:
                feed = apply_reviewed_messages(future.result(), highlights or {})
                for definition in group:
                    instruments[definition["id"]] = {**feed, "listing_note": "Résultats de l’entreprise sous-jacente; devise des résultats indiquée séparément." if definition["quote_symbol"] != feed["company_symbol"] else None}
            except Exception as error:
                for definition in group:
                    identifier = definition["id"]
                    errors[identifier] = str(error)[:260]
                    old = (previous or {}).get("instruments", {}).get(identifier)
                    if old and old.get("fetch_status") in ("fresh", "cached") and old.get("fetched_at"):
                        retained = [event for event in old.get("events", []) if start.isoformat() <= event.get("report_date", "") <= end.isoformat()]
                        instruments[identifier] = apply_reviewed_messages({**old, "fetch_status": "cached", "events": retained}, highlights or {})
                    else:
                        instruments[identifier] = {"fetch_status": "unavailable", "fetched_at": None, "company_symbol": source_for(definition)[0],
                                                   "source_url": source_for(definition)[1], "events": [], "source_warnings": []}
    coverage = {status: sum(feed["fetch_status"] == status for feed in instruments.values()) for status in ("fresh", "cached", "unavailable", "not_applicable")}
    return {"schema_version": 1, "kind": "portfolio_earnings", "generated_at": now.isoformat(), "timezone": "America/Toronto",
            "window": {"start": start.isoformat(), "end": end.isoformat()}, "coverage": {"total": len(definitions), **coverage},
            "methodology": METHODOLOGY,
            "instruments": dict(sorted(instruments.items())), "errors": errors}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, default=ROOT / "data")
    parser.add_argument("--apply-reviewed-only", action="store_true", help="Apply verified editorial notes without fetching or changing financial metrics")
    parser.add_argument("--validate-reviewed", action="store_true", help="Validate the three-to-four-point editorial contract without writing data")
    args = parser.parse_args()
    destination = args.output_dir / "portfolio-earnings.json"
    previous = read_json(destination) if destination.exists() else None
    highlights_path = ROOT / "data/earnings-highlights.json"
    highlights = read_json(highlights_path) if highlights_path.exists() else {}
    if highlights:
        reviewed_count = validate_reviewed_highlights(highlights)
    else:
        reviewed_count = 0
    if args.validate_reviewed:
        print(f"Validated {reviewed_count} dated earnings analyses with three or four points each.")
        return
    if args.apply_reviewed_only:
        if not previous or not isinstance(previous.get("instruments"), dict):
            raise SourceError("A collected public earnings file is required")
        for feed in previous["instruments"].values():
            apply_reviewed_messages(feed, highlights)
        previous["analysis_reviewed_at"] = highlights.get("reviewed_at")
        previous["methodology"] = METHODOLOGY
        atomic_write_json(destination, previous)
        print("Reviewed earnings analyses applied; financial metrics and collection timestamps unchanged.")
        return
    payload = collect(read_json(ROOT / "data/securities.json"), previous, datetime.now(timezone.utc), highlights=highlights)
    atomic_write_json(destination, payload)
    print("Earnings coverage:", payload["coverage"])
    print("Dated earnings events:", sum(len(feed["events"]) for feed in payload["instruments"].values()))
    for identifier, error in payload["errors"].items():
        print(identifier, error)


if __name__ == "__main__":
    main()
