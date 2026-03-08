#!/usr/bin/env python3
"""Generate a daily market briefing JSON consumed by index.html.

- Pulls latest values from selected FRED series.
- Builds a deterministic summary fallback.
- If OPENAI_API_KEY is available, asks OpenAI for a richer French briefing.
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

SERIES = [
    ("UNRATE", "Chômage US"),
    ("DFF", "Fed Funds"),
    ("DGS10", "Taux US 10 ans"),
    ("BAMLH0A0HYM2", "Spread High Yield"),
    ("VIXCLS", "VIX"),
    ("T10Y2Y", "Spread 10Y-2Y"),
]

OUTPUT_PATH = Path("data/daily-briefing.json")
MODEL = os.getenv("OPENAI_MODEL", "gpt-5-mini")


def fetch_csv(series_id: str) -> str:
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?{urlencode({'id': series_id})}"
    req = Request(url, headers={"User-Agent": "BourseBriefing/1.0"})
    with urlopen(req, timeout=30) as response:  # noqa: S310
        return response.read().decode("utf-8", errors="replace")


def parse_latest_and_previous(csv_text: str) -> tuple[str, float, float | None]:
    lines = [line.strip() for line in csv_text.strip().splitlines() if line.strip()]
    rows = [line.split(",", 1) for line in lines[1:]]
    valid = [(d, v) for d, v in rows if v not in {".", "", None}]
    if not valid:
        raise ValueError("No valid points")

    date, value = valid[-1]
    prev_value = float(valid[-2][1]) if len(valid) > 1 else None
    return date, float(value), prev_value


def deterministic_briefing(snapshot: list[dict]) -> tuple[str, list[str]]:
    bullets: list[str] = []
    if not snapshot:
        return (
            "Briefing automatique du jour indisponible (sources de données non accessibles).",
            [
                "Aucune série FRED n'a pu être lue pendant cette exécution.",
                "Le workflow GitHub réessaiera automatiquement à la prochaine exécution.",
            ],
        )

    for item in snapshot:
        value = item["value"]
        prev = item.get("previous_value")
        if prev is None:
            change_txt = "pas de comparaison disponible"
        else:
            delta = value - prev
            direction = "hausse" if delta > 0 else "baisse" if delta < 0 else "stable"
            change_txt = f"{direction} ({delta:+.2f})"
        bullets.append(f"{item['label']}: {value:.2f}, {change_txt}.")

    summary = (
        "Briefing automatique du jour basé sur les dernières impressions FRED "
        "(lecture rapide macro + risque marché)."
    )
    return summary, bullets


def ai_briefing(snapshot: list[dict]) -> tuple[str, list[str]] | None:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return None

    prompt = {
        "generated_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "snapshot": snapshot,
        "instruction": (
            "Rédige un briefing marché en français, ton professionnel, 1 paragraphe max puis 4 puces max. "
            "N'invente pas de données au-delà du snapshot."
        ),
    }

    body = {
        "model": MODEL,
        "input": [
            {
                "role": "user",
                "content": [{"type": "input_text", "text": json.dumps(prompt, ensure_ascii=False)}],
            }
        ],
    }

    req = Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urlopen(req, timeout=60) as response:  # noqa: S310
            payload = json.loads(response.read().decode("utf-8"))
    except URLError:
        return None

    text = payload.get("output_text", "").strip()
    if not text:
        return None

    lines = [line.strip("-• ") for line in text.splitlines() if line.strip()]
    summary = lines[0]
    highlights = lines[1:5]
    return summary, highlights


def main() -> None:
    snapshot: list[dict] = []

    for series_id, label in SERIES:
        try:
            csv_text = fetch_csv(series_id)
            date, value, prev = parse_latest_and_previous(csv_text)
            snapshot.append(
                {
                    "id": series_id,
                    "label": label,
                    "date": date,
                    "value": value,
                    "previous_value": prev,
                }
            )
        except Exception:
            snapshot.append(
                {
                    "id": series_id,
                    "label": label,
                    "date": None,
                    "value": None,
                    "previous_value": None,
                }
            )

    valid_snapshot = [item for item in snapshot if isinstance(item.get("value"), (int, float))]
    summary, highlights = deterministic_briefing(valid_snapshot)
    ai_output = ai_briefing(valid_snapshot)
    if ai_output:
        summary, highlights = ai_output

    data = {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "summary": summary,
        "highlights": highlights,
        "series_snapshot": snapshot,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
