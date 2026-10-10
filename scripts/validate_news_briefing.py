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
SOURCE_IDS = {"reuters-markets", "reuters-economy", "bank-of-canada", "fred-calendar", "perplexity-finance"}

def https_url(value: object) -> bool:
    if not isinstance(value, str):
        return False
    try:
        url = urlsplit(value)
        return url.scheme == "https" and bool(url.hostname) and not url.username and not url.password
    except ValueError:
        return False

def validate(payload: dict, now: datetime | None = None) -> int:
    if not isinstance(payload, dict) or payload.get("schema_version") != 3 or payload.get("kind") != "news_digest":
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
    sources = payload.get("sources")
    if not isinstance(sources, list) or len(sources) != len(SOURCE_IDS):
        raise ValueError("Les cinq sources de veille doivent être présentes")
    seen = set()
    words = 0
    available = 0
    for source in sources:
        if not isinstance(source, dict) or source.get("id") not in SOURCE_IDS or source["id"] in seen:
            raise ValueError("Source absente, inconnue ou dupliquée")
        seen.add(source["id"])
        for field in ("label", "summary"):
            if not isinstance(source.get(field), str) or not source[field].strip():
                raise ValueError(f"Champ {field} manquant")
        if not https_url(source.get("url")) or source.get("status") not in ("available", "partial", "unavailable"):
            raise ValueError("URL ou statut de source invalide")
        words += len(source["summary"].split())
        articles = source.get("articles")
        if not isinstance(articles, list) or (source["status"] != "unavailable" and not articles):
            raise ValueError("Une synthèse accessible doit citer sa publication")
        available += source["status"] != "unavailable"
        for article in articles:
            if not isinstance(article, dict) or not https_url(article.get("url")):
                raise ValueError("URL de publication invalide")
            if not isinstance(article.get("title"), str) or not article["title"].strip():
                raise ValueError("Titre de publication manquant")
            try:
                published = date.fromisoformat(article["published_date"])
            except (KeyError, ValueError, TypeError) as error:
                raise ValueError("Date de publication invalide") from error
            if published > edition:
                raise ValueError("Une publication future ne peut pas être résumée")
    if not available:
        raise ValueError("Aucune publication accessible : conserver l’édition précédente")
    if words != 500 or payload.get("word_count") != words:
        raise ValueError(f"500 mots requis au total dans les résumés; reçu {words}")
    return words

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", nargs="?", type=Path, default=ROOT / "data/daily-briefing.json")
    args = parser.parse_args()
    payload = json.loads(args.path.read_text(encoding="utf-8"))
    words = validate(payload)
    print(f"Briefing vérifié : {payload['edition_date']}, {words} mots, {len(payload['sources'])} sources")

if __name__ == "__main__":
    main()
