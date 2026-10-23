"""Frozen S&P 500 research portfolios and their dated daily registrations.

Research rebalances each January. Reused before/after windows are retrospective;
the common-start simulation and append-only post-publication ledger are separate.
"""
from datetime import datetime
import hashlib
import json
import math

from robust_fnb import apply_frozen


def catalogs(root):
    return [json.loads(p.read_text()) for p in sorted((root / "data/fnb-recommended").glob("*.json"))]


def validate_catalog(catalog):
    if catalog["schema_version"] != 1 or len(catalog["portfolios"]) != 3 or catalog["veqt_cap"] != .40:
        raise ValueError("Invalid S&P 500 selection policy")
    published = datetime.fromisoformat(catalog["published_at"].replace("Z", "+00:00"))
    if published.tzinfo is None or catalog["as_of"] >= published.date().isoformat():
        raise ValueError("Invalid selection publication date")
    if catalog["benchmark"] != "VFV" or catalog["rebalance"] != "january_targets":
        raise ValueError("Unexpected benchmark or historical rebalance")
    ids = [p["id"] for p in catalog["portfolios"]]
    if len(set(ids)) != 3 or any(not k.startswith("recommended-") for k in ids):
        raise ValueError("Duplicate or invalid selection identity")
    caps = {"VEQT": .40, "FEQT": .50, "FINN": .15, "CGL.C": .05, "XIT": .10, "ZEB": .10, "ZEO": .05}
    for p in catalog["portfolios"]:
        w = p["weights"]
        if "XEQT" in w or not 1 <= len(w) <= 8 or abs(sum(w.values()) - 1) > 1e-8:
            raise ValueError("Invalid recommended allocation")
        if p["benchmark"] != "VFV":
            raise ValueError("S&P 500 selection benchmark changed")
        if any(not math.isfinite(v) or not .02 <= v <= caps.get(t, .35) + 1e-8 for t, v in w.items()):
            raise ValueError("Recommended fund cap exceeded")
    return catalog


def research_period(returns, dates, benchmark, rf, sp500):
    from monthly_fnb import stats
    q = stats(returns, sp500, rf, dates)
    keys = ("cagr", "vol", "sharpe", "beta", "information", "tracking_error", "treynor", "sortino", "max_drawdown", "end")
    result = {k: q[k] for k in keys}
    complete = all(v is not None for v in benchmark)
    veqt = stats(returns, benchmark, rf, dates) if complete else None
    sp500_cagr = math.prod(1+r for r in sp500)**(12/len(sp500))-1
    result.update({"start": dates[0], "end": dates[-1], "months": len(dates), "end_value": q["end"],
        "total_return": q["end"]/10000-1, "benchmark_cagr": math.prod(1+r for r in benchmark)**(12/len(benchmark))-1 if complete else None,
        "information_veqt": veqt["information"] if veqt else None,
        "sp500_cagr": sp500_cagr, "information_sp500": q["information"],
        "sp500_cagr_gap": q["cagr"]-sp500_cagr, "beats_sp500": q["cagr"] > sp500_cagr+1e-10})
    return result


def backtest(item, source, catalog):
    from monthly_fnb import months_between, portfolio_returns
    dates = months_between(item["history_start"], catalog["as_of"][:7])
    funds, w = source["funds"], item["weights"]
    if any(t not in funds or any(m not in funds[t]["returns"] for m in dates) for t in [*w, "VFV", "VEQT"]):
        raise ValueError("Missing genuine long-history return: " + item["id"])
    rr = portfolio_returns(w, {t: [funds[t]["returns"][m] for m in dates] for t in w}, dates)
    bb = [funds["VEQT"]["returns"][m] for m in dates]
    sp500 = [funds["VFV"]["returns"][m] for m in dates]
    periods = {}
    for key, indices in {"full": list(range(len(dates))),
        "before": [i for i,m in enumerate(dates) if m <= "2023-12"],
        "after": [i for i,m in enumerate(dates) if m >= "2024-01"]}.items():
        periods[key] = research_period([rr[i] for i in indices], [dates[i] for i in indices], [bb[i] for i in indices], source["risk_free"], [sp500[i] for i in indices])
    periods["comparable"] = dict(periods["full"])
    periods["before_comparable"] = dict(periods["before"])
    return {"source": catalog["source"], "source_sha256": catalog["source_sha256"], "as_of": catalog["as_of"],
        "rebalance": "january_targets", "risk_free": source["risk_free"], "benchmark": "VFV",
        "validation_type": "retrospective_reused", "selection_method": item["selection_method"],
        "dates": dates, "monthly": rr, "benchmark_monthly": bb, "sp500_proxy": "VFV", "sp500_monthly": sp500, "periods": periods}


def validate_sources(root, catalog):
    validate_catalog(catalog)
    file = root / catalog["source"]
    if hashlib.sha256(file.read_bytes()).hexdigest() != catalog["source_sha256"]:
        raise ValueError("Frozen long-history research source changed")
    source = json.loads(file.read_text())
    if source["currency"] != "CAD" or source["as_of"] != catalog["as_of"]:
        raise ValueError("Long-history source identity mismatch")
    for item in catalog["portfolios"]:
        if item["historical_backtest"] != backtest(item, source, catalog):
            raise ValueError("Frozen research allocation or result changed: " + item["id"])


def apply(analysis, selections, previous=None):
    from monthly_fnb import stats, period_stats
    d = apply_frozen(analysis, selections, previous, family="recommended", validator=validate_catalog)
    dates, rf = d["dates"], d["assumptions"]["risk_free"]
    for c in selections:
        for p in c["portfolios"]:
            q = d["results"][p["id"]]
            if previous and p["id"] in previous["results"] and previous["results"][p["id"]]["historical_backtest"] != p["historical_backtest"]:
                raise ValueError("Published long-history research changed")
            benchmark = d["results"]["VFV"]
            q.update(stats(q["monthly"], benchmark["monthly"], rf, dates))
            q["vol_diff"], q["cagr_gap"] = q["vol"]-benchmark["vol"], q["cagr"]-benchmark["cagr"]
            q["months_beat_benchmark"] = q.pop("months_beat_veqt")
            q["months_beat_veqt"] = sum(r>b+1e-12 for r,b in zip(q["monthly"], d["results"]["VEQT"]["monthly"]))
            for m in q["robust_diagnostics"].values():
                a, z = dates.index(m["start"]), dates.index(m["end"])+1
                rr, bb = q["monthly"][a:z], benchmark["monthly"][a:z]
                m.update(period_stats(rr, bb, rf))
                m["benchmark_return"] = math.prod(1+r for r in bb)-1
                m["gap"] = m["total_return"]-m["benchmark_return"]
            signals = [s for s in q["robust_review"]["signals"] if not s.startswith(("IR 12 mois", "Retard cumulé"))]
            if q["robust_diagnostics"]["derniers_12"]["information"] is None or q["robust_diagnostics"]["derniers_12"]["information"] < 0:
                signals.append("IR 12 mois / S&P 500 négatif ou indisponible")
            if q["robust_diagnostics"]["derniers_6"]["gap"] < 0:
                signals.append("Retard cumulé sur 6 mois face au S&P 500")
            q["robust_review"].update(review_required=bool(signals), signals=signals)
            q["selection_note"] = c["limitations"]
    return d
