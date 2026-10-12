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
except ModuleNotFoundError:
    import collect_market_indices as markets

ROOT = Path(__file__).resolve().parents[1]
MACRO_QUOTES = [
    {"id": "VIXCLS", "title": "VIX", "quote_symbol": "^VIX", "currency": "USD"},
    {"id": "NASDAQXAU", "title": "PHLX Gold/Silver Index", "quote_symbol": "^XAU", "currency": "USD"},
    {"id": "VXEEMCLS", "title": "Cboe Emerging Markets ETF Volatility Index", "quote_symbol": "^VXEEM", "currency": "USD"},
    {"id": "UST10Y", "title": "Rendement 10 ans · indice Cboe TNX", "quote_symbol": "^TNX", "currency": "USD"},
    {"id": "WTIFUT", "title": "WTI · contrat à terme proche", "quote_symbol": "CL=F", "currency": "USD"},
    {"id": "DXY", "title": "US Dollar Index · panier de six devises", "quote_symbol": "DX-Y.NYB", "currency": "USD"},
]

def definitions():
    catalog = json.loads((ROOT / "data/securities.json").read_text())
    by_id = {p["id"]: dict(p) for p in [*markets.definitions(), *catalog["series"], *MACRO_QUOTES]}
    return list(by_id.values())

def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)

def parse_quote(payload, definition, now):
    try:
        chart = payload["chart"]
        if chart.get("error"):
            raise ValueError("Provider error")
        meta = chart["result"][0]["meta"]
        price, stamp = meta["regularMarketPrice"], meta["regularMarketTime"]
        if meta["symbol"] != definition["quote_symbol"] or not finite(price) or price <= 0 or not finite(stamp):
            raise ValueError("Wrong symbol or invalid quote")
        if definition.get("currency") and meta.get("currency") != definition["currency"]:
            raise ValueError("Wrong currency")
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
    return {"id": definition["id"], "title": definition["title"], "quote_symbol": meta["symbol"],
        "currency": meta["currency"], "price": price, "previous_close": previous,
        "timestamp": instant.isoformat().replace("+00:00", "Z"), "session_date": session_date,
        "exchange_timezone": meta["exchangeTimezoneName"], "exchange": meta.get("fullExchangeName", meta.get("exchangeName")),
        "instrument_type": meta.get("instrumentType"), "market_state": "regular" if active else "closed",
        "session_start": datetime.fromtimestamp(start, timezone.utc).isoformat().replace("+00:00", "Z"),
        "session_end": datetime.fromtimestamp(end, timezone.utc).isoformat().replace("+00:00", "Z"),
        "provider_delay_minutes": delay, "fetch_status": "fresh", "fetched_at": now.isoformat().replace("+00:00", "Z"),
        "source_label": "Yahoo Finance", "source_url": "https://finance.yahoo.com/quote/" + quote(meta["symbol"], safe="") + "/"}

def fetch_quote(definition, now):
    last_error = None
    for host in ("query1.finance.yahoo.com", "query2.finance.yahoo.com"):
        try:
            request = Request(f"https://{host}/v8/finance/chart/{quote(definition['quote_symbol'], safe='')}?range=1d&interval=1m",
                headers={"User-Agent": "Mozilla/5.0 SAVY/4.0", "Accept": "application/json"})
            with urlopen(request, timeout=12) as response:
                return parse_quote(json.load(response), definition, now)
        except (OSError, ValueError, markets.macro.SourceError) as error:
            last_error = error
    raise markets.macro.SourceError(str(last_error))

def collect(config, previous, now, fetcher=fetch_quote):
    old = {p["id"]: p for p in (previous or {}).get("quotes", [])}
    by_id, errors = {}, []
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        tasks = {executor.submit(fetcher, p, now): p for p in config}
        for task in concurrent.futures.as_completed(tasks):
            definition = tasks[task]
            try:
                by_id[definition["id"]] = task.result()
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
        "collection_interval_minutes": 5, "data_provider": "Yahoo Finance — regular-session exchange quotes",
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
