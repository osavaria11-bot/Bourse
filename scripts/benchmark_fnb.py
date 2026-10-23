"""Dated additional benchmarks without rewriting the initial investment ledger."""
from copy import deepcopy
from datetime import datetime
import json


def catalogs(root):
    return [json.loads(p.read_text()) for p in sorted((root / "data/fnb-benchmarks").glob("*.json"))]


def validate_catalog(catalog):
    if catalog["schema_version"] != 1 or len(catalog["benchmarks"]) != 1:
        raise ValueError("Invalid additional benchmark catalog")
    p = catalog["benchmarks"][0]
    if p["id"] != "VFV" or p["weights"] != {"VFV": 1.}:
        raise ValueError("S&P 500 benchmark must use genuine VFV CAD total returns")
    if datetime.fromisoformat(catalog["published_at"]).tzinfo is None:
        raise ValueError("Benchmark publication must be dated")


def apply(d, selections, previous=None):
    from monthly_fnb import portfolio_returns, stats
    prior = previous or {}
    d["additional_benchmarks"] = deepcopy(selections)
    for c in selections:
        validate_catalog(c)
        for p in c["benchmarks"]:
            k = p["id"]
            u = d["universe"]
            rr = portfolio_returns(p["weights"], u["returns"], d["dates"])
            old = prior.get("results", {}).get(k)
            if old and (old["weights"] != p["weights"] or any(abs(a-b) > 1e-10 for a,b in zip(rr, old["monthly"]))):
                raise ValueError("Acquired benchmark allocation or return changed")
            if old: rr[:len(old["monthly"])] = old["monthly"]
            q = deepcopy(p)
            q.update(stats(rr, d["results"]["VEQT"]["monthly"], d["assumptions"]["risk_free"], d["dates"]))
            for key in ["mer", "equity", "bond", "cash", "gold", "crypto"]: q[key] = u[key][k]
            q["geo_equity"], q["sectors"] = u["geo"][k], u["sector"][k]
            q["geo_total"] = [v*q["equity"] for v in q["geo_equity"]] + [q[a] for a in ["gold", "crypto", "bond", "cash"]]
            q["max_geo_gap"] = max(abs(a-b) for a,b in zip(q["geo_equity"], u["ref_geo"]))
            q["max_sector_gap"] = max(abs(a-b) for a,b in zip(q["sectors"], u["ref_sector"]))
            q["vol_diff"], q["cagr_gap"] = q["vol"]-d["results"]["VEQT"]["vol"], q["cagr"]-d["results"]["VEQT"]["cagr"]
            d["results"][k] = q
            d["asset_dates"][k] = {k: d["source_dates"][k]["assets"]}
            for key in ["order", "exposure_order", "benchmark_order"]:
                if k not in d[key]: d[key].append(k)
    return d
