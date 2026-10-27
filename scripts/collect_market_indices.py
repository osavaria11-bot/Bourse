#!/usr/bin/env python3
"""Collect daily closes for world indices and the EEM and FEQT ETFs."""
from __future__ import annotations

import argparse
import calendar
import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

try:
    from scripts import generate_daily_briefing as macro
    from scripts import daily_fnb as daily
except ModuleNotFoundError:
    import generate_daily_briefing as macro
    import daily_fnb as daily

ROOT = Path(__file__).resolve().parents[1]
MARKETS = [
    ("SPX", "S&P 500", "États-Unis", "^GSPC"),
    ("IXIC", "Nasdaq Composite", "États-Unis", "^IXIC"),
    ("TSX", "S&P/TSX Composite", "Canada", "^GSPTSE"),
    ("STOXX600", "STOXX Europe 600", "Europe", "^STOXX"),
    ("EEM", "MSCI émergents · ETF EEM", "Marchés émergents", "EEM"),
    ("FEQT", "FEQT · Fidelity All-in-One Equity", "Monde · FNB en CAD", "FEQT.NE"),
]

def definitions() -> list[dict]:
    return [{"id": sid, "title": title, "category": region, "quote_symbol": symbol,
             "unit": "$ US" if sid == "EEM" else "$ CA" if sid == "FEQT" else "points",
             "instrument_type": "etf" if sid in ("EEM", "FEQT") else "index",
             **({"currency": "CAD"} if sid == "FEQT" else {}),
             "decimals": 2, "frequency": "daily", "transform": "none",
             "history_years": 11,
             "max_age_days": 7, "source_url": f"https://finance.yahoo.com/quote/{quote(symbol, safe='')}/"}
            for sid, title, region, symbol in MARKETS]

def parse_history(payload: dict, symbol: str, now: datetime, currency: str | None = None) -> list[list]:
    try:
        chart = payload["chart"]
        if chart.get("error"):
            raise ValueError("Erreur de cotation")
        result = chart["result"][0]
        meta = result["meta"]
        if meta.get("symbol") != symbol:
            raise ValueError("Symbole différent de l’indice demandé")
        if currency and meta.get("currency") != currency:
            raise ValueError("Devise différente de la cotation demandée")
        exchange_timezone = ZoneInfo(meta["exchangeTimezoneName"])
        timestamps = result["timestamp"]
        closes = result["indicators"]["quote"][0]["close"]
        if len(timestamps) != len(closes):
            raise ValueError("Historique incomplet")
    except (KeyError, IndexError, TypeError, ValueError, ZoneInfoNotFoundError) as error:
        raise macro.SourceError(f"{symbol}: réponse de cotation invalide") from error
    today = now.astimezone(exchange_timezone).date()
    close_time = meta.get("currentTradingPeriod", {}).get("regular", {}).get("end", 0)
    by_date = {}
    for stamp, close in zip(timestamps, closes):
        if not isinstance(stamp, (int, float)) or isinstance(stamp, bool) or not math.isfinite(stamp):
            continue
        try:
            day = datetime.fromtimestamp(stamp, exchange_timezone).date()
        except (ValueError, OverflowError, OSError):
            continue
        # Yahoo may append a live FX quote dated Saturday. It is not a
        # completed daily business-day observation and must not become
        # an extra portfolio session or silently replace Friday's rate.
        if symbol.endswith("=X") and day.weekday() >= 5:
            continue
        # Keep only completed sessions, not an intraday quote presented as a close.
        if day > today or (day == today and isinstance(close_time, (int, float)) and now.timestamp() < close_time):
            continue
        if close is not None and (not isinstance(close, (int, float)) or isinstance(close, bool) or
                                  not math.isfinite(close) or close <= 0):
            continue
        by_date[day.isoformat()] = round(close, 6) if close is not None else None
    history = [[day, value] for day, value in sorted(by_date.items())]
    if len([row for row in history if row[1] is not None]) < 2:
        raise macro.SourceError(f"{symbol}: moins de deux clôtures valides")
    return history

def complete_etf_history(definition: dict, history: list[list], now: datetime, instrument_type=None) -> tuple[list[list], dict | None]:
    """Append missing Cboe ETF closes from the existing official-market pipeline.

    Never overwrite Yahoo history, mix listings or use a live quote. The last
    Yahoo close must agree with the official anchor before adding later days.
    """
    symbol = definition["quote_symbol"]
    if (definition.get("currency") != "CAD" or not symbol.endswith(".NE")
            or str(instrument_type or definition.get("instrument_type", "")).upper() != "ETF"):
        return history, None
    expected = daily.completed_session(now)
    last, close = next(row for row in reversed(history) if row[1] is not None)
    if last >= expected.isoformat():
        return history, None
    if (expected - datetime.fromisoformat(last).date()).days > 10:
        raise macro.SourceError(symbol + ": historique trop ancien pour compléter les clôtures")
    official = daily.tmx_closes(daily.Client(), symbol[:-3] + ":CC", last, expected.isoformat())
    anchor = official.get(last, {}).get("close")
    if (not isinstance(anchor, (int, float)) or isinstance(anchor, bool) or not math.isfinite(anchor) or anchor <= 0
            or abs(anchor / close - 1) > .0001):
        raise macro.SourceError(symbol + ": désaccord sur la clôture d’ancrage Yahoo/TMX")
    additions = {}
    day = datetime.fromisoformat(last).date() + timedelta(days=1)
    while day <= expected:
        if daily.trading_day(day):
            value = official.get(day.isoformat(), {}).get("close")
            if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value) or value <= 0:
                raise macro.SourceError(symbol + ": clôture officielle manquante au " + day.isoformat())
            additions[day.isoformat()] = round(value, 6)
        day += timedelta(days=1)
    merged = dict(history); merged.update(additions)
    source = {"id": "tmx_closing_history", "source_url": official[expected.isoformat()]["source_url"],
              "date": expected.isoformat(), "checked_at": now.isoformat(), "anchor_date": last,
              "anchor_close": close, "dates": list(additions), "history_source_url": definition["source_url"]}
    return [[day, value] for day, value in sorted(merged.items())], source


def fetch_index(definition: dict, now: datetime) -> dict:
    symbol = definition["quote_symbol"]
    if definition.get("history_years"):
        year = now.year - definition["history_years"]
        start = now.replace(year=year, day=min(now.day, calendar.monthrange(year, now.month)[1]))
        # Include a buffer before the longest chart period so a weekend or
        # holiday at its start can use the preceding completed session.
        query = {"period1": int(start.timestamp()), "period2": int(now.timestamp()), "interval": "1d"}
    else:
        query = {"range": definition.get("history_range", "10y"), "interval": "1d"}
    params = urlencode(query)
    last_error = None
    for host in ("query1.finance.yahoo.com", "query2.finance.yahoo.com"):
        try:
            request = Request(f"https://{host}/v8/finance/chart/{quote(symbol, safe='')}?{params}",
                              headers={"User-Agent": "Mozilla/5.0 SAVY/3.0", "Accept": "application/json"})
            with urlopen(request, timeout=20) as response:
                payload = json.load(response)
            history = parse_history(payload, symbol, now, definition.get("currency"))
            history, source = complete_etf_history(definition, history, now,
                payload["chart"]["result"][0]["meta"].get("instrumentType"))
            point = {**macro.summarize(definition, history, now), "source_url": definition["source_url"]}
            if source:
                point.update(observation_source=source, source_url=source["source_url"], source_label="Yahoo Finance / TMX Money")
            return point
        except (OSError, ValueError, macro.SourceError) as error:
            last_error = error
    raise macro.SourceError(f"{symbol}: cotations inaccessibles ({last_error})")

def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "data")
    args = parser.parse_args(argv)
    output = args.output_dir / "market-indices.json"
    now = datetime.now(timezone.utc)
    try:
        data = macro.collect_sources(definitions(), macro.read_json(output), now, fetcher=fetch_index)
        data["kind"] = "market_indices"
        data["data_provider"] = "Yahoo Finance — indices boursiers et FNB EEM et FEQT, clôtures quotidiennes"
        urls = {p["id"]: p["source_url"] for p in definitions()}
        for point in data["series"]:
            point["source_url"] = point.get("observation_source", {}).get("source_url") or urls[point["id"]]
        if any(point.get("observation_source", {}).get("id") == "tmx_closing_history" for point in data["series"]):
            data["data_provider"] += "; TMX Money pour clôtures FNB manquantes, ancre vérifiée"
        macro.atomic_write_json(output, data, compact=True)
    except macro.SourceError as error:
        print(str(error))
        return 1
    print("Indices coverage:", data["coverage"])
    for point in data["series"]:
        print(point["id"], point["fetch_status"], point["date"], point["value"], len(point["history"]))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
