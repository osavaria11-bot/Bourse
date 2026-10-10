#!/usr/bin/env python3
"""Collect FRED observations for a static dashboard, with per-series fallback.

Only the Python standard library is required. No credentials or browser proxies.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import math
import os
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
TIMEOUT_SECONDS = 20
RETRY_ATTEMPTS = 3
HISTORY_YEARS = 10
BRIEFING_IDS = ["CPIAUCSL", "PCEPILFE", "UNRATE", "PAYEMS", "GDPC1", "DFF", "DGS10", "T10Y2Y", "SP500", "VIXCLS", "DEXCAUS"]
NEWS_SOURCES = [
    {"label": "Reuters — Marchés", "url": "https://www.reuters.com/markets/", "description": "Actions, taux, devises et matières premières."},
    {"label": "Reuters — Économie", "url": "https://www.reuters.com/markets/econ-world/", "description": "Croissance, inflation et banques centrales."},
    {"label": "Banque du Canada — Sommaire quotidien", "url": "https://www.bankofcanada.ca/rates/daily-digest/", "description": "Taux et devises publiés par la Banque du Canada."},
    {"label": "FRED — Calendrier des publications", "url": "https://fred.stlouisfed.org/releases/calendar", "description": "Prochaines mises à jour des statistiques."},
    {"label": "Perplexity — Finance", "url": "https://www.perplexity.ai/finance", "description": "Veille financière complémentaire."},
]

class SourceError(RuntimeError):
    """A provider returned unusable data."""

def read_json(path: Path) -> dict | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else None
    except (OSError, ValueError):
        return None

def atomic_write_json(path: Path, payload: dict, *, compact: bool = False) -> None:
    """Never replace a valid file with a partially written JSON document."""
    content = json.dumps(payload, ensure_ascii=False, allow_nan=False,
                         indent=None if compact else 2,
                         separators=(",", ":") if compact else None) + "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent,
                                         delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(content)
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)

def fetch_text(url: str) -> str:
    request = Request(url, headers={"User-Agent": "SavyMacroDashboard/3.0", "Accept": "text/csv"})
    for attempt in range(RETRY_ATTEMPTS):
        try:
            with urlopen(request, timeout=TIMEOUT_SECONDS) as response:
                return response.read().decode("utf-8-sig")
        except HTTPError as exc:
            if exc.code not in (429, 500, 502, 503, 504) or attempt + 1 == RETRY_ATTEMPTS:
                raise SourceError(f"HTTP {exc.code}") from exc
        except (URLError, TimeoutError, OSError) as exc:
            if attempt + 1 == RETRY_ATTEMPTS:
                raise SourceError(f"Source inaccessible ({type(exc).__name__})") from exc
        time.sleep(2 ** attempt)
    raise SourceError("Source inaccessible")

def parse_observations(text: str, series_id: str, today: date) -> list[list]:
    reader = csv.DictReader(io.StringIO(text.lstrip("\ufeff")))
    columns = reader.fieldnames or []
    date_key = next((key for key in columns if key.lower() in ("date", "observation_date")), None)
    if date_key is None or series_id not in columns:
        raise SourceError(f"{series_id}: colonnes CSV non reconnues")
    by_date = {}
    for row in reader:
        raw_date = (row.get(date_key) or "").strip()
        try:
            observation_date = date.fromisoformat(raw_date)
        except ValueError:
            continue
        if observation_date > today:
            continue
        raw_value = (row.get(series_id) or "").strip()
        value = None
        if raw_value not in ("", ".", "NA"):
            try:
                value = float(raw_value)
            except ValueError:
                continue
            if not math.isfinite(value):
                continue
        by_date[raw_date] = value
    observations = [[day, value] for day, value in sorted(by_date.items())]
    if not any(value is not None for _, value in observations):
        raise SourceError(f"{series_id}: aucune observation numérique valide")
    return observations

def months_before(day: date, count: int) -> date:
    """Match periods by calendar, not by row number when a month is missing."""
    month_index = day.year * 12 + day.month - 1 - count
    return date(month_index // 12, month_index % 12 + 1, 1)

def transform_observations(observations: list[list], transform: str) -> list[list]:
    if transform == "none":
        return observations
    if transform not in ("yoy", "qoq_annualized", "mom_change"):
        raise ValueError(f"Transformation inconnue: {transform}")
    lookup = dict(observations)
    result = []
    for day, current in observations:
        lag = 12 if transform == "yoy" else 3 if transform == "qoq_annualized" else 1
        previous = lookup.get(months_before(date.fromisoformat(day), lag).isoformat())
        value = None
        if current is not None and previous is not None:
            if transform == "mom_change":
                value = current - previous
            elif previous > 0 and current >= 0:
                ratio = current / previous
                value = (ratio ** (4 if transform == "qoq_annualized" else 1) - 1) * 100
        result.append([day, round(value, 6) if value is not None and math.isfinite(value) else None])
    return result

def summarize(definition: dict, history: list[list], now: datetime) -> dict:
    valid = [(day, value) for day, value in history if value is not None and math.isfinite(value)]
    if not valid:
        raise SourceError(f"{definition['id']}: historique inexploitable")
    day, value = valid[-1]
    previous_day, previous_value = valid[-2] if len(valid) > 1 else (None, None)
    return {
        **definition,
        "source_url": f"https://fred.stlouisfed.org/series/{definition['id']}",
        "date": day,
        "value": value,
        "previous_date": previous_day,
        "previous_value": previous_value,
        "change": round(value - previous_value, 6) if previous_value is not None else None,
        "history": history,
        "fetch_status": "fresh",
        "last_successful_fetch": now.isoformat(),
    }

def fetch_series(definition: dict, now: datetime) -> dict:
    today = now.date()
    # An extra year is required for year-over-year transformations at the start.
    start = date(today.year - HISTORY_YEARS - 1, 1, 1)
    params = urlencode({"id": definition["id"], "cosd": start.isoformat(), "coed": today.isoformat()})
    text = fetch_text(f"https://fred.stlouisfed.org/graph/fredgraph.csv?{params}")
    observations = parse_observations(text, definition["id"], today)
    history = transform_observations(observations, definition.get("transform", "none"))
    cutoff = months_before(today.replace(day=1), HISTORY_YEARS * 12).isoformat()
    return summarize(definition, [point for point in history if point[0] >= cutoff], now)

def usable_previous(point: dict | None, definition: dict, today: date) -> bool:
    if not isinstance(point, dict) or point.get("transform", "none") != definition.get("transform", "none"):
        return False
    value = point.get("value")
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
        return False
    try:
        return date.fromisoformat(point.get("date", "")) <= today
    except (ValueError, TypeError):
        return False

def collect_sources(definitions: list[dict], previous: dict | None, now: datetime, *, fetcher=None) -> dict:
    previous_points = {point["id"]: point for point in (previous or {}).get("series", [])}
    results = {}
    errors = []
    with ThreadPoolExecutor(max_workers=5) as executor:
        jobs = {executor.submit(fetcher or fetch_series, definition, now): definition for definition in definitions}
        for job in as_completed(jobs):
            definition = jobs[job]
            series_id = definition["id"]
            try:
                results[series_id] = job.result()
            except Exception as exc:
                # One provider failure must not discard other successful series.
                message = str(exc)[:200]
                errors.append({"id": series_id, "message": message})
                cached = previous_points.get(series_id)
                if usable_previous(cached, definition, now.date()):
                    results[series_id] = {**cached, **definition, "fetch_status": "cached", "error": message}
                else:
                    results[series_id] = {**definition, "source_url": f"https://fred.stlouisfed.org/series/{series_id}",
                                          "value": None, "date": None, "previous_value": None, "previous_date": None,
                                          "change": None, "history": [], "fetch_status": "unavailable", "error": message}
    points = [results[definition["id"]] for definition in definitions]
    fresh = sum(point["fetch_status"] == "fresh" for point in points)
    available = sum(point.get("value") is not None for point in points)
    if not available:
        raise SourceError("Toutes les sources ont échoué; aucun fichier valide à remplacer.")
    status = "fresh_data" if fresh == len(points) else "partial_data" if fresh else "stale_data_kept"
    return {
        "schema_version": 2,
        "generated_at": now.isoformat(),
        "last_successful_update": now.isoformat() if not errors else (previous or {}).get("last_successful_update"),
        "update_status": status,
        "data_provider": "FRED — Federal Reserve Bank of St. Louis",
        "coverage": {"total": len(points), "fresh": fresh, "cached": available - fresh, "unavailable": len(points) - available},
        "errors": sorted(errors, key=lambda error: error["id"]),
        "series": points,
    }

def describe_point(point: dict) -> str:
    decimals = point.get("decimals", 2)
    level = f"{point['value']:.{decimals}f}".replace(".", ",")
    return f"{point['title']} : {level} {point.get('unit', '')} (période : {point['date']})"

def build_paragraph(points: dict[str, dict]) -> str:
    included = [describe_point(points[series_id]) for series_id in BRIEFING_IDS
                if series_id in points and points[series_id].get("value") is not None]
    return "Dernières observations publiées — " + "; ".join(included) + "." if included else "Aucune observation disponible."

def build_briefing(dataset: dict) -> dict:
    points = {point["id"]: point for point in dataset["series"]}
    return {
        **{key: dataset[key] for key in ("schema_version", "generated_at", "last_successful_update", "update_status", "coverage", "data_provider")},
        "briefing_paragraph": build_paragraph(points),
        "news_digest_note": "Veille complémentaire. Les données suivent le calendrier de publication de chaque source.",
        "news_sources": NEWS_SOURCES,
        "series_snapshot": [{key: point.get(key) for key in ("id", "title", "date", "value", "previous_value", "previous_date", "unit", "fetch_status")}
                            for point in dataset["series"] if point["id"] in BRIEFING_IDS],
    }

def migrate_previous(definitions: list[dict], legacy: dict | None) -> dict | None:
    """Use authentic existing snapshots on first upgrade; never invent history."""
    if not legacy:
        return None
    points = {point["id"]: point for point in legacy.get("series_snapshot", [])}
    migrated = []
    for definition in definitions:
        point = points.get(definition["id"])
        if not point or definition.get("transform", "none") != "none":
            continue
        migrated.append({**definition, **point, "title": definition["title"], "unit": definition["unit"],
                         "history": [[point["date"], point["value"]]], "change": None,
                         "last_successful_fetch": legacy.get("last_successful_update"), "fetch_status": "cached"})
    return {"series": migrated, "last_successful_update": legacy.get("last_successful_update")}

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "data")
    args = parser.parse_args()
    config = read_json(ROOT / "data/series.json")
    if not config or not config.get("series"):
        raise SourceError("Configuration des indicateurs absente")
    definitions = config["series"]
    previous = read_json(args.output_dir / "macro-data.json")
    if previous is None:
        legacy = read_json(args.output_dir / "macro-briefing.json") or read_json(args.output_dir / "daily-briefing.json")
        previous = migrate_previous(definitions, legacy)
    dataset = collect_sources(definitions, previous, datetime.now(timezone.utc))
    briefing = build_briefing(dataset)
    # Validate both documents before replacing either previous file.
    json.dumps(dataset, allow_nan=False)
    json.dumps(briefing, allow_nan=False)
    atomic_write_json(args.output_dir / "macro-data.json", dataset, compact=True)
    # News is maintained separately; an observation refresh must never overwrite it.
    atomic_write_json(args.output_dir / "macro-briefing.json", briefing)
    print(f"Collecte : {dataset['coverage']}; statut : {dataset['update_status']}")
    for error in dataset["errors"]:
        print(f"::warning::{error['id']}: {error['message']}")

if __name__ == "__main__":
    main()

