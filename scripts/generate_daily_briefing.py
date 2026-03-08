#!/usr/bin/env python3
"""Generate a static daily briefing JSON for GitHub Pages.

Design goals:
- No API key required.
- Collect data server-side in GitHub Actions (never from browser).
- Keep last valid briefing file if any source fails during a run.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

OUTPUT_PATH = Path("data/daily-briefing.json")
TIMEOUT_SECONDS = 30

FRED_SERIES = {
    "UNRATE": "Chômage US",
    "DFF": "Fed Funds",
    "DGS10": "Taux US 10 ans",
    "SP500": "S&P 500",
    "VIXCLS": "VIX",
    "DEXCAUS": "CAD/USD",
    "IR3TIB01CAM156N": "Taux court terme Canada",
    "DTWEXBGS": "Indice dollar (broad)",
}

FALLBACK_SOURCES = [
    {"label": "FRED — indicateurs macro & marchés", "url": "https://fred.stlouisfed.org/"},
    {"label": "Bank of Canada — taux directeur", "url": "https://www.bankofcanada.ca/core-functions/monetary-policy/key-interest-rate/"},
    {"label": "Reuters Markets News", "url": "https://www.reuters.com/markets/"},
]


class SourceError(RuntimeError):
    """Raised when a source cannot be fetched or parsed."""


def fetch_text(url: str) -> str:
    req = Request(url, headers={"User-Agent": "BourseBriefingBot/1.0"})
    with urlopen(req, timeout=TIMEOUT_SECONDS) as response:  # noqa: S310
        return response.read().decode("utf-8", errors="replace")


def fetch_fred_latest(series_id: str) -> dict:
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?{urlencode({'id': series_id})}"
    csv_text = fetch_text(url)
    lines = [line.strip() for line in csv_text.splitlines() if line.strip()]
    if len(lines) < 2:
        raise SourceError(f"FRED {series_id}: CSV vide")

    rows = [line.split(",", 1) for line in lines[1:]]
    valid = [(d, v) for d, v in rows if v and v != "."]
    if not valid:
        raise SourceError(f"FRED {series_id}: aucune valeur valide")

    date, value = valid[-1]
    prev_value = float(valid[-2][1]) if len(valid) > 1 else None
    current = float(value)
    return {
        "id": series_id,
        "label": FRED_SERIES[series_id],
        "date": date,
        "value": current,
        "previous_value": prev_value,
    }


def build_change_text(point: dict) -> str:
    value = point["value"]
    previous = point.get("previous_value")
    if previous is None:
        return f"{value:.2f} (pas de comparaison disponible)"
    delta = value - previous
    direction = "en hausse" if delta > 0 else "en baisse" if delta < 0 else "stable"
    return f"{value:.2f} ({direction}, {delta:+.2f})"


def fetch_top_news() -> dict:
    # RSS public sans clé API.
    xml_text = fetch_text("https://feeds.marketwatch.com/marketwatch/topstories/")
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        raise SourceError("Flux news invalide") from exc

    item = root.find("./channel/item")
    if item is None:
        raise SourceError("Aucune news dans le flux")

    title = (item.findtext("title") or "").strip()
    link = (item.findtext("link") or "").strip()
    pub_date = (item.findtext("pubDate") or "").strip()
    if not title or not link:
        raise SourceError("News incomplète")

    return {"title": title, "url": link, "published_at": pub_date}


def collect_all_sources() -> tuple[dict, list[dict], dict]:
    points = {series_id: fetch_fred_latest(series_id) for series_id in FRED_SERIES}
    news = fetch_top_news()

    sections = {
        "macro": (
            "Macro: "
            f"chômage US {build_change_text(points['UNRATE'])}; "
            f"Fed Funds {build_change_text(points['DFF'])}; "
            f"taux US 10 ans {build_change_text(points['DGS10'])}."
        ),
        "us_market": (
            "Marché USA: "
            f"S&P 500 {build_change_text(points['SP500'])}; "
            f"VIX {build_change_text(points['VIXCLS'])}."
        ),
        "cad_market": (
            "Marché CAD: "
            f"CAD/USD {build_change_text(points['DEXCAUS'])}; "
            f"taux court terme Canada {build_change_text(points['IR3TIB01CAM156N'])}."
        ),
        "international_market": (
            "Marché international: "
            f"indice dollar broad {build_change_text(points['DTWEXBGS'])}; "
            "surveillez l'impact FX/taux sur les actifs hors USA."
        ),
        "top_news": f"Nouvelle clé: {news['title']} ({news['url']}).",
    }

    ordered_snapshot = [points[sid] for sid in FRED_SERIES]
    return sections, ordered_snapshot, news


def main() -> None:
    previous_payload = None
    if OUTPUT_PATH.exists():
        try:
            previous_payload = json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            previous_payload = None

    try:
        sections, snapshot, news = collect_all_sources()
    except Exception as exc:  # Keep last valid file untouched.
        print(f"Source collection failed: {exc}")
        if previous_payload:
            print("Keeping existing data/daily-briefing.json (last valid version).")
            return
        raise

    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    payload = {
        "generated_at": generated_at,
        "last_successful_update": generated_at,
        "summary": sections["macro"],
        "highlights": [
            sections["us_market"],
            sections["cad_market"],
            sections["international_market"],
            sections["top_news"],
        ],
        "sections": sections,
        "series_snapshot": snapshot,
        "top_news": news,
        "fallback_sources": FALLBACK_SOURCES,
        "snapshot_status": {
            "live_points": len(snapshot),
            "series_count": len(snapshot),
            "using_cached_snapshot": False,
            "cached_snapshot_generated_at": None,
        },
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
