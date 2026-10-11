#!/usr/bin/env python3
"""Validate the daily, sourced French news edition before publishing it."""
from __future__ import annotations

import argparse
import json
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
def https_url(value: object) -> bool:
    if not isinstance(value, str):
        return False
    try:
        url = urlsplit(value)
        return url.scheme == "https" and bool(url.hostname) and not url.username and not url.password
    except ValueError:
        return False

def validate(payload: dict, now: datetime | None = None) -> int:
    if not isinstance(payload, dict) or payload.get("schema_version") != 4 or payload.get("kind") != "news_digest":
        raise ValueError("Format du briefing invalide")
    if payload.get("language") != "fr" or payload.get("timezone") != "America/Toronto":
        raise ValueError("Le briefing doit être en français, à l’heure de Montréal")
    try:
        edition = date.fromisoformat(payload["edition_date"])
        stamp = datetime.fromisoformat(payload["generated_at"].replace("Z", "+00:00"))
    except (KeyError, TypeError, ValueError, AttributeError) as error:
        raise ValueError("Horodatage du briefing invalide") from error
    if not stamp.tzinfo or stamp.astimezone(ZoneInfo("America/Toronto")).date() != edition:
        raise ValueError("Date d’édition incohérente avec l’horodatage")
    if (stamp - (now or datetime.now(timezone.utc))).total_seconds() > 300:
        raise ValueError("Une édition future ne peut pas être publiée")
    stories = payload.get("stories")
    if not isinstance(stories, list) or not 1 <= len(stories) <= 6:
        raise ValueError("Le briefing doit contenir de 1 à 6 nouvelles vérifiées")
    seen = set()
    words = 0
    for story in stories:
        if not isinstance(story, dict) or not https_url(story.get("source_url")) or story["source_url"] in seen:
            raise ValueError("Publication absente ou répétée")
        seen.add(story["source_url"])
        for field in ("topic", "title", "summary", "impact", "source_label"):
            if not isinstance(story.get(field), str) or not story[field].strip():
                raise ValueError(f"Champ {field} manquant")
        summary_words = len(story["summary"].split())
        impact_words = len(story["impact"].split())
        if not 15 <= summary_words <= 120 or not 5 <= impact_words <= 60:
            raise ValueError("Une nouvelle doit être courte, précise et expliquer son effet")
        words += summary_words + impact_words
        try:
            published = date.fromisoformat(story["published_date"])
        except (KeyError, ValueError, TypeError) as error:
            raise ValueError("Date de publication invalide") from error
        if published > edition or (edition - published).days > 14:
            raise ValueError("Publication future ou trop ancienne")
    if words > 700:
        raise ValueError("Le briefing doit rester sélectif")
    watch = payload.get("fred_watch")
    if not isinstance(watch, list) or not 3 <= len(watch) <= 4:
        raise ValueError("Trois ou quatre graphiques FRED sont requis")
    series_ids = set()
    for item in watch:
        if not isinstance(item, dict) or not isinstance(item.get("series_id"), str):
            raise ValueError("Série FRED manquante")
        series_id = item["series_id"]
        if not series_id.isascii() or not series_id.isalnum() or series_id != series_id.upper() or series_id in series_ids:
            raise ValueError("Série FRED répétée ou invalide")
        series_ids.add(series_id)
        if item.get("source_url") != f"https://fred.stlouisfed.org/series/{series_id}":
            raise ValueError("Lien FRED invalide")
        if any(not isinstance(item.get(field), str) or not item[field].strip() for field in ("title", "explanation")):
            raise ValueError("Explication FRED manquante")
        try:
            observation_date = date.fromisoformat(item["observation_date"])
        except (KeyError, TypeError, ValueError) as error:
            raise ValueError("Date FRED invalide") from error
        if observation_date > edition:
            raise ValueError("Observation FRED future")
    if "word_count" in payload and payload["word_count"] != words:
        raise ValueError("Compte des mots incohérent")
    return words

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", nargs="?", type=Path, default=ROOT / "data/daily-briefing.json")
    args = parser.parse_args()
    payload = json.loads(args.path.read_text(encoding="utf-8"))
    words = validate(payload)
    print(f"Briefing vérifié : {payload['edition_date']}, {words} mots, {len(payload['stories'])} nouvelles")

if __name__ == "__main__":
    main()
