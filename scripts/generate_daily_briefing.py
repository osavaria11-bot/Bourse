#!/usr/bin/env python3
"""Generate a static market briefing JSON for GitHub Pages.

The briefing is generated server-side by GitHub Actions and committed as
`data/daily-briefing.json` so the front-end only reads a static file.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

OUTPUT_PATH = Path("data/daily-briefing.json")
TIMEOUT_SECONDS = 30

FRED_SERIES = {
    "UNRATE": "chômage américain",
    "DFF": "taux directeur de la Fed",
    "DGS10": "taux américain à 10 ans",
    "SP500": "S&P 500",
    "VIXCLS": "VIX",
    "DEXCAUS": "CAD/USD",
    "IR3TIB01CAM156N": "taux court canadien",
    "DTWEXBGS": "indice large du dollar",
}

NEWS_SOURCES = [
    {
        "label": "Reuters — Econ World",
        "url": "https://www.reuters.com/markets/econ-world/",
        "description": "Actualités macro mondiales (croissance, inflation, banques centrales).",
    },
    {
        "label": "Reuters — U.S. Markets",
        "url": "https://www.reuters.com/markets/us/",
        "description": "Un focus sur les marchés américains (indices, actions, Fed).",
    },
    {
        "label": "Bank of Canada — Daily Digest",
        "url": "https://www.bankofcanada.ca/rates/daily-digest/",
        "description": "Point quotidien officiel de la Banque du Canada.",
    },
    {
        "label": "Reuters — Global Markets",
        "url": "https://www.reuters.com/markets/",
        "description": "Vue globale actions, obligations, devises et matières premières.",
    },
    {
        "label": "Reuters — Business",
        "url": "https://www.reuters.com/business/",
        "description": "Actualité entreprises, secteurs et réglementation.",
    },
]


class SourceError(RuntimeError):
    """Raised when a source cannot be fetched or parsed."""


def fetch_text(url: str) -> str:
    req = Request(url, headers={"User-Agent": "BourseBriefingBot/2.0"})
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
    current = float(value)
    previous = float(valid[-2][1]) if len(valid) > 1 else None
    return {
        "id": series_id,
        "label": FRED_SERIES[series_id],
        "date": date,
        "value": current,
        "previous_value": previous,
    }


def describe_change(current: float, previous: float | None, unit: str = "") -> str:
    suffix = f" {unit}" if unit else ""
    if previous is None:
        return f"{current:.2f}{suffix}"

    delta = current - previous
    if abs(delta) < 1e-9:
        trend = "stable"
    elif delta > 0:
        trend = "en hausse"
    else:
        trend = "en baisse"
    return f"{current:.2f}{suffix} ({trend} de {abs(delta):.2f}{suffix})"


def build_paragraph(points: dict[str, dict]) -> str:
    return (
        "Ce matin, le tableau macro-financier reste partagé : "
        f"le chômage américain ressort à {describe_change(points['UNRATE']['value'], points['UNRATE']['previous_value'], 'pts')}, "
        f"le taux directeur de la Fed à {describe_change(points['DFF']['value'], points['DFF']['previous_value'], 'pts')} "
        f"et le 10 ans américain à {describe_change(points['DGS10']['value'], points['DGS10']['previous_value'], 'pts')}; "
        f"côté actifs, le S&P 500 évolue à {describe_change(points['SP500']['value'], points['SP500']['previous_value'])} "
        f"avec un VIX à {describe_change(points['VIXCLS']['value'], points['VIXCLS']['previous_value'])}, "
        f"tandis que le CAD/USD se situe à {describe_change(points['DEXCAUS']['value'], points['DEXCAUS']['previous_value'])} "
        f"et le taux court canadien à {describe_change(points['IR3TIB01CAM156N']['value'], points['IR3TIB01CAM156N']['previous_value'], 'pts')}; "
        f"en toile de fond, l'indice large du dollar est à {describe_change(points['DTWEXBGS']['value'], points['DTWEXBGS']['previous_value'])}, "
        "ce qui confirme un marché encore guidé par la sensibilité aux taux et aux devises."
    )


def collect_sources() -> tuple[str, list[dict]]:
    points = {series_id: fetch_fred_latest(series_id) for series_id in FRED_SERIES}
    paragraph = build_paragraph(points)
    snapshot = [points[sid] for sid in FRED_SERIES]
    return paragraph, snapshot


def main() -> None:
    previous_payload = None
    if OUTPUT_PATH.exists():
        try:
            previous_payload = json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            previous_payload = None

    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    try:
        paragraph, snapshot = collect_sources()
    except Exception as exc:
        print(f"Source collection failed: {exc}")
        if previous_payload:
            fallback_payload = {
                **previous_payload,
                "generated_at": generated_at,
                "update_status": f"stale_data_kept: {exc}",
                "news_digest_note": previous_payload.get(
                    "news_digest_note",
                    "Liens de veille à consulter chaque jour dans le dashboard.",
                ),
                "news_sources": previous_payload.get("news_sources", NEWS_SOURCES),
            }
            OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
            OUTPUT_PATH.write_text(
                json.dumps(fallback_payload, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            print("Wrote fallback payload with previous valid data.")
            return
        raise

    payload = {
        "generated_at": generated_at,
        "last_successful_update": generated_at,
        "briefing_paragraph": paragraph,
        "news_digest_note": "Liens de veille à consulter chaque jour dans le dashboard.",
        "news_sources": NEWS_SOURCES,
        "series_snapshot": snapshot,
        "data_provider": "FRED (Federal Reserve Bank of St. Louis)",
        "update_status": "fresh_data",
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
