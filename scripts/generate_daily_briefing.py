#!/usr/bin/env python3
"""Generate a daily market briefing JSON consumed by index.html.

- Pulls latest values from selected FRED series.
- Builds a deterministic 5-paragraph briefing fallback.
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


def deterministic_briefing(snapshot: list[dict]) -> dict[str, str]:
    if not snapshot:
        unavailable = (
            "Briefing automatique indisponible: les sources de données n'ont pas pu être lues "
            "pendant cette exécution."
        )
        return {
            "macro": unavailable,
            "us_market": unavailable,
            "cad_market": unavailable,
            "international_market": unavailable,
            "top_news": "Aucune nouvelle prioritaire ne peut être qualifiée sans données fiables aujourd'hui.",
        }

    details: list[str] = []
    for item in snapshot[:4]:
        value = item["value"]
        prev = item.get("previous_value")
        if prev is None:
            change_txt = "pas de comparaison disponible"
        else:
            delta = value - prev
            direction = "hausse" if delta > 0 else "baisse" if delta < 0 else "stable"
            change_txt = f"{direction} ({delta:+.2f})"
        details.append(f"{item['label']}: {value:.2f}, {change_txt}")

    macro = (
        "Sur le plan macro, les dernières impressions FRED donnent un régime de croissance "
        "encore résilient mais sensible aux conditions financières, avec "
        + "; ".join(details)
        + "."
    )
    us_market = (
        "Pour le marché USA, la combinaison taux-risque reste le facteur directeur: l'évolution "
        "du 10 ans, du spread High Yield et du VIX suggère une lecture sélective du risque "
        "et un biais prudent sur les actifs les plus sensibles au coût du capital."
    )
    cad_market = (
        "Pour le marché canadien, en l'absence de séries domestiques directes dans ce run, la "
        "transmission principale vient des conditions US (taux et prime de risque), ce qui milite "
        "pour surveiller surtout les secteurs cycliques et financiers."
    )
    international_market = (
        "À l'international, le signal dominant reste la direction des taux américains et de la "
        "volatilité implicite, qui continue d'orienter l'appétit global pour le risque, avec une "
        "dispersion attendue entre régions selon leur sensibilité au dollar et à l'énergie."
    )
    top_news = (
        "La nouvelle la plus structurante de la journée reste l'état du couple inflation-taux US: "
        "toute surprise sur ce front peut rapidement re-pricer les actions, le crédit et les devises "
        "à l'échelle mondiale."
    )

    return {
        "macro": macro,
        "us_market": us_market,
        "cad_market": cad_market,
        "international_market": international_market,
        "top_news": top_news,
    }


def ai_briefing(snapshot: list[dict]) -> dict[str, str] | None:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return None

    prompt = {
        "generated_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "snapshot": snapshot,
        "instruction": (
            "Rédige un briefing marché en français, ton professionnel. "
            "Retourne uniquement un objet JSON avec exactement ces clés: "
            "macro, us_market, cad_market, international_market, top_news. "
            "Chaque valeur doit être un paragraphe court. "
            "N'invente pas de données au-delà du snapshot; explicite les limites si nécessaire."
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

    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None

    try:
        candidate = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None

    keys = ["macro", "us_market", "cad_market", "international_market", "top_news"]
    if not all(isinstance(candidate.get(key), str) and candidate.get(key).strip() for key in keys):
        return None

    return {key: candidate[key].strip() for key in keys}


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
    sections = deterministic_briefing(valid_snapshot)
    ai_output = ai_briefing(valid_snapshot)
    if ai_output:
        sections = ai_output

    data = {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "summary": sections["macro"],
        "highlights": [
            sections["us_market"],
            sections["cad_market"],
            sections["international_market"],
            sections["top_news"],
        ],
        "sections": sections,
        "series_snapshot": snapshot,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
