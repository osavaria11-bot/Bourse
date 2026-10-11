#!/usr/bin/env python3
"""Collect dated, market-implied next-meeting odds from public source pages."""
from __future__ import annotations

import argparse
import re
from datetime import date, datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

try:
    from scripts import generate_daily_briefing as macro
except ModuleNotFoundError:
    import generate_daily_briefing as macro

ROOT = Path(__file__).resolve().parents[1]
SOURCES = {
    "fed": ("Fed", "SOFR OIS", "https://www.bluegamma.io/central-banks/central-bank-interest-rate-forecasts/federal-reserve-interest-rate-forecast"),
    "canada": ("Banque du Canada", "CORRA OIS", "https://www.bluegamma.io/central-banks/central-bank-interest-rate-forecasts/the-bank-of-canada-interest-rate-forecast"),
}

class VisibleText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.hidden = 0
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "svg"):
            self.hidden += 1

    def handle_endtag(self, tag):
        if tag in ("script", "style", "svg") and self.hidden:
            self.hidden -= 1

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)

def parse_page(raw: str, key: str, today: date) -> dict:
    parser = VisibleText()
    parser.feed(raw)
    visible = " ".join(parser.parts)
    meeting = re.search(r"Next meeting:\s*(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})", visible)
    dated = re.search(r"As of\s+(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})\s*,\s*overnight index swap pricing", visible)
    odds = re.search(r"Hike\s*(\d{1,3})%\s*Hold\s*(\d{1,3})%\s*Cut\s*(\d{1,3})%", visible)
    if not (meeting and dated and odds):
        raise macro.SourceError(f"{key}: probabilités ou dates introuvables")
    meeting_date = datetime.strptime(meeting.group(1), "%d %b %Y").date()
    as_of = datetime.strptime(dated.group(1), "%d %b %Y").date()
    hike, hold, cut = map(int, odds.groups())
    if not (as_of <= today < meeting_date and 0 <= (today - as_of).days <= 7 and
            all(0 <= n <= 100 for n in (hike, hold, cut)) and 99 <= hike + hold + cut <= 101):
        raise macro.SourceError(f"{key}: date ou probabilités incohérentes")
    label, methodology, url = SOURCES[key]
    return {"id": key, "label": label, "meeting_date": meeting_date.isoformat(),
            "as_of": as_of.isoformat(), "hike": hike, "hold": hold, "cut": cut,
            "source": "BlueGamma", "source_url": url, "methodology": methodology, "status": "fresh"}

def collect(previous: dict | None, now: datetime, fetcher=None) -> dict:
    today = now.date()
    old = {point.get("id"): point for point in (previous or {}).get("decisions", []) if isinstance(point, dict)}
    decisions = []
    for key, (_, methodology, url) in SOURCES.items():
        try:
            decisions.append(parse_page((fetcher or macro.fetch_text)(url), key, today))
        except Exception as error:
            cached = old.get(key)
            # Preserve the actual observation date; the client hides old or past-meeting odds.
            if cached and cached.get("source_url") == url:
                decisions.append({**cached, "status": "cached", "error": str(error)[:160]})
            else:
                decisions.append({"id": key, "label": SOURCES[key][0], "meeting_date": None,
                                  "as_of": None, "hike": None, "hold": None, "cut": None,
                                  "source": "BlueGamma", "source_url": url,
                                  "methodology": methodology, "status": "unavailable"})
    return {"schema_version": 1, "kind": "rate_odds", "generated_at": now.isoformat(),
            "decisions": decisions}

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "data")
    args = parser.parse_args(argv)
    path = args.output_dir / "rate-odds.json"
    now = datetime.now(timezone.utc)
    result = collect(macro.read_json(path), now)
    macro.atomic_write_json(path, result)
    print("Rate odds:", [(p["id"], p["as_of"], p["status"]) for p in result["decisions"]])

if __name__ == "__main__":
    main()
