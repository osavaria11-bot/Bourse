"""Extract dated pre/post observations without changing regular-session prices."""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
import math


def positive(value):
    return isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value) and value > 0


def periods(value):
    if isinstance(value, list):
        return [p for row in value for p in periods(row)]
    if isinstance(value, dict) and positive(value.get("start")) and positive(value.get("end")) and value["end"] > value["start"]:
        return [value]
    return []


def extract(payload, definition, now):
    result = payload["chart"]["result"][0]
    meta = result["meta"]
    if meta.get("symbol") != definition["quote_symbol"] or meta.get("currency") != definition["currency"]:
        raise ValueError("Extended-hours listing/currency mismatch")
    if meta.get("hasPrePostMarketData") is not True:
        return {"pre": None, "post": None}, []
    zone = ZoneInfo(meta["exchangeTimezoneName"])
    schedules = meta.get("tradingPeriods", {})
    if not isinstance(schedules, dict):
        return {"pre": None, "post": None}, []
    timestamps = result.get("timestamp", [])
    rows = result.get("indicators", {}).get("quote", [{}])[0].get("close", [])
    if len(timestamps) != len(rows):
        raise ValueError("Extended-hours candles not aligned")
    # Only completed provider candles: never date an unfinished candle at a
    # future close, or relabel a collection time as the time of a trade.
    candles = [(t, t + 300, v) for t, v in zip(timestamps, rows)
               if positive(t) and t % 300 == 0 and t + 300 <= now.timestamp() and positive(v)]
    candles.sort()
    iso = lambda t: datetime.fromtimestamp(t, timezone.utc).isoformat().replace("+00:00", "Z")
    day = lambda t: datetime.fromtimestamp(t, zone).date().isoformat()
    closes = []
    regular = sorted(periods(schedules.get("regular", [])), key=lambda p: p["start"])
    for p in regular:
        if p["end"] > now.timestamp():
            continue
        values = [v for start, end, v in candles if p["start"] <= start < p["end"] and end <= p["end"]]
        if values:
            closes.append({"session_date": day(p["start"]), "timestamp": iso(p["end"]), "price": values[-1]})
    # Prefer Yahoo's official last regular price / previous close over a
    # five-minute candle close when the metadata identifies the exact session.
    regular_stamp = meta.get("regularMarketTime")
    observed = next((p for p in regular if positive(regular_stamp) and regular_stamp <= now.timestamp() + 300
                     and p["start"] <= regular_stamp <= p["end"] + 300), None)
    official = {}
    if observed:
        if observed["end"] <= now.timestamp() and positive(meta.get("regularMarketPrice")):
            official[observed["end"]] = meta["regularMarketPrice"]
        preceding = [p for p in regular if p["end"] < observed["start"]]
        if preceding and positive(meta.get("previousClose")):
            official[preceding[-1]["end"]] = meta["previousClose"]
    by_time = {row["timestamp"]: row for row in closes}
    for close_time, price in official.items():
        by_time[iso(close_time)] = {"session_date": day(close_time), "timestamp": iso(close_time), "price": price}
    closes = list(by_time.values())
    closes.sort(key=lambda row: row["timestamp"])
    output = {"pre": None, "post": None}
    for phase in output:
        for p in sorted(periods(schedules.get(phase, [])), key=lambda row: row["start"], reverse=True):
            values = [(end, v) for start, end, v in candles if p["start"] <= start < p["end"] and end <= p["end"]]
            baseline = [row for row in closes if
                        (row["timestamp"] < iso(p["start"]) if phase == "pre" else row["timestamp"] == iso(p["start"]))]
            if not values or not baseline or now.timestamp() - values[-1][0] > 7 * 86400:
                continue
            stamp, price = values[-1]
            base = baseline[-1]
            output[phase] = {"price": price, "timestamp": iso(stamp), "session_date": day(p["start"]),
                             "start": iso(p["start"]), "end": iso(p["end"]),
                             "baseline_price": base["price"], "baseline_timestamp": base["timestamp"],
                             "baseline_session_date": base["session_date"], "observation_kind": "candle_close",
                             "fetched_at": now.isoformat().replace("+00:00", "Z"), "fetch_status": "fresh"}
            break
    return output, closes
