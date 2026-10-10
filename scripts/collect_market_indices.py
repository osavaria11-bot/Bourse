#!/usr/bin/env python3
"""Collect daily index closes and the EEM ETF tracking MSCI emerging markets."""
from __future__ import annotations

import argparse
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

try:
    from scripts import generate_daily_briefing as macro
except ModuleNotFoundError:
    import generate_daily_briefing as macro

ROOT = Path(__file__).resolve().parents[1]
MARKETS = [
    ("SPX", "S&P 500", "États-Unis", "^GSPC"),
    ("IXIC", "Nasdaq Composite", "États-Unis", "^IXIC"),
    ("TSX", "S&P/TSX Composite", "Canada", "^GSPTSE"),
    ("STOXX600", "STOXX Europe 600", "Europe", "^STOXX"),
    ("EEM", "MSCI émergents · ETF EEM", "Marchés émergents", "EEM"),
]

def definitions() -> list[dict]:
    return [{"id": sid, "title": title, "category": region, "quote_symbol": symbol,
             "unit": "$ US" if sid == "EEM" else "points", "instrument_type": "etf" if sid == "EEM" else "index",
             "decimals": 2, "frequency": "daily", "transform": "none",
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

def fetch_index(definition: dict, now: datetime) -> dict:
    symbol = definition["quote_symbol"]
    params = urlencode({"range": definition.get("history_range", "10y"), "interval": "1d"})
    last_error = None
    for host in ("query1.finance.yahoo.com", "query2.finance.yahoo.com"):
        try:
            request = Request(f"https://{host}/v8/finance/chart/{quote(symbol, safe='')}?{params}",
                              headers={"User-Agent": "Mozilla/5.0 SAVY/3.0", "Accept": "application/json"})
            with urlopen(request, timeout=20) as response:
                payload = json.load(response)
            history = parse_history(payload, symbol, now, definition.get("currency"))
            return {**macro.summarize(definition, history, now), "source_url": definition["source_url"]}
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
        data["data_provider"] = "Yahoo Finance — indices boursiers et ETF EEM, clôtures quotidiennes"
        urls = {p["id"]: p["source_url"] for p in definitions()}
        for point in data["series"]:
            point["source_url"] = urls[point["id"]]
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
