#!/usr/bin/env python3
"""Refresh the frontier extension from the report's own issuer-source collectors."""
import hashlib
import json
import math
from datetime import datetime, date
from pathlib import Path
from zoneinfo import ZoneInfo
from concurrent.futures import ThreadPoolExecutor, as_completed
from scripts.fnb_sources import Client, fidelity, vanguard, ishares, bmo

ROOT = Path(__file__).resolve().parents[1]

def build(base, config, sources, retrieved):
    dates = base["dates"]
    output = {}
    for ticker, spec in config["funds"].items():
        s = sources[ticker]
        missing = set(dates) - s["returns"].keys()
        if missing:
            raise ValueError(ticker + ": months missing: " + ", ".join(sorted(missing)))
        a = s["assets"]
        if a["equity"] < .92 or any(a[k] > .0005 for k in ("bond", "gold", "crypto")):
            raise ValueError(ticker + ": not an eligible equity ETF")
        if len(s["geo"]) != 5 or len(s["sector"]) != 12 or s["sector"][-1] > .05:
            raise ValueError(ticker + ": incomplete underlying exposures")
        if any(not math.isfinite(s["returns"][m]) for m in dates):
            raise ValueError(ticker + ": invalid returns")
        output[ticker] = {
            "returns": [s["returns"][m] for m in dates],
            "geo": s["geo"], "sector": s["sector"], "equity": a["equity"],
            "mer": s["mer"], "label": {k: spec[k] for k in ("name", "description", "source_url")},
            "max_weight": spec["max_weight"], "source_url": s["source_url"],
            "source_dates": s["dates"], "method": s["return_method"],
            "currency": spec["currency"], "exchange": spec["exchange"]
        }
    return {"schema_version": 1, "as_of": base["assumptions"]["as_of"],
        "dates": dates, "retrieved_at": retrieved, "funds": dict(sorted(output.items())),
        "source_digest": hashlib.sha256(json.dumps(output, sort_keys=True).encode()).hexdigest()}

def main():
    base = json.loads((ROOT / "data/fnb-analysis.json").read_text())
    cfgpath = ROOT / "data/fnb-frontier-model.json"
    config = json.loads(cfgpath.read_text())
    config_digest = hashlib.sha256(cfgpath.read_bytes()).hexdigest()
    dest = ROOT / "data/fnb-frontier-universe.json"
    if dest.exists():
        old = json.loads(dest.read_text())
        if old.get("dates") == base["dates"] and old.get("config_digest") == config_digest:
            print("Expanded universe already aligned to current analysis."); return
    today = datetime.now(ZoneInfo("America/Toronto")).date()
    cutoff = base["dates"][-1]
    client, sources, errors = Client(), {}, []
    collectors = {"ishares": ishares, "vanguard": vanguard, "bmo": bmo, "fidelity": fidelity}
    def one(t):
        spec = config["funds"][t]
        data = collectors[spec["provider"]](client, t, spec, cutoff)
        for key in ("holdings", "geography", "sectors", "assets"):
            if not 0 <= (today - date.fromisoformat(data["dates"][key][:10])).days <= 155:
                raise ValueError(t + ": stale or future-dated " + key)
        return data
    with ThreadPoolExecutor(max_workers=4) as pool:
        pending = {pool.submit(one, t): t for t in config["funds"]}
        for future in as_completed(pending):
            t = pending[future]
            try:
                sources[t] = future.result()
                print(t, "OK", sources[t]["dates"], flush=True)
            except Exception as exc:
                errors.append(t + ": " + str(exc))
                print(t, "FAILED", str(exc), flush=True)
                if t == "ZUQ":
                    query = 'query { portfolios(entityId:"ZUQ",sortDirection:"d",take:1){entityId effectiveDate numberOfEquityPositions kb2Holdings(take:5000){holding allocation assetClass country sector baseMarketValue}}}'
                    raw = client.json("https://df.bmogam.com/api/graphql/etf-funds-production", {"query": query})["data"]["portfolios"][0]
                    print("ZUQ diagnostic", json.dumps(raw), flush=True)
    if errors: raise ValueError("No partial extension published: " + " | ".join(errors))
    out = build(base, config, sources, today.isoformat())
    out["config_digest"] = config_digest
    tmp = dest.with_suffix(".tmp")
    tmp.write_text(json.dumps(out, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n")
    tmp.replace(dest)
    print("Published", len(out["funds"]), "additional funds across", len(out["dates"]), "identical months.")

if __name__ == "__main__":
    main()
