#!/usr/bin/env python3
"""Collect CNN's published US equity Fear & Greed Index, with a dated fallback."""
from __future__ import annotations

import argparse
import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    from scripts import generate_daily_briefing as macro
except ModuleNotFoundError:
    import generate_daily_briefing as macro

ROOT = Path(__file__).resolve().parents[1]
SOURCE_URL = "https://www.cnn.com/markets/fear-and-greed"
DATA_URL = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata"
RATINGS = {"extreme fear", "fear", "neutral", "greed", "extreme greed"}


def valid_score(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and 0 <= value <= 100


def parse_index(point, now):
    if not isinstance(point, dict) or not valid_score(point.get("score")):
        raise macro.SourceError("CNN : score absent ou hors de l’échelle 0–100")
    rating = str(point.get("rating", "")).strip().lower()
    if rating not in RATINGS:
        raise macro.SourceError("CNN : classement non reconnu")
    try:
        stamp = datetime.fromisoformat(point["timestamp"].replace("Z", "+00:00"))
        if stamp.tzinfo is None or stamp.year < 2000 or stamp > now + timedelta(minutes=5):
            raise ValueError("Invalid publication time")
    except (KeyError, AttributeError, TypeError, ValueError, OverflowError) as exc:
        raise macro.SourceError("CNN : heure de publication invalide") from exc
    return {"score": point["score"], "rating": rating,
            "timestamp": stamp.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
            "previous_close": point.get("previous_close") if valid_score(point.get("previous_close")) else None}


def fetch_index(now):
    text = macro.fetch_text(DATA_URL, headers={"Referer": SOURCE_URL})
    try:
        payload = json.loads(text)
    except ValueError as exc:
        raise macro.SourceError("CNN : réponse JSON non reconnue") from exc
    return parse_index(payload.get("fear_and_greed") if isinstance(payload, dict) else None, now)


def collect(previous, now, fetcher=fetch_index):
    base = {"schema_version": 1, "kind": "cnn_fear_and_greed", "provider": "cnn",
            "generated_at": now.isoformat().replace("+00:00", "Z"),
            "source_label": "CNN", "source_url": SOURCE_URL}
    try:
        point = parse_index(fetcher(now), now)
        return {**base, **point, "fetch_status": "fresh", "last_successful_fetch": base["generated_at"]}
    except macro.SourceError as exc:
        error = str(exc)[:180]
        if (isinstance(previous, dict) and previous.get("schema_version") == 1
                and previous.get("kind") == base["kind"] and previous.get("provider") == "cnn"
                and previous.get("fetch_status") in ("fresh", "cached")
                and previous.get("source_url") == SOURCE_URL):
            try:
                point = parse_index(previous, now)
                fetched = datetime.fromisoformat(previous["last_successful_fetch"].replace("Z", "+00:00"))
                published = datetime.fromisoformat(point["timestamp"].replace("Z", "+00:00"))
                if fetched.tzinfo is None or fetched > now + timedelta(minutes=5) or published > fetched + timedelta(minutes=5):
                    raise ValueError("Invalid fetch time")
                return {**base, **point, "fetch_status": "cached", "error": error,
                        "last_successful_fetch": previous["last_successful_fetch"]}
            except (macro.SourceError, KeyError, AttributeError, TypeError, ValueError):
                pass
        return {**base, "score": None, "rating": None, "timestamp": None, "previous_close": None,
                "fetch_status": "unavailable", "last_successful_fetch": None, "error": error}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "data")
    args = parser.parse_args()
    output = args.output_dir / "fear-greed.json"
    result = collect(macro.read_json(output), datetime.now(timezone.utc))
    macro.atomic_write_json(output, result)
    print("CNN Fear & Greed:", result["score"], result["rating"], result["timestamp"], result["fetch_status"])
    if result.get("error"):
        print("::warning::" + result["error"])


if __name__ == "__main__":
    main()
