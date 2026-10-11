#!/usr/bin/env python3
"""Collect dated headline metadata for the public catalogue, never private holdings.

Public RSS feeds and Yahoo Finance metadata only. No article bodies, credentials,
paywall extraction or personal positions are used. Selection by weight happens locally.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import unicodedata
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen

try:
    from .generate_daily_briefing import atomic_write_json, read_json, SourceError
except ImportError:
    from generate_daily_briefing import atomic_write_json, read_json, SourceError

ROOT = Path(__file__).resolve().parents[1]
MAX_DAYS = 7
PUBLISHERS = {
    "reuters.com": "Reuters", "ft.com": "Financial Times", "wsj.com": "The Wall Street Journal",
    "nytimes.com": "The New York Times", "bloomberg.com": "Bloomberg", "cnbc.com": "CNBC",
    "finance.yahoo.com": "Yahoo Finance", "marketwatch.com": "MarketWatch", "barrons.com": "Barron’s",
    "apnews.com": "Associated Press", "theglobeandmail.com": "The Globe and Mail",
    "financialpost.com": "Financial Post", "lapresse.ca": "La Presse", "lesaffaires.com": "Les Affaires",
    "businesswire.com": "Business Wire", "globenewswire.com": "GlobeNewswire",
    "prnewswire.com": "PR Newswire", "newswire.ca": "Newswire",
}
ALIASES = {
    "ATD": ["Alimentation Couche-Tard", "Couche-Tard"], "BAM": ["Brookfield Asset Management"],
    "BN": ["Brookfield Corporation", "Brookfield"], "BMO": ["Bank of Montreal", "BMO"],
    "BNS": ["Scotiabank", "Bank of Nova Scotia"], "CM": ["CIBC", "Canadian Imperial Bank"],
    "CNR": ["Canadian National Railway", "CN Rail"], "CP": ["Canadian Pacific Kansas City", "CPKC"],
    "CSU": ["Constellation Software"], "DSG": ["Descartes Systems", "Descartes"],
    "DOL": ["Dollarama"], "ENB": ["Enbridge"], "EQB": ["EQB", "Equitable Bank"],
    "FEQT": ["Fidelity All-in-One Equity", "FEQT"], "GOOGL": ["Alphabet", "Google"],
    "GRGD": ["Groupe Dynamite", "Dynamite Group"], "GSY": ["goeasy"],
    "L": ["Loblaw", "Loblaws"], "MAXQ": ["Maritime Launch"], "MFC": ["Manulife"],
    "META": ["Meta Platforms", "Meta"], "NVO": ["Novo Nordisk"], "NU": ["Nu Holdings", "Nubank"],
    "NVDA": ["Nvidia"], "POW": ["Power Corporation"], "PRL": ["Propel Holdings"],
    "QQC": ["CI Invesco NASDAQ 100", "QQC"], "RY": ["Royal Bank of Canada", "RBC"],
    "SNDK": ["Sandisk"], "SNDKUS": ["Sandisk"], "SLF": ["Sun Life"], "T": ["Telus"],
    "TD": ["Toronto-Dominion", "TD Bank"], "TSM": ["Taiwan Semiconductor", "TSMC"],
    "V": ["Visa Inc", "Visa"], "VNP": ["5N Plus"], "WCN": ["Waste Connections"],
}


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]*>", " ", text))).strip()


def folded(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()).strip()


def https_url(value: str) -> str | None:
    try:
        url = urlsplit(value)
        if url.scheme == "https" and url.hostname and not url.username and not url.password:
            return urlunsplit((url.scheme, url.netloc, url.path, url.query, ""))
    except (ValueError, TypeError):
        pass
    return None


def publisher_for(url: str) -> str | None:
    host = (urlsplit(url).hostname or "").lower()
    return next((label for domain, label in PUBLISHERS.items() if host == domain or host.endswith("." + domain)), None)


def aliases_for(definition: dict) -> list[str]:
    return ALIASES.get(definition["id"], [re.sub(r"\s*\([^)]*\)", "", definition["title"]).strip()])


def mentions(title: str, definition: dict) -> bool:
    text = " " + folded(title) + " "
    found = any(" " + folded(alias) + " " in text for alias in aliases_for(definition))
    symbol = definition["quote_symbol"].split(".")[0]
    # Short symbols such as V, T, L and CM must be explicitly presented as tickers.
    found = found or bool(re.search(r"\((?:NYSE:|NASDAQ:|TSX:)?\s*" + re.escape(symbol) + r"(?:\.TO|\.NE)?\)", title, re.I))
    if definition["id"] == "V" and found:
        return bool(re.search(r"\bVisa\s*(?:Inc|\(V\))|\b(?:payments?|cards?|shares?|stock|dividend|earnings)\b", title, re.I))
    return found


def event_for(title: str) -> str:
    text = folded(title)
    if re.search(r"earnings release date|results release date|date.*results|date.*earnings|calendrier.*resultats|date.*resultats|announces.*earnings.*date|to (announce|report|release).*results|to (hold|host).*results|will (hold|report|release).*results", text):
        return "earnings_calendar"
    if re.search(r"\b(guidance|outlook|forecasts?|previsions|perspectives)\b", text):
        return "guidance"
    if re.search(r"\b(earnings|results|profits?|quarterly|eps|resultats|benefices|trimestriel)\b", text):
        return "earnings"
    if re.search(r"\b(acquire|acquires|acquisition|merger|takeover|deal|contract|ipo|offering|contrat|fusion|rachat)\b", text):
        return "deal"
    if re.search(r"\b(regulator|antitrust|probe|lawsuit|approval|investigation|fda|tariffs?|reglementation|enquete|poursuite|sanction)\b", text):
        return "regulatory"
    if re.search(r"\b(dividend|buyback|distribution|dividende)\b", text):
        return "dividend"
    if re.search(r"\b(revenue|sales|production|investment|investments|factory|plants?|launch|chip|chips|hiring|layoffs|ai|appoints|ventes|usine|investissement|lancement)\b", text):
        return "operations"
    return "market"


def story(title: str, source_url: str, publisher_url: str, published: datetime, definition: dict, now: datetime) -> dict | None:
    title = clean(title)
    source_url, publisher_url = https_url(source_url), https_url(publisher_url)
    publisher = publisher_for(publisher_url) if publisher_url else None
    if (not title or not source_url or not publisher_url or not publisher or not mentions(title, definition)
            or not published.tzinfo or published > now or published < now - timedelta(days=MAX_DAYS)):
        return None
    # Exclude evergreen stock-picking/calculator headlines from a dated event watch.
    if re.search(r"undervalued|overvalued|stocks? to buy|should you buy|is .+ a buy|what .+ invested|how much.*worth|investment in.*years? ago|billionaire.*dumped|price prediction|price forecast|price target|best .+ stocks|stock price today|stock quote|latest stock news|stock news.*headlines|options chain|company profile|valuation measures|financial statistics|historical data|analyst ratings|estimates.*forecasts|\?", title, re.I):
        return None
    event = event_for(title)
    if event == "market":
        return None  # Generic quote pages and evergreen commentary are not company events.
    identity = hashlib.sha256(folded(title).encode()).hexdigest()[:16]
    words = title.split()
    display_title = " ".join(words[:25]) + ("…" if len(words) > 25 else "")
    if len(display_title) > 340:
        display_title = display_title[:337].rsplit(" ", 1)[0] + "…"
    return {"id": identity, "title": display_title, "publisher": publisher, "publisher_url": publisher_url,
            "source_url": source_url, "published_at": published.astimezone(timezone.utc).isoformat(),
            "event": event}


def parse_rss(text: str, definition: dict, now: datetime) -> list[dict]:
    try:
        root = ET.fromstring(text)
    except ET.ParseError as exc:
        raise SourceError("Flux RSS invalide") from exc
    if root.tag != "rss" or root.find("channel") is None:
        raise SourceError("Flux RSS absent")
    results = {}
    for item in root.findall("./channel/item"):
        source = item.find("source")
        if source is None:
            continue
        title = item.findtext("title", "")
        suffix = " - " + (source.text or "")
        if title.endswith(suffix):
            title = title[:-len(suffix)]
        try:
            published = parsedate_to_datetime(item.findtext("pubDate", ""))
        except (ValueError, TypeError, OverflowError):
            continue
        row = story(title, item.findtext("link", ""), source.attrib.get("url", ""), published, definition, now)
        if row:
            results.setdefault(row["id"], row)
    return sorted(results.values(), key=lambda row: row["published_at"], reverse=True)[:12]


def parse_yahoo(text: str, definition: dict, now: datetime) -> list[dict]:
    try:
        payload = json.loads(text)
    except ValueError as exc:
        raise SourceError("Métadonnées Yahoo invalides") from exc
    if not isinstance(payload.get("news"), list):
        raise SourceError("Métadonnées Yahoo absentes")
    results = {}
    for item in payload["news"]:
        if not isinstance(item, dict) or item.get("type") != "STORY":
            continue
        publisher = str(item.get("publisher", "")).casefold().replace(".com", "")
        domain = next((domain for domain, label in PUBLISHERS.items() if publisher in (label.casefold(), domain.replace(".com", ""))), None)
        if not domain:
            continue
        try:
            published = datetime.fromtimestamp(item["providerPublishTime"], timezone.utc)
        except (KeyError, ValueError, TypeError, OverflowError):
            continue
        row = story(item.get("title", ""), item.get("link", ""), "https://" + domain + "/", published, definition, now)
        if row:
            results.setdefault(row["id"], row)
    return sorted(results.values(), key=lambda row: row["published_at"], reverse=True)[:12]


def fetch_text(url: str) -> str:
    req = Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; SavyPortfolioWatch/1.0)", "Accept": "application/rss+xml, application/json, text/xml"})
    with urlopen(req, timeout=20) as response:
        return response.read(2_000_000).decode("utf-8-sig")


def feed_url(definition: dict) -> str:
    terms = " OR ".join('"' + alias.replace('"', "") + '"' for alias in aliases_for(definition))
    publishers = " OR ".join("site:" + domain for domain in PUBLISHERS)
    return "https://news.google.com/rss/search?" + urlencode({"q": f"({terms}) when:{MAX_DAYS}d ({publishers})", "hl": "en-US", "gl": "US", "ceid": "US:en"})


def fetch_instrument(definition: dict, now: datetime, fetcher=fetch_text) -> dict:
    url = feed_url(definition)
    errors = []
    try:
        rows = parse_rss(fetcher(url), definition, now)
    except Exception as exc:
        rows = None
        errors.append(type(exc).__name__)
    if not rows:
        # Dual listings and Canadian ETFs often have no Yahoo symbol news;
        # the company name fallback is still checked against the exact headline.
        query = aliases_for(definition)[0]
        yahoo = "https://query1.finance.yahoo.com/v1/finance/search?" + urlencode({"q": query, "newsCount": 40, "quotesCount": 0})
        try:
            fallback = parse_yahoo(fetcher(yahoo), definition, now)
            rows = fallback or rows or []
        except Exception as exc:
            errors.append(type(exc).__name__)
    if rows is None:
        raise SourceError("Sources d’actualités indisponibles : " + ", ".join(errors))
    return {"fetch_status": "fresh", "fetched_at": now.isoformat(), "source_url": url, "items": rows}


def collect(definitions: list[dict], previous: dict | None, now: datetime, fetcher=fetch_instrument) -> dict:
    old = (previous or {}).get("instruments", {}); instruments = {}; errors = []
    with ThreadPoolExecutor(max_workers=5) as executor:
        jobs = {executor.submit(fetcher, definition, now): definition for definition in definitions}
        for job in as_completed(jobs):
            definition = jobs[job]; symbol = definition["id"]
            try:
                instruments[symbol] = job.result()
            except Exception as exc:
                errors.append({"id": symbol, "message": str(exc)[:150]})
                cached = old.get(symbol, {})
                kept = []
                for item in cached.get("items", []):
                    try:
                        stamp = datetime.fromisoformat(item["published_at"].replace("Z", "+00:00"))
                        if now - timedelta(days=MAX_DAYS) <= stamp <= now:
                            kept.append(item)
                    except (KeyError, ValueError, TypeError):
                        continue
                instruments[symbol] = {"fetch_status": "cached" if kept else "unavailable", "fetched_at": cached.get("fetched_at"),
                                       "source_url": feed_url(definition), "items": kept}
    instruments = {definition["id"]: instruments[definition["id"]] for definition in definitions}
    counts = {status: sum(feed["fetch_status"] == status for feed in instruments.values()) for status in ("fresh", "cached", "unavailable")}
    return {"schema_version": 1, "kind": "portfolio_news", "generated_at": now.isoformat(), "timezone": "America/Toronto",
            "lookback_days": MAX_DAYS, "coverage": {"total": len(definitions), **counts}, "errors": sorted(errors, key=lambda row: row["id"]),
            "method": "Titres originaux et heures de publication issus de flux publics; sources reconnues, association par nom d’entreprise, sans texte intégral. Classement local selon les événements, la récence et les poids du portefeuille.",
            "instruments": instruments}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "data")
    args = parser.parse_args()
    definitions = read_json(ROOT / "data/securities.json")["series"]
    target = args.output_dir / "portfolio-news.json"
    dataset = collect(definitions, read_json(target), datetime.now(timezone.utc))
    atomic_write_json(target, dataset, compact=True)
    print("Actualités du catalogue public :", dataset["coverage"], "; articles :", sum(len(feed["items"]) for feed in dataset["instruments"].values()))
    for error in dataset["errors"]:
        print(f"::warning::{error['id']}: {error['message']}")


if __name__ == "__main__":
    main()
