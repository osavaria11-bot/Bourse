#!/usr/bin/env python3
"""Collect CNN's published US equity Fear & Greed Index, with a dated fallback."""
from __future__ import annotations

import argparse
import json
import math
from datetime import date, datetime, timedelta, timezone
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


def parse_history(rows, point):
    """Keep genuine daily scores, with the latest publication on its UTC date."""
    by_date = {}
    end = point["timestamp"][:10]
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, (list, tuple)) or len(row) != 2 or not valid_score(row[1]):
            continue
        try:
            day = date.fromisoformat(row[0]).isoformat()
        except (TypeError, ValueError):
            continue
        if day == row[0] and "2000-01-01" <= day <= end:
            by_date[day] = row[1]
    if by_date:
        by_date[end] = point["score"]
    return [[day, score] for day, score in sorted(by_date.items())]


def cnn_history(payload, point, now):
    historical = payload.get("fear_and_greed_historical")
    rows = historical.get("data") if isinstance(historical, dict) else None
    observations = []
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict) or not valid_score(row.get("y")):
            continue
        stamp = row.get("x")
        if not isinstance(stamp, (int, float)) or isinstance(stamp, bool) or not math.isfinite(stamp):
            continue
        try:
            published = datetime.fromtimestamp(stamp / 1000, timezone.utc)
        except (ValueError, OverflowError, OSError):
            continue
        if published.year >= 2000 and published <= now + timedelta(minutes=5):
            observations.append((stamp, published.date().isoformat(), row["y"]))
    # CNN can include a close and a later intraday score on the same date.
    return parse_history([[day, score] for _, day, score in sorted(observations, key=lambda row: row[0])], point)


def fetch_index(now):
    text = macro.fetch_text(DATA_URL, headers={"Referer": SOURCE_URL})
    try:
        payload = json.loads(text)
    except ValueError as exc:
        raise macro.SourceError("CNN : réponse JSON non reconnue") from exc
    point = parse_index(payload.get("fear_and_greed") if isinstance(payload, dict) else None, now)
    return {**point, "history": cnn_history(payload, point, now)}


def collect(previous, now, fetcher=fetch_index):
    base = {"schema_version": 1, "kind": "cnn_fear_and_greed", "provider": "cnn",
            "generated_at": now.isoformat().replace("+00:00", "Z"),
            "source_label": "CNN", "source_url": SOURCE_URL}
    cached = None
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
            cached = {**point, "history": parse_history(previous.get("history"), point),
                      "last_successful_fetch": previous["last_successful_fetch"]}
        except (macro.SourceError, KeyError, AttributeError, TypeError, ValueError):
            pass
    try:
        raw = fetcher(now)
        point = parse_index(raw, now)
        history = parse_history(raw.get("history"), point)
        history_status = "fresh" if history else "unavailable"
        if not history and cached:
            history = parse_history(cached["history"], point)
            history_status = "cached" if history else "unavailable"
        return {**base, **point, "history": history, "history_status": history_status,
                "fetch_status": "fresh", "last_successful_fetch": base["generated_at"]}
    except macro.SourceError as exc:
        error = str(exc)[:180]
        if cached:
            return {**base, **cached, "fetch_status": "cached", "error": error,
                    "history_status": "cached" if cached["history"] else "unavailable"}
        return {**base, "score": None, "rating": None, "timestamp": None, "previous_close": None,
                "history": [], "history_status": "unavailable", "fetch_status": "unavailable",
                "last_successful_fetch": None, "error": error}


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
