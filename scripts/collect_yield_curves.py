#!/usr/bin/env python3
"""Dated nominal sovereign yield curves; never splice maturities from different days."""
from __future__ import annotations
import argparse
import csv
import io
import json
import math
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode
from zoneinfo import ZoneInfo
try:
    from scripts import generate_daily_briefing as macro
except ModuleNotFoundError:
    import generate_daily_briefing as macro

ROOT = Path(__file__).resolve().parents[1]
START = date(2016, 1, 1)
US_SOURCE = "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve"
CA_SOURCE = "https://www.bankofcanada.ca/rates/interest-rates/canadian-bonds/"
US_TENORS = [("1M", "1 mois", 1, "1 Mo"), ("3M", "3 mois", 3, "3 Mo"), ("6M", "6 mois", 6, "6 Mo"),
             ("1Y", "1 an", 12, "1 Yr"), ("2Y", "2 ans", 24, "2 Yr"), ("3Y", "3 ans", 36, "3 Yr"),
             ("5Y", "5 ans", 60, "5 Yr"), ("7Y", "7 ans", 84, "7 Yr"), ("10Y", "10 ans", 120, "10 Yr"),
             ("20Y", "20 ans", 240, "20 Yr"), ("30Y", "30 ans", 360, "30 Yr")]
CA_TENORS = [("1M", "1 mois", 1, "TB.CDN.30D.MID"), ("3M", "3 mois", 3, "TB.CDN.90D.MID"),
             ("6M", "6 mois", 6, "TB.CDN.180D.MID"), ("1Y", "1 an", 12, "TB.CDN.1Y.MID"),
             ("2Y", "2 ans", 24, "BD.CDN.2YR.DQ.YLD"), ("3Y", "3 ans", 36, "BD.CDN.3YR.DQ.YLD"),
             ("5Y", "5 ans", 60, "BD.CDN.5YR.DQ.YLD"), ("7Y", "7 ans", 84, "BD.CDN.7YR.DQ.YLD"),
             ("10Y", "10 ans", 120, "BD.CDN.10YR.DQ.YLD"), ("LONG", "Long", 360, "BD.CDN.LONG.DQ.YLD")]

def definition(country: str) -> dict:
    us = country == "US"
    tenors = US_TENORS if us else CA_TENORS
    return {"id": country, "title": "États-Unis · USD" if us else "Canada · CAD", "currency": "USD" if us else "CAD",
            "source_label": "U.S. Treasury" if us else "Banque du Canada / CanDeal DNA", "source_url": US_SOURCE if us else CA_SOURCE,
            "methodology": "Rendements nominaux à maturité constante, courbe au pair publiée par le Trésor américain." if us else
            "Bons du Trésor et obligations nominales de référence. Long : émission de référence à long terme (environ 30 ans); échéance résiduelle variable.",
            "tenors": [{"key": key, "label": label, "months": months, "series_id": sid} for key, label, months, sid in tenors]}

def number(value) -> float | None:
    if value is None or str(value).strip() in ("", ".", "NA", "N/A", "--"):
        return None
    if isinstance(value, bool):
        raise macro.SourceError("Un booléen n’est pas un taux")
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise macro.SourceError("Taux non numérique") from exc
    if not math.isfinite(result) or not -20 <= result <= 100:
        raise macro.SourceError("Taux non fini ou hors limites")
    return result

def observation_day(raw, today: date) -> str | None:
    try:
        day = date.fromisoformat(raw)
    except (TypeError, ValueError):
        return None
    return day.isoformat() if START <= day <= today and day.weekday() < 5 else None

def parse_us(text: str, year: int, today: date) -> list[list]:
    reader = csv.DictReader(io.StringIO(text.lstrip("\ufeff")))
    if not all(column in (reader.fieldnames or []) for column in ["Date", *[item[3] for item in US_TENORS]]):
        raise macro.SourceError("Colonnes U.S. Treasury incohérentes")
    rows = {}
    for item in reader:
        try:
            parsed = datetime.strptime(item["Date"], "%m/%d/%Y").date()
        except (ValueError, TypeError):
            continue
        day = observation_day(parsed.isoformat(), today)
        if parsed.year != year or not day:
            continue
        values = [number(item[sid]) for _, _, _, sid in US_TENORS]
        if any(value is not None for value in values):
            if day in rows and rows[day] != values:
                raise macro.SourceError("Deux courbes U.S. différentes à la même date")
            rows[day] = values
    if not rows:
        raise macro.SourceError("Aucune courbe U.S. Treasury valide")
    return [[day, *values] for day, values in sorted(rows.items())]

def parse_ca(text: str, today: date) -> list[list]:
    try:
        payload = json.loads(text)
    except ValueError as exc:
        raise macro.SourceError("JSON Banque du Canada invalide") from exc
    ids = [item[3] for item in CA_TENORS]
    if not isinstance(payload, dict) or not isinstance(payload.get("seriesDetail"), dict) or not all(sid in payload["seriesDetail"] for sid in ids) or not isinstance(payload.get("observations"), list):
        raise macro.SourceError("Séries quotidiennes Banque du Canada absentes")
    rows = {}
    for item in payload["observations"]:
        if not isinstance(item, dict):
            continue
        day = observation_day(item.get("d"), today)
        if not day:
            continue
        values = [number(item.get(sid, {}).get("v")) if isinstance(item.get(sid, {}), dict) else None for sid in ids]
        if any(value is not None for value in values):
            if day in rows and rows[day] != values:
                raise macro.SourceError("Deux courbes canadiennes différentes à la même date")
            rows[day] = values
    if not rows:
        raise macro.SourceError("Aucune courbe canadienne valide")
    return [[day, *values] for day, values in sorted(rows.items())]

def valid_cached(country: dict | None, cid: str, today: date) -> bool:
    if not isinstance(country, dict) or any(country.get(key) != definition(cid)[key] for key in ("id", "currency", "source_url", "tenors")):
        return False
    rows = country.get("history")
    if not isinstance(rows, list) or not rows or not country.get("last_successful_fetch"):
        return False
    previous = ""
    for row in rows:
        if not isinstance(row, list) or len(row) != len(country["tenors"]) + 1 or not observation_day(row[0], today) or row[0] <= previous:
            return False
        if any(value is not None and (isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not -20 <= value <= 100) for value in row[1:]):
            return False
        previous = row[0]
    try:
        stamp = datetime.fromisoformat(country["last_successful_fetch"].replace("Z", "+00:00"))
        return stamp.tzinfo is not None and stamp.date() <= today + timedelta(days=1)
    except (TypeError, ValueError):
        return False

def fetch_country(cid: str, previous: dict | None, now: datetime, fetcher=macro.fetch_text) -> dict:
    today = now.astimezone(ZoneInfo("America/Toronto")).date()
    metadata = definition(cid)
    cached = previous if valid_cached(previous, cid, today) else None
    try:
        if cid == "US":
            checked = cached.get("history_checked_at") if cached else None
            try:
                recent_full = now - datetime.fromisoformat(checked.replace("Z", "+00:00")) < timedelta(days=7)
            except (ValueError, TypeError, AttributeError):
                recent_full = False
            full = not recent_full
            years = list(range(START.year, today.year + 1)) if full else list(range(max(START.year, today.year - (1 if today.month == 1 else 0)), today.year + 1))
            def fetch_year(year):
                query = urlencode({"type": "daily_treasury_yield_curve", "field_tdr_date_value": year, "_format": "csv"})
                url = f"https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/{year}/all?{query}"
                return parse_us(fetcher(url), year, today)
            with ThreadPoolExecutor(max_workers=4) as pool:
                parts = list(pool.map(fetch_year, years))
            by_day = {} if full else {row[0]: row for row in cached["history"] if int(row[0][:4]) not in years}
            for part in parts:
                by_day.update({row[0]: row for row in part})
            history = [by_day[day] for day in sorted(by_day)]
            checked_at = now.isoformat() if full else cached["history_checked_at"]
        else:
            ids = ",".join(item[3] for item in CA_TENORS)
            query = urlencode({"start_date": START.isoformat(), "end_date": today.isoformat()})
            history = parse_ca(fetcher(f"https://www.bankofcanada.ca/valet/observations/{ids}/json?{query}"), today)
            checked_at = now.isoformat()
        if cached and history[-1][0] < cached["history"][-1][0]:
            raise macro.SourceError("La source régresse vers une observation plus ancienne")
        return {**metadata, "history": history, "fetch_status": "fresh", "last_successful_fetch": now.isoformat(), "history_checked_at": checked_at}
    except (macro.SourceError, ValueError, KeyError, TypeError, OSError) as exc:
        return {**metadata, "history": cached["history"] if cached else [], "fetch_status": "cached" if cached else "unavailable",
                "last_successful_fetch": cached["last_successful_fetch"] if cached else None,
                "history_checked_at": cached.get("history_checked_at") if cached else None, "error": str(exc)[:160]}

def collect(previous: dict | None = None, now: datetime | None = None, fetcher=macro.fetch_text) -> dict:
    now = now or datetime.now(timezone.utc)
    old = {item.get("id"): item for item in (previous or {}).get("countries", []) if isinstance(item, dict)}
    with ThreadPoolExecutor(max_workers=2) as pool:
        countries = list(pool.map(lambda cid: fetch_country(cid, old.get(cid), now, fetcher), ["US", "CA"]))
    return {"schema_version": 1, "kind": "sovereign_yield_curves", "unit": "percent", "timezone": "America/Toronto",
            "history_start": START.isoformat(), "generated_at": now.isoformat(), "countries": countries,
            "coverage": {status: sum(item["fetch_status"] == status for item in countries) for status in ("fresh", "cached", "unavailable")}}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "data")
    args = parser.parse_args()
    path = args.output_dir / "yield-curves.json"
    result = collect(macro.read_json(path))
    if all(item["fetch_status"] == "unavailable" for item in result["countries"]):
        raise SystemExit("Aucune courbe valide à publier; le fichier existant reste inchangé.")
    macro.atomic_write_json(path, result, compact=True)
    print("Courbes souveraines :", result["coverage"])
    for country in result["countries"]:
        print(country["id"], country["fetch_status"], len(country["history"]), "séances; dernière :", country["history"][-1][0] if country["history"] else "N/D")

if __name__ == "__main__":
    main()
