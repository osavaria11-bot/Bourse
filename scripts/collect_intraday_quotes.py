#!/usr/bin/env python3
"""Collect actual exchange quotes for the public catalogue, never personal positions."""
from __future__ import annotations
import argparse
import concurrent.futures
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

try:
    from scripts import collect_market_indices as markets
    from scripts.extended_hours import extract as extract_extended
except ModuleNotFoundError:
    import collect_market_indices as markets
    from extended_hours import extract as extract_extended

ROOT = Path(__file__).resolve().parents[1]
EXTENDED_REPRESENTATIVES = [
    {"id": "EXTSPX", "title": "Repère S&P 500 · SPY", "quote_symbol": "SPY", "currency": "USD"},
    {"id": "EXTIXIC", "title": "Repère Nasdaq 100 · QQQ", "quote_symbol": "QQQ", "currency": "USD"},
    {"id": "EXTTSX", "title": "Repère MSCI Canada · EWC", "quote_symbol": "EWC", "currency": "USD"},
    {"id": "EXTSTOXX", "title": "Repère MSCI Europe · IEUR", "quote_symbol": "IEUR", "currency": "USD"},
]
MACRO_QUOTES = [
    {"id": "VIXCLS", "title": "VIX", "quote_symbol": "^VIX", "currency": "USD"},
    {"id": "NASDAQXAU", "title": "PHLX Gold/Silver Index", "quote_symbol": "^XAU", "currency": "USD"},
    {"id": "VXEEMCLS", "title": "Cboe Emerging Markets ETF Volatility Index", "quote_symbol": "^VXEEM", "currency": "USD"},
    {"id": "UST10Y", "title": "Rendement 10 ans · indice Cboe TNX", "quote_symbol": "^TNX", "currency": "USD"},
    {"id": "WTIFUT", "title": "WTI · contrat à terme proche", "quote_symbol": "CL=F", "currency": "USD"},
    {"id": "DXY", "title": "US Dollar Index · panier de six devises", "quote_symbol": "DX-Y.NYB", "currency": "USD"},
    {"id": "USDCAD", "title": "USD/CAD", "quote_symbol": "CAD=X", "currency": "CAD"},
]

def definitions():
    catalog = json.loads((ROOT / "data/securities.json").read_text())
    by_id = {p["id"]: dict(p) for p in [*markets.definitions(), *catalog["series"], *MACRO_QUOTES, *EXTENDED_REPRESENTATIVES]}
    return list(by_id.values())

def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)

def parse_quote(payload, definition, now):
    try:
        chart = payload["chart"]
        if chart.get("error"):
            raise ValueError("Provider error")
        result = chart["result"][0]
        meta = result["meta"]
        price, stamp = meta["regularMarketPrice"], meta["regularMarketTime"]
        if meta["symbol"] != definition["quote_symbol"] or not finite(price) or price <= 0 or not finite(stamp):
            raise ValueError("Wrong symbol or invalid quote")
        if definition.get("currency") and meta.get("currency") != definition["currency"]:
            raise ValueError("Wrong currency")
        if definition["id"] == "USDCAD" and not .5 < price < 3:
            raise ValueError("Invalid USD/CAD rate")
        instant = datetime.fromtimestamp(stamp, timezone.utc)
        age = (now - instant).total_seconds()
        if age < -300 or age > 7 * 86400:
            raise ValueError("Quote too old or in future")
        zone = ZoneInfo(meta["exchangeTimezoneName"])
        session_date = instant.astimezone(zone).date().isoformat()
        period = meta["currentTradingPeriod"]["regular"]
        start, end = period["start"], period["end"]
        if not finite(start) or not finite(end) or end <= start:
            raise ValueError("Invalid trading session")
        active = start <= now.timestamp() < end
        previous = meta.get("previousClose", meta.get("chartPreviousClose"))
        previous = previous if finite(previous) and previous > 0 else None
        delay = meta.get("exchangeDataDelayedBy")
        delay = delay if finite(delay) and 0 <= delay <= 120 else None
    except (KeyError, TypeError, IndexError, ValueError, OSError) as error:
        raise markets.macro.SourceError(f"{definition['id']}: invalid intraday quote ({error})") from error
    points, fx_sessions = {}, {}
    timestamps = result.get("timestamp", [])
    indicators = result.get("indicators")
    quote_rows = indicators.get("quote", []) if isinstance(indicators, dict) else []
    closes = quote_rows[0].get("close", []) if isinstance(quote_rows, list) and quote_rows and isinstance(quote_rows[0], dict) else []
    if isinstance(timestamps, list) and isinstance(closes, list) and len(timestamps) == len(closes):
        for tick, close in zip(timestamps, closes):
            if not finite(tick) or not finite(close) or close <= 0 or tick > min(stamp, now.timestamp()):
                continue
            if definition["id"] == "USDCAD" and not .5 < close < 3:
                continue
            try:
                # Yahoo timestamps each candle at its opening. Its close is
                # known at the interval end, or at the actual latest trade
                # for the unfinished candle; never use future FX in a value.
                time = datetime.fromtimestamp(min(tick + 300, stamp), timezone.utc)
                day = time.astimezone(zone).date().isoformat()
                if definition["id"] == "USDCAD" and 0 <= (now - time).total_seconds() <= 7 * 86400:
                    fx_sessions.setdefault(day, {})[time.isoformat().replace("+00:00", "Z")] = close
                if day == session_date:
                    points[time.isoformat().replace("+00:00", "Z")] = close
            except (ValueError, OverflowError, OSError):
                continue
    # A valid last trade remains usable when Yahoo supplies no candles
    # for an illiquid ETF. Retain only its actual exchange timestamp.
    points[instant.isoformat().replace("+00:00", "Z")] = price
    if definition["id"] == "USDCAD":
        fx_sessions[session_date] = points
    return {"id": definition["id"], "title": definition["title"], "quote_symbol": meta["symbol"],
        "currency": meta["currency"], "price": price, "previous_close": previous,
        "timestamp": instant.isoformat().replace("+00:00", "Z"), "session_date": session_date,
        "exchange_timezone": meta["exchangeTimezoneName"], "exchange": meta.get("fullExchangeName", meta.get("exchangeName")),
        "instrument_type": meta.get("instrumentType"), "market_state": "regular" if active else "closed",
        "session_start": datetime.fromtimestamp(start, timezone.utc).isoformat().replace("+00:00", "Z"),
        "session_end": datetime.fromtimestamp(end, timezone.utc).isoformat().replace("+00:00", "Z"),
        "provider_delay_minutes": delay, "fetch_status": "fresh", "fetched_at": now.isoformat().replace("+00:00", "Z"),
        "history_interval_minutes": 5, "intraday_history": [[tick, value] for tick, value in sorted(points.items())],
        "extended_hours_supported": meta.get("hasPrePostMarketData") is True,
        **({"intraday_sessions": {day: [[tick, value] for tick, value in sorted(rows.items())] for day, rows in fx_sessions.items()}} if definition["id"] == "USDCAD" else {}),
        "source_label": "Yahoo Finance", "source_url": "https://finance.yahoo.com/quote/" + quote(meta["symbol"], safe="") + "/"}

def parse_cboe(payload, definition, now):
    """Use the index observation time, never Cboe's later file-generation time."""
    try:
        row = payload["data"]
        if definition["id"] != "SPX" or definition["quote_symbol"] != "^GSPC" or payload["symbol"] != "_SPX" or row["symbol"] != "^SPX" or row["security_type"] != "index":
            raise ValueError("Wrong Cboe index")
        price, previous = row["current_price"], row["prev_day_close"]
        raw = row["last_trade_time"]
        if not isinstance(raw, str) or len(raw) != 19:
            raise ValueError("Missing exchange-local index time")
        local = datetime.fromisoformat(raw).replace(tzinfo=ZoneInfo("America/New_York"))
        instant = local.astimezone(timezone.utc)
        if not finite(price) or price <= 0 or not finite(previous) or previous <= 0 or not -300 <= (now - instant).total_seconds() <= 7 * 86400:
            raise ValueError("Invalid Cboe observation")
        start, end = local.replace(hour=9, minute=30, second=0), local.replace(hour=16, minute=0, second=0)
        if local.weekday() > 4 or not start <= local <= end:
            raise ValueError("Cboe observation outside the index session")
    except (KeyError, TypeError, ValueError, OSError) as error:
        raise markets.macro.SourceError(f"SPX: invalid Cboe quote ({error})") from error
    stamp = instant.isoformat().replace("+00:00", "Z")
    return {"id": "SPX", "title": definition["title"], "quote_symbol": "^GSPC", "currency": "USD",
        "price": price, "previous_close": previous, "timestamp": stamp, "session_date": local.date().isoformat(),
        "exchange_timezone": "America/New_York", "instrument_type": "INDEX", "exchange": "S&P index / Cboe",
        "market_state": "regular" if start <= now < end else "closed",
        "session_start": start.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "session_end": end.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "provider_delay_minutes": 15, "fetch_status": "fresh", "fetched_at": now.isoformat().replace("+00:00", "Z"),
        "history_interval_minutes": 5, "intraday_history": [[stamp, price]], "source_provider": "cboe", "source_symbol": "_SPX",
        "source_label": "Cboe", "source_url": "https://www.cboe.com/delayed_quotes/spx/quote_table"}

def fetch_cboe(definition, now):
    request = Request("https://cdn.cboe.com/api/global/delayed_quotes/quotes/_SPX.json",
        headers={"User-Agent": "Mozilla/5.0 SAVY/4.0", "Accept": "application/json"})
    with urlopen(request, timeout=8) as response:
        return parse_cboe(json.load(response), definition, now)

def fetch_quote(definition, now):
    last_error = None
    candidates = []
    for host in ("query1.finance.yahoo.com", "query2.finance.yahoo.com"):
        try:
            history_range = "5d" if definition["id"] == "USDCAD" else "1d"
            request = Request(f"https://{host}/v8/finance/chart/{quote(definition['quote_symbol'], safe='')}?range={history_range}&interval=5m",
                headers={"User-Agent": "Mozilla/5.0 SAVY/4.0", "Accept": "application/json"})
            with urlopen(request, timeout=8) as response:
                parsed = parse_quote(json.load(response), definition, now)
            candidates.append(parsed)
            # An old HTTP-200 response must also trigger provider recovery.
            age = (now - datetime.fromisoformat(parsed["timestamp"].replace("Z", "+00:00"))).total_seconds()
            local_now = now.astimezone(ZoneInfo("America/New_York"))
            spx_expected_open = definition["id"] == "SPX" and local_now.weekday() < 5 and (9, 30) <= (local_now.hour, local_now.minute) < (16, 0)
            if age <= 25 * 60 or (parsed["market_state"] == "closed" and not spx_expected_open):
                return with_extended(parsed, definition, now)
        except (OSError, ValueError, markets.macro.SourceError) as error:
            last_error = error
    if definition["id"] == "SPX":
        try:
            candidates.append(fetch_cboe(definition, now))
        except (OSError, ValueError, markets.macro.SourceError) as error:
            last_error = error
    if candidates:
        return with_extended(max(candidates, key=lambda p: p["timestamp"]), definition, now)
    raise markets.macro.SourceError(str(last_error))

def with_extended(parsed, definition, now):
    if not parsed.get("extended_hours_supported"):
        return parsed
    for host in ("query1.finance.yahoo.com", "query2.finance.yahoo.com"):
        try:
            request = Request(f"https://{host}/v8/finance/chart/{quote(definition['quote_symbol'], safe='')}?range=5d&interval=5m&includePrePost=true",
                              headers={"User-Agent": "Mozilla/5.0 SAVY/4.0", "Accept": "application/json"})
            with urlopen(request, timeout=8) as response:
                hours, closes = extract_extended(json.load(response), definition, now)
            return {**parsed, "extended_hours": hours, "regular_closes": closes, "extended_fetch_status": "fresh"}
        except (OSError, ValueError, KeyError, TypeError, IndexError):
            pass
    # Extended-hours failure must not stop a valid regular-session quote.
    return {**parsed, "extended_fetch_status": "unavailable"}

def collect(config, previous, now, fetcher=fetch_quote):
    old = {p["id"]: p for p in (previous or {}).get("quotes", [])}
    by_id, errors = {}, []
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        tasks = {executor.submit(fetcher, p, now): p for p in config}
        for task in concurrent.futures.as_completed(tasks):
            definition = tasks[task]
            try:
                result = task.result()
                cached = old.get(definition["id"])
                if result.get("extended_fetch_status") == "unavailable" and cached and cached.get("quote_symbol") == result["quote_symbol"] and cached.get("currency") == result["currency"]:
                    result["extended_hours"] = {key: {**value, "fetch_status": "cached"} if value else None
                                                for key, value in cached.get("extended_hours", {}).items()}
                    result["regular_closes"] = cached.get("regular_closes", [])
                by_id[definition["id"]] = result
            except (OSError, ValueError, markets.macro.SourceError) as error:
                errors.append({"id": definition["id"], "message": str(error)[:180]})
                cached = old.get(definition["id"])
                if cached and cached.get("quote_symbol") == definition["quote_symbol"] and (
                    not definition.get("currency") or cached.get("currency") == definition["currency"]):
                    try:
                        age = (now - datetime.fromisoformat(cached["timestamp"].replace("Z", "+00:00"))).total_seconds()
                        if 0 <= age <= 7 * 86400 and finite(cached.get("price")) and cached["price"] > 0:
                            by_id[definition["id"]] = {**cached, "fetch_status": "cached"}
                    except (KeyError, ValueError, TypeError):
                        pass
    if not by_id:
        raise markets.macro.SourceError("No valid exchange quotes; existing file kept")
    rows = [by_id[p["id"]] for p in config if p["id"] in by_id]
    return {"schema_version": 1, "kind": "intraday_quotes", "generated_at": now.isoformat().replace("+00:00", "Z"),
        "collection_interval_minutes": 5, "data_provider": "Yahoo Finance; Cboe S&P 500 fallback; direct TMX indices in browser",
        "note": "Collecte prévue toutes les cinq minutes. Délai fournisseur possible; l’heure est celle de la cotation. Aucun prix de CFD.",
        "quotes": rows, "coverage": {"fresh": sum(p["fetch_status"] == "fresh" for p in rows),
            "cached": sum(p["fetch_status"] == "cached" for p in rows), "missing": len(config) - len(rows)}, "errors": errors}

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "data")
    args = parser.parse_args(argv)
    output = args.output_dir / "intraday-quotes.json"
    try:
        result = collect(definitions(), markets.macro.read_json(output), datetime.now(timezone.utc))
        markets.macro.atomic_write_json(output, result, compact=True)
    except markets.macro.SourceError as error:
        print(error)
        return 1
    print("Intraday exchange quote coverage:", result["coverage"])
    print("Unavailable sources:", [p["id"] for p in result["errors"]])
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
