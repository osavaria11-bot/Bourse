"""Frozen robustness selections, comparable backtests and monthly diagnostics.

Selection is a judgement made after inspecting the available history. The final
12 months are therefore a retrospective diagnostic, NOT an untouched holdout.
Only the permanent daily ledger can establish performance after publication.
"""
from copy import deepcopy
from datetime import datetime
import hashlib
import json
import math


def catalogs(root):
    return [json.loads(p.read_text()) for p in sorted((root / "data/fnb-robust").glob("*.json"))]


def validate_catalog(catalog):
    if catalog["schema_version"] != 1 or len(catalog["portfolios"]) != 3:
        raise ValueError("Three robustness selections required")
    published = datetime.fromisoformat(catalog["published_at"].replace("Z", "+00:00"))
    if published.tzinfo is None or catalog["as_of"] >= published.date().isoformat():
        raise ValueError("Invalid robustness publication date")
    ids = [p["id"] for p in catalog["portfolios"]]
    if len(set(ids)) != 3: raise ValueError("Duplicate robust identity")
    caps = {"FEQT": .50, "CGL.C": .05, "XIT": .10, "ZEB": .10, "ZEO": .05, "FINN": .15}
    for p in catalog["portfolios"]:
        if not 0 <= p["compromise_fraction"] <= 1: raise ValueError("Invalid blend fraction")
        w = p["weights"]
        if {"VEQT", "XEQT"} & w.keys() or abs(sum(w.values()) - 1) > 1e-8:
            raise ValueError("Invalid robust allocation")
        if any(not math.isfinite(v) or not 0 < v <= caps.get(t, .35) + 1e-8 for t, v in w.items()):
            raise ValueError("Robust fund cap exceeded")
    return catalog


def validate_sources(root, catalog):
    validate_catalog(catalog)
    source = root / catalog["source"]
    if hashlib.sha256(source.read_bytes()).hexdigest() != catalog["source_sha256"]:
        raise ValueError("Robust selection research source changed")
    archive = json.loads(source.read_text())
    compromise = archive["samples"]["split"]["profiles"]["compromise"]["weights"]
    for p in catalog["portfolios"]:
        alpha = p["compromise_fraction"]
        tickers = set(compromise) | set(catalog["index_core"])
        expected = {t: alpha * compromise.get(t, 0) + (1 - alpha) * catalog["index_core"].get(t, 0) for t in tickers}
        expected = {t: v for t, v in expected.items() if v > 1e-12}
        if set(expected) != set(p["weights"]) or any(abs(expected[t] - p["weights"][t]) > 1e-12 for t in expected):
            raise ValueError("Robust recipe changed")


def apply(analysis, selections, previous=None):
    return apply_frozen(analysis, selections, previous, family="robust", validator=validate_catalog)


def apply_frozen(analysis, selections, previous=None, *, family, validator, benchmark_id="VEQT"):
    """Shared dashboard calculations; each frozen family retains its own policy."""
    # Import lazily: monthly_fnb calls this after defining its common calculators.
    try:
        from .monthly_fnb import portfolio_returns, stats, period_stats
    except ImportError:
        from monthly_fnb import portfolio_returns, stats, period_stats
    d = analysis
    prior = previous or {}
    u, dates, rf = d["universe"], d["dates"], d["assumptions"]["risk_free"]
    d[family + "_selections"] = deepcopy(selections)
    old_ids = set(d.get(family + "_order", []))
    d["order"] = [k for k in d["order"] if k not in old_ids]
    d["exposure_order"] = [k for k in d["exposure_order"] if k not in old_ids]
    d[family + "_order"] = []
    for catalog in selections:
        validator(catalog)
        for item in catalog["portfolios"]:
            k, w = item["id"], item["weights"]
            if any(t not in u["returns"] or len(u["returns"][t]) != len(dates) for t in w):
                raise ValueError("Missing aligned robust return source: " + k)
            q = deepcopy(item)
            q.update({"label": item["name"], "short_name": item["name"], "published_at": catalog["published_at"],
                "backtest_method": "January target rebalance, distributions reinvested; same convention as other dashboard portfolios",
                "selection_note": catalog["limitations"]})
            rr = portfolio_returns(w, u["returns"], dates)
            old = prior.get("results", {}).get(k)
            if old:
                if old["weights"] != w or any(abs(a-b) > 1e-10 for a,b in zip(rr, old["monthly"])):
                    raise ValueError("Frozen robust allocation or acquired return changed: " + k)
                rr[:len(old["monthly"])] = old["monthly"]
            q.update(stats(rr, d["results"][benchmark_id]["monthly"], rf, dates))
            q["mer"] = sum(v * u["mer"][t] for t, v in w.items())
            for asset in ["equity", "bond", "cash", "gold", "crypto"]:
                q[asset] = sum(v * u[asset][t] for t, v in w.items())
            q["geo_equity"] = [sum(v*u["equity"][t]*u["geo"][t][j] for t,v in w.items())/q["equity"] for j in range(5)]
            q["sectors"] = [sum(v*u["equity"][t]*u["sector"][t][j] for t,v in w.items())/q["equity"] for j in range(12)]
            q["geo_total"] = [v*q["equity"] for v in q["geo_equity"]] + [q[a] for a in ["gold", "crypto", "bond", "cash"]]
            q["max_geo_gap"] = max(abs(a-b) for a,b in zip(q["geo_equity"], u["ref_geo"]))
            q["max_sector_gap"] = max(abs(a-b) for a,b in zip(q["sectors"], u["ref_sector"]))
            q["vol_diff"], q["cagr_gap"] = q["vol"]-d["results"][benchmark_id]["vol"], q["cagr"]-d["results"][benchmark_id]["cagr"]
            windows = {"debut_28": (0, min(28,len(dates))), "derniers_12": (max(0,len(dates)-12),len(dates)),
                "derniers_24": (max(0,len(dates)-24),len(dates)), "derniers_6": (max(0,len(dates)-6),len(dates)),
                "derniers_3": (max(0,len(dates)-3),len(dates))}
            diagnostics = {}
            for key,(start,end) in windows.items():
                r, b = rr[start:end], d["results"][benchmark_id]["monthly"][start:end]
                total = math.prod(1+x for x in r)-1; reference = math.prod(1+x for x in b)-1
                diagnostics[key] = {**period_stats(r,b,rf), "start": dates[start], "end": dates[end-1],
                    "months": len(r), "total_return": total, "benchmark_return": reference, "gap": total-reference}
            q["robust_diagnostics"] = diagnostics
            # A review flag never sells or relabels a frozen investment.
            recent = diagnostics["derniers_12"]
            signals = []
            if recent["information"] is None or recent["information"] < 0: signals.append("IR 12 mois négatif ou indisponible")
            if diagnostics["derniers_6"]["gap"] < 0: signals.append("Retard cumulé sur 6 mois face à " + benchmark_id)
            region = q["geo_equity"]
            if q["max_geo_gap"] > .1+1e-8 or any(not lo-1e-8 <= v <= hi+1e-8 for v,lo,hi in zip(region[:4],[.30,.15,.15,.05],[.60,.40,.40,.20])) or region[4] > .05+1e-8:
                signals.append("Limite géographique dépassée")
            if q["max_sector_gap"] > .07+1e-8 or max(q["sectors"]) > .35+1e-8: signals.append("Limite sectorielle dépassée")
            if q["crypto"] > .03+1e-8: signals.append("Limite crypto dépassée")
            q["robust_review"] = {"as_of": d["assumptions"]["as_of"], "review_required": bool(signals), "signals": signals}
            d["results"][k] = q
            d["asset_dates"][k] = {t: d["source_dates"][t]["assets"] for t in w}
            d["checks"][k] = {"weight_sum": sum(w.values()), "allocation_sum": sum(q["geo_total"]),
                "sector_sum": sum(q["sectors"]), "months": len(dates), "geo_limit_pass": q["max_geo_gap"] <= .1+1e-8,
                "sector_limit_pass": q["max_sector_gap"] <= .07+1e-8, "allocation_preserved": True}
            d[family + "_order"].append(k)
    d["order"] = d[family + "_order"] + d["order"]
    d["exposure_order"] = d[family + "_order"] + d["exposure_order"]
    for k in d[family + "_order"]:
        q = d["results"][k]
        q["dominated_by"] = [z for z,r in d["results"].items() if z != k and r["cagr"] >= q["cagr"] and r["vol"] <= q["vol"] and (r["cagr"] > q["cagr"] or r["vol"] < q["vol"])]
    return d
