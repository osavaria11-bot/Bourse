#!/usr/bin/env python3
"""Cache the public provider's estimated-multiple charts, separately from SAVY's
dated 12/24-month consensus archive. Never claim a constant forward horizon.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
import json
import math
from pathlib import Path
import re
import urllib.error
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
TORONTO = ZoneInfo("America/Toronto")
METRICS = {"pe": ("PER", "P/E (Estimate)"), "ev_ebitda": ("EV_EBITDA", "EV / EBITDA (Estimate)")}


def read(path, default=None):
    return json.loads(path.read_text()) if path.exists() else default


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n")
    temp.replace(path)


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=25) as response:
        body = response.read(2_000_001)
    if len(body) > 2_000_000:
        raise ValueError("Réponse historique trop volumineuse")
    return json.loads(body)


def points(rows):
    output = {}
    for stamp, value in rows:
        if not isinstance(stamp, (int, float)) or isinstance(stamp, bool) or not math.isfinite(stamp):
            raise ValueError("Horodatage historique invalide")
        day = datetime.fromtimestamp(stamp / 1000, timezone.utc).date().isoformat()
        if day in output:
            raise ValueError("Séance historique ambiguë")
        output[day] = value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value > 0 else None
    return output


def normalize(payload, key, now):
    data = payload.get("data")
    if payload.get("error") is not False or not isinstance(data, list) or len(data) != 2 or not isinstance(data[0], dict):
        raise ValueError("Historique public absent ou accès limité")
    series, meta = data
    if not isinstance(meta, list) or len(meta) < 3 or meta[0] != "marketscreener.com" or not re.fullmatch(r"[A-Z]{3}", meta[2]):
        raise ValueError("Provenance ou devise du graphique non vérifiée")
    names = [name for name in series if "(Estimate)" not in name and "(Released)" not in name]
    label = METRICS[key][1]
    if len(names) != 1 or label not in series:
        raise ValueError("Émetteur ou multiple estimé absent")
    estimates, quotes = points(series[label]), points(series[names[0]])
    local = now.astimezone(TORONTO)
    cutoff = (local.date() - timedelta(days=int(local.hour < 17))).isoformat()
    # Provider estimates also contain weekends and sometimes a future day.
    # Only the provider's observed price sessions enter the ratio and its RSI.
    sessions = sorted(d for d, value in quotes.items() if d <= cutoff and value is not None)
    values = [[day, estimates.get(day)] for day in sessions]
    if sum(v is not None for _, v in values) < 2:
        raise ValueError("Historique estimé insuffisant")
    return {"series_label": label, "quote_name": names[0], "quote_currency": meta[2],
            "points": values, "definition": "provider_estimate_unspecified_horizon",
            "horizon_months": None, "point_in_time_verified": False,
            "as_of": sessions[-1]}


def collect(instrument, now, output):
    identity = instrument["id"]
    retained = read(ROOT / "data/valuations" / (identity + ".json"), {})
    url = retained.get("source_url", "")
    match = re.fullmatch(r"https://www\.marketscreener\.com/quote/stock/[A-Z0-9_-]+-(\d+)/valuation/", url)
    path = output / (identity + ".json")
    old = read(path, {})
    if not match or retained.get("id") != identity:
        return {"id": identity, "fetch_status": "unavailable", "error": "Source de l’émetteur non rapprochée"}
    metrics, errors = {}, {}
    for key, (code, _) in METRICS.items():
        if key == "ev_ebitda" and instrument.get("financial"):
            continue
        api = "https://www.marketscreener.com/async/graph/af/emy?" + urllib.parse.urlencode({"codeZB": match[1], "type": code})
        try:
            value = normalize(fetch(api), key, now)
            value["source_url"] = api
            value["fetched_at"] = datetime.now(timezone.utc).isoformat()
            if old.get("metrics", {}).get(key, {}).get("as_of", "") > value["as_of"]:
                raise ValueError("La source est plus ancienne que le relevé conservé")
            metrics[key] = value
        except Exception as error:
            errors[key] = str(error)
            if key in old.get("metrics", {}):
                metrics[key] = old["metrics"][key]
            # No alternate client, host, authentication or retry after refusal.
            if isinstance(error, urllib.error.HTTPError) and error.code in (401, 403, 429):
                break
    if len({(m["quote_name"], m["quote_currency"]) for m in metrics.values()}) > 1:
        raise ValueError("Les deux graphiques ne désignent pas la même cotation")
    status = "fresh" if metrics and not errors else "cached" if metrics else "unavailable"
    item = {"schema_version": 1, "kind": "savy_provider_valuation_history", "id": identity,
            "source_url": url, "checked_at": now.isoformat(), "fetch_status": status,
            "metrics": metrics, "errors": errors}
    write(path, item)
    return {"id": identity, "fetch_status": status, "metrics": {k: {"as_of": m["as_of"], "observations": sum(v is not None for _, v in m["points"])} for k, m in metrics.items()}, "errors": errors}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only")
    args = parser.parse_args(argv)
    now = datetime.now(timezone.utc)
    output = ROOT / "data/valuation-history"
    universe = read(ROOT / "data/valuation-universe.json")
    selected = set(args.only.split(",")) if args.only else None
    instruments = [r for r in universe["instruments"] if selected is None or r["id"] in selected]
    results = {r["id"]: r for r in read(output / "index.json", {}).get("instruments", [])}
    with ThreadPoolExecutor(max_workers=3) as pool:
        for future in as_completed([pool.submit(collect, row, now, output) for row in instruments]):
            row = future.result()
            results[row["id"]] = row
            print(row["id"], row["fetch_status"], row.get("errors", row.get("error", "")), flush=True)
    rows = sorted(results.values(), key=lambda r: r["id"])
    coverage = {key: sum(r["fetch_status"] == key for r in rows) for key in ("fresh", "cached", "unavailable")}
    write(output / "index.json", {"schema_version": 1, "kind": "savy_provider_valuation_history_index", "generated_at": datetime.now(timezone.utc).isoformat(), "instruments": rows, "coverage": coverage})
    print("Coverage:", coverage)
    return 0 if coverage["fresh"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
