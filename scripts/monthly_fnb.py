#!/usr/bin/env python3
"""Research, validate and archive one separate Canadian equity ETF proposal per month."""
import argparse
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
import hashlib
import json
import math
from pathlib import Path
import statistics as st
import subprocess
import tempfile
from zoneinfo import ZoneInfo

try:
    from scripts.fnb_sources import Client, collect, month_end, previous_month
except ModuleNotFoundError:
    from fnb_sources import Client, collect, month_end, previous_month

ROOT = Path(__file__).resolve().parents[1]
MODEL_VERSION = "1.2.0"
PROPOSAL = "proposal"
GEO_NAMES = ["États-Unis", "Canada", "Développés hors Amérique du Nord", "Marchés émergents", "Pays non publiés",
             "Or physique", "Cryptomonnaies indirectes", "Obligations", "Liquidités et autres"]


def read(path):
    return json.loads(path.read_text())


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n")
    temp.replace(path)


def months_between(first, last):
    months, current = [], first
    while current <= last:
        months.append(current)
        current = (month_end(current) + timedelta(days=1)).strftime("%Y-%m")
    return months


def portfolio_returns(weights, returns, dates):
    """Existing convention: initial targets, drift, reset at the start of January."""
    holdings, out = {}, []
    for i, month in enumerate(dates):
        if i == 0 or month.endswith("-01"): holdings = dict(weights)
        before = sum(holdings.values())
        holdings = {t: value * (1 + returns[t][i]) for t, value in holdings.items()}
        out.append(sum(holdings.values()) / before - 1)
    return out


def ratio(numerator, denominator):
    return numerator / denominator if abs(denominator) > 1e-12 else None


def period_stats(returns, benchmark, rf):
    n = len(returns)
    if n < 2: raise ValueError("At least two observations required")
    mu, bm = st.mean(returns), st.mean(benchmark)
    vol = st.stdev(returns) * math.sqrt(12)
    active = [r - b for r, b in zip(returns, benchmark)]
    te = st.stdev(active) * math.sqrt(12)
    beta = ratio(sum((r - mu) * (b - bm) for r, b in zip(returns, benchmark)), sum((b - bm)**2 for b in benchmark))
    return {"cagr": math.prod(1 + r for r in returns)**(12 / n) - 1, "vol": vol,
        "sharpe": ratio(mu * 12 - rf, vol), "beta": beta, "information": ratio(st.mean(active) * 12, te)}


def stats(returns, benchmark, rf, dates):
    out = period_stats(returns, benchmark, rf)
    n = len(returns); wealth = [10000.]
    for r in returns: wealth.append(wealth[-1] * (1 + r))
    peak, dd = 0., []
    for value in wealth:
        peak = max(peak, value); dd.append(value / peak - 1)
    active = [r - b for r, b in zip(returns, benchmark)]
    te = st.stdev(active) * math.sqrt(12)
    excess = st.mean(returns) * 12 - rf
    covariance = sum((r - st.mean(returns)) * (b - st.mean(benchmark)) for r, b in zip(returns, benchmark))
    corr = ratio(covariance, math.sqrt(sum((r - st.mean(returns))**2 for r in returns) * sum((b - st.mean(benchmark))**2 for b in benchmark)))
    downside = math.sqrt(st.mean(min(r - rf / 12, 0)**2 for r in returns) * 12)
    out.update({"arithmetic_return": st.mean(returns) * 12, "total_return": wealth[-1] / 10000 - 1,
        "treynor": ratio(excess, out["beta"] or 0), "tracking_error": 0 if te < 1e-12 else te,
        "active_return": st.mean(active) * 12, "corr": corr, "r_squared": corr**2 if corr is not None else None,
        "max_drawdown": min(dd), "sortino": ratio(excess, downside), "calmar": ratio(out["cagr"], abs(min(dd))),
        "end": wealth[-1], "best_month": max(returns), "worst_month": min(returns),
        "positive_months": sum(r > 0 for r in returns), "months_beat_veqt": sum(r > b + 1e-12 for r, b in zip(returns, benchmark)),
        "drawdown_path": dd, "monthly": list(returns), "wealth": wealth,
        "calendar": {yr: math.prod(1 + r for m, r in zip(dates, returns) if m.startswith(yr)) - 1 for yr in sorted({m[:4] for m in dates})}})
    split = max(2, min(n - 2, n // 2))
    for key, sl in [("early", slice(None, split)), ("recent", slice(split, None))]:
        out[key] = period_stats(returns[sl], benchmark[sl], rf)
    return out


def eligible_funds(config, sources):
    out = []
    crypto_cap = config.get("optimization", {}).get("crypto_cap", 0.)
    for ticker, fund in config["funds"].items():
        if ticker in ("VEQT", "XEQT"): continue  # Benchmarks never become portfolio positions.
        a = sources["funds"][ticker]["assets"]
        # An equity ETF can carry incidental settlement cash; there is no cash sleeve.
        if fund["equity_eligible"] and fund["currency"] == "CAD" and fund["exchange"] in ["TSX", "Cboe Canada"]:
            if a["bond"] > .0005 or a["gold"] > .0005 or a["equity"] < .92: continue
            # The ceiling applies to the portfolio, not to each wrapper's own crypto percentage.
            if crypto_cap <= 0 and a["crypto"] > .0005: continue
            out.append(ticker)
    return sorted(out)


def optimize(returns, names, sources, config, benchmark, rf):
    """Fixed regularized Sharpe objective, long-only, constrained regional/sector risks.

    We do not choose a model by looking at the holdout results. No return forecast
    or expected future Sharpe is displayed as an observed performance.
    """
    import numpy as np
    from scipy.optimize import linprog, minimize
    settings = config["optimization"]; n = len(names)
    x = np.array([returns[t] for t in names]).T[-settings["lookback_months"]:]
    if len(x) < settings["minimum_training_months"]: raise ValueError("Insufficient training history")
    mu = x.mean(axis=0) * 12
    target = np.mean(benchmark[-len(x):]) * 12
    mu = (1 - settings["mean_shrinkage"]) * mu + settings["mean_shrinkage"] * target
    sample = np.cov(x, rowvar=False) * 12
    shrink = settings["covariance_shrinkage"]
    cov = (1 - shrink) * sample + shrink * np.diag(np.diag(sample)) + np.eye(n) * 1e-8
    geo = np.array([sources["funds"][t]["geo"] for t in names]).T
    sec = np.array([sources["funds"][t]["sector"] for t in names]).T
    ref_g = np.array(sources["funds"]["VEQT"]["geo"])
    ref_s = np.array(sources["funds"]["VEQT"]["sector"])
    # Small rounding margin keeps the published 0.1-point weights inside the limits.
    gt = settings["geo_tolerance"] - .002
    ss = settings["sector_tolerance"] - .002
    lower_g = np.maximum(ref_g - gt, [ .30, .15, .15, .05, 0.])
    upper_g = np.minimum(ref_g + gt, [.60, .40, .40, .20, settings["unknown_geography_cap"] - .002])
    lower_s = np.maximum(ref_s - ss, 0)
    upper_s = np.minimum(ref_s + ss, settings["sector_cap"] - .002)
    eq = np.array([sources["funds"][t]["assets"]["equity"] for t in names])
    # Exposures are controlled on the equity sleeve, including internal ETF cash.
    g, s = geo * eq, sec * eq
    A = np.vstack([g - upper_g[:,None] * eq, lower_g[:,None] * eq - g,
                   s - upper_s[:,None] * eq, lower_s[:,None] * eq - s])
    b = np.zeros(A.shape[0])
    crypto = np.array([sources["funds"][t]["assets"]["crypto"] for t in names])
    crypto_cap = settings.get("crypto_cap", 0.)
    if not math.isfinite(crypto_cap) or not 0 <= crypto_cap <= 1 or np.any(~np.isfinite(crypto)) or np.any((crypto < 0) | (crypto > 1)):
        raise ValueError("Invalid cryptocurrency exposure or limit")
    # Preserve room for the final rounding of each weight to 0.1 percentage point.
    crypto_bound = max(0., crypto_cap - .001 * crypto.sum()) if crypto_cap > 0 else .0005
    A = np.vstack([A, crypto]); b = np.r_[b, crypto_bound]
    cap = np.array([config["funds"][t]["max_weight"] for t in names])
    fees = np.array([sources["funds"][t]["mer"] for t in names])
    def objective(w):
        sharpe = (mu @ w - rf) / np.sqrt(w @ cov @ w)
        return -sharpe + settings["concentration_penalty"] * (w @ w) + settings["fee_penalty"] * (fees @ w)
    constraints = [{"type": "eq", "fun": lambda w: w.sum() - 1}, {"type": "ineq", "fun": lambda w: b - A @ w}]
    def solve(bounds, start=None):
        feasible = linprog(np.zeros(n), A_ub=A, b_ub=b, A_eq=np.ones((1,n)), b_eq=[1.], bounds=bounds, method="highs")
        if not feasible.success: return None
        s = minimize(objective, start if start is not None else feasible.x, method="SLSQP", bounds=bounds,
            constraints=constraints, options={"maxiter": 500, "ftol": 1e-11})
        if not s.success or abs(s.x.sum() - 1) > 1e-7 or np.max(A @ s.x - b) > 1e-7: return None
        return s.x
    full = solve([(0., c) for c in cap])
    if full is None: raise ValueError("No diversified equity allocation satisfies the model")
    # Prune the least useful positions; each removal must leave a feasible problem.
    active = {i for i, w in enumerate(full) if w >= .00001}
    best = full
    for i in sorted(active, key=lambda i: full[i]):
        proposed = active - {i}
        if len(proposed) < 4: continue
        bounds = [(settings["min_weight"], cap[j]) if j in proposed else (0., 0.) for j in range(n)]
        candidate = solve(bounds)
        if candidate is not None and (len(active) > settings["max_funds"] or objective(candidate) <= objective(best) + .005):
            active, best = proposed, candidate
    if len(active) > settings["max_funds"]: raise ValueError("Could not limit the proposal to eight ETFs")
    # Refit with minimum tradeable weights on the final set, then round to 0.1 pp.
    best = solve([(settings["min_weight"], cap[j]) if j in active else (0., 0.) for j in range(n)])
    if best is None: raise ValueError("Final allocation is infeasible")
    units = np.floor(best * 1000 + 1e-8).astype(int)
    remaining = 1000 - units.sum()
    for j in sorted(active, key=lambda j: best[j] * 1000 - units[j], reverse=True)[:remaining]: units[j] += 1
    rounded = units / 1000
    actual_geo, actual_sec = g @ rounded / (eq @ rounded), s @ rounded / (eq @ rounded)
    if np.max(np.r_[actual_geo, -actual_geo, actual_sec, -actual_sec] - np.r_[np.minimum(ref_g + settings["geo_tolerance"], [.60,.40,.40,.20,settings["unknown_geography_cap"]]),
            -np.maximum(ref_g - settings["geo_tolerance"], [.30,.15,.15,.05,0]),
            np.minimum(ref_s + settings["sector_tolerance"], settings["sector_cap"]), -np.maximum(ref_s - settings["sector_tolerance"],0)]) > 1e-7:
        raise ValueError("Rounded proposal violates diversification limits")
    if np.max(rounded - cap) > 1e-8: raise ValueError("Rounded proposal exceeds an ETF cap")
    if crypto @ rounded > (crypto_cap if crypto_cap > 0 else .0005) + 1e-8:
        raise ValueError("Rounded proposal exceeds the cryptocurrency limit")
    return {t: float(w) for t, w in zip(names, rounded) if w > 0}


def walk_forward(returns, names, sources, config, benchmark, rf, dates):
    """Only earlier returns may train each simulated next-month recommendation."""
    start = config["optimization"]["minimum_training_months"]
    out, audit, previous = [], [], {}
    for i in range(start, len(dates)):
        train = {t: returns[t][:i] for t in names}
        weights = optimize(train, names, sources, config, benchmark[:i], rf)
        gross = sum(w * returns[t][i] for t, w in weights.items())
        turnover = sum(abs(weights.get(t, 0) - previous.get(t, 0)) for t in set(weights) | set(previous))
        net = (1 + gross) * (1 - turnover * config["optimization"]["trading_cost_one_way"]) - 1
        out.append(net)
        previous = {t: w * (1 + returns[t][i]) / (1 + gross) for t, w in weights.items()}
        audit.append({"month": dates[i], "training_end": dates[i - 1], "weights": weights, "return": net, "traded_weight": turnover})
    if len(out) < 2: raise ValueError("Insufficient chronological validation history")
    return {"dates": dates[start:], "monthly": out, "metrics": period_stats(out, benchmark[start:], rf), "audit": audit,
        "benchmark": period_stats(benchmark[start:], benchmark[start:], rf),
        "note": "Recherche rejouée chaque mois sur les seuls rendements antérieurs; frais simulés de 0,05 % par montant négocié. Univers et expositions actuels : ce rejeu n’est pas un historique de recommandations réellement publiées."}


def refresh_analysis(current, baseline, sources, config, generated_at):
    d = deepcopy(current)
    d["results"] = {k: deepcopy(d["results"][k]) for k in baseline["order"]}
    d["order"] = list(baseline["order"])
    cutoff = sources["as_of"][:7]
    dates = months_between(baseline["dates"][0], cutoff)
    if len(dates) < len(current["dates"]) or dates[:len(current["dates"])] != current["dates"]: raise ValueError("Historical months cannot be removed")
    old_returns = current["universe"]["returns"]
    old_returns = {**old_returns, "VEQT": current["results"]["VEQT"]["monthly"]}
    frozen = {}
    for ticker in config["funds"]:
        if ticker in old_returns:
            frozen[ticker] = list(old_returns[ticker])
        else:
            # New candidates require their own complete official history.
            supplied = sources["funds"][ticker]["returns"]
            if any(month not in supplied for month in current["dates"]):
                raise ValueError("New ETF missing common history: " + ticker)
            frozen[ticker] = [supplied[month] for month in current["dates"]]
    for ticker in config["funds"]:
        overlap = [(month, old) for month, old in zip(current["dates"], frozen[ticker]) if month in sources["funds"][ticker]["returns"]]
        if overlap and max(abs(old - sources["funds"][ticker]["returns"][month]) for month, old in overlap) > .05:
            raise ValueError("Large historical source revision or split error: " + ticker)
        for month in dates[len(current["dates"]):]:
            if month not in sources["funds"][ticker]["returns"]: raise ValueError("Missing common month " + ticker + " " + month)
            frozen[ticker].append(sources["funds"][ticker]["returns"][month])
    d["funds"] = sorted(config["funds"])
    d["fund_labels"] = {t: {k: f[k] for k in ("name", "description", "source_url")} for t, f in config["funds"].items()}
    d["dates"] = dates
    d["wealth_dates"] = [month_end(previous_month(month_end(dates[0]))).isoformat()] + [month_end(m).isoformat() for m in dates]
    rf = sources["risk_free"]["rate"]
    u = d["universe"]
    u["returns"] = frozen
    u["dates"] = dates
    for key in ["geo", "sector"]: u[key] = {t: s[key] for t, s in sources["funds"].items()}
    for key in ["equity", "bond", "crypto", "cash", "gold"]: u[key] = {t: s["assets"][key] for t, s in sources["funds"].items()}
    u["mer"] = {t: s["mer"] for t, s in sources["funds"].items()}
    u["ref_geo"], u["ref_sector"] = u["geo"]["VEQT"], u["sector"]["VEQT"]
    d["geo_names"] = GEO_NAMES
    d["assumptions"].update({"risk_free": rf, "months": len(dates), "as_of": sources["as_of"], "analysis_date": generated_at[:10]})
    d["source_dates"] = {t: s["dates"] for t, s in sources["funds"].items()}
    d["asset_dates"] = {k: {t: sources["funds"][t]["dates"]["assets"] for t in row["weights"]} for k, row in d["results"].items()}
    d["veqt_sector_asof"] = sources["funds"]["VEQT"]["dates"]["sectors"]
    d["sector_comparability"] = "Secteurs GICS des positions officielles, rapprochés des regroupements Fidelity; dates affichées. Expositions courantes, non historiques."
    d["data_methods"] = {t: s["return_method"] for t, s in sources["funds"].items()}
    d["source_urls"] = {t: s["source_url"] for t, s in sources["funds"].items()}
    names = eligible_funds(config, sources)
    if len(names) < 6: raise ValueError("Too few eligible Canadian equity ETFs")
    weights = optimize(frozen, names, sources, config, frozen["VEQT"], rf)
    month = generated_at[:7]
    proposal = {"id": PROPOSAL, "name": "SAVY Actions · " + month, "label": "Proposition mensuelle · " + month,
        "short_name": "Actions " + month, "style_label": "Proposition séparée · FNB d’actions" + (" · crypto ≤ 3 %" if config["optimization"].get("crypto_cap", 0) else ""), "color": "#9ce3cb", "weights": weights,
        "description": "Allocation distincte, optimisée sur les données disponibles. Aucun portefeuille existant n’est remplacé."}
    d["results"][PROPOSAL] = proposal
    d["proposal_order"] = [PROPOSAL]
    d["order"] = [PROPOSAL] + d["order"]
    d["exposure_order"] = [PROPOSAL] + list(baseline["order"])
    for key in d["order"]:
        item = d["results"][key]; weights = item["weights"]
        if key != PROPOSAL and weights != baseline["results"][key]["weights"]: raise ValueError("Existing allocation changed: " + key)
        rr = portfolio_returns(weights, frozen, dates)
        if key != PROPOSAL and key in current["results"]:
            if max(abs(a - b) for a, b in zip(rr, current["results"][key]["monthly"])) > 1e-10:
                raise ValueError("An acquired portfolio return changed: " + key)
            rr[:len(current["dates"])] = current["results"][key]["monthly"]
        item.update(stats(rr, frozen["VEQT"], rf, dates))
        item["mer"] = sum(w * u["mer"][t] for t, w in weights.items())
        for a in ["equity", "bond", "cash", "gold", "crypto"]: item[a] = sum(w * u[a][t] for t, w in weights.items())
        eq = item["equity"]
        item["geo_equity"] = [sum(w * u["equity"][t] * u["geo"][t][j] for t, w in weights.items()) / eq for j in range(5)]
        item["sectors"] = [sum(w * u["equity"][t] * u["sector"][t][j] for t, w in weights.items()) / eq for j in range(12)]
        item["geo_total"] = [v * eq for v in item["geo_equity"]] + [item[a] for a in ["gold", "crypto", "bond", "cash"]]
        item["max_geo_gap"] = max(abs(a - b) for a, b in zip(item["geo_equity"], u["ref_geo"]))
        item["max_sector_gap"] = max(abs(a - b) for a, b in zip(item["sectors"], u["ref_sector"]))
        d["checks"][key] = {"weight_sum": sum(weights.values()), "allocation_sum": sum(item["geo_total"]),
            "sector_sum": sum(item["sectors"]), "months": len(dates), "geo_limit_pass": item["max_geo_gap"] <= .1,
            "sector_limit_pass": item["max_sector_gap"] <= .1, "allocation_preserved": key == PROPOSAL or weights == baseline["results"][key]["weights"]}
    ref = d["results"]["VEQT"]
    for key, item in d["results"].items():
        item["vol_diff"], item["cagr_gap"] = item["vol"] - ref["vol"], item["cagr"] - ref["cagr"]
        item["dominated_by"] = [k for k, z in d["results"].items() if k != key and z["cagr"] >= item["cagr"] and z["vol"] <= item["vol"] and (z["cagr"] > item["cagr"] or z["vol"] < item["vol"])]
    d["pairwise"] = []
    pairs = [("10", "FBAL"), ("10", "VBAL"), ("11", "FGRO"), ("11", "VGRO")] + [(PROPOSAL, k) for k in baseline["order"]]
    for p, b in pairs:
        a, bb = d["results"][p], d["results"][b]
        rel = period_stats(a["monthly"], bb["monthly"], rf)
        active = [x - y for x, y in zip(a["monthly"], bb["monthly"])]
        d["pairwise"].append({"portfolio": p, "comparable": b, "cagr_gap": a["cagr"] - bb["cagr"], "vol_gap": a["vol"] - bb["vol"],
            "sharpe_gap": a["sharpe"] - bb["sharpe"], "active_return": st.mean(active) * 12, "tracking_error": st.stdev(active) * math.sqrt(12),
            "information": rel["information"], "beta_vs_comparable": rel["beta"], "corr": None})
    validation = walk_forward(frozen, names, sources, config, frozen["VEQT"], rf, dates)
    p = d["results"][PROPOSAL]
    beats = [k for k in baseline["order"] if p["sharpe"] > d["results"][k]["sharpe"]]
    best = max(baseline["order"], key=lambda k: d["results"][k]["sharpe"])
    reasons = [f"Sharpe historique supérieur à {len(beats)} des {len(baseline['order'])} portefeuilles et comparables suivis sur la période commune.",
        f"{len(p['weights'])} FNB d’actions cotés au Canada; quatre régions et plafonds par fonds et secteur.",
        "Rendements moyens et covariance régularisés pour limiter la concentration liée au seul historique."]
    if d["results"][best]["sharpe"] > p["sharpe"]:
        reasons.append("Le meilleur Sharpe historique demeure celui de " + d["results"][best].get("name", best) + "; la proposition privilégie une allocation entièrement en FNB d’actions.")
    vf = validation["metrics"]["sharpe"] - validation["benchmark"]["sharpe"]
    reasons.append("Le rejeu chronologique " + ("améliore" if vf > 0 else "n’améliore pas") + " le Sharpe de VEQT sur sa fenêtre de validation. Aucune surperformance future n’est établie.")
    model_hash = hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()
    d["optimization"] = {"schema_version": 1, "model_version": MODEL_VERSION, "model_sha256": model_hash, "month": month,
        "generated_at": generated_at, "as_of": sources["as_of"], "proposal_id": PROPOSAL, "eligible_funds": names,
        "constraints": config["optimization"], "validation": validation, "reasons": reasons, "beats_sharpe": beats,
        "risk_free": sources["risk_free"], "allocation_type": "100 % de l’allocation en FNB principalement investis en actions; crypto indirecte limitée à 3 % du portefeuille et liquidités internes visibles." if config["optimization"].get("crypto_cap", 0) else "100 % de l’allocation en FNB d’actions; liquidités opérationnelles internes des FNB visibles dans la répartition.",
        "history_policy": "Pondérations existantes et rendements mensuels acquis inchangés; ajouts des seuls mois complétés. Les ratios de chaque publication sont archivés séparément.",
        "performance_type": "Simulation rétrospective, distributions réinvesties. Le suivi après publication commence au premier mois complet suivant la publication.",
        "source_digest": hashlib.sha256(json.dumps(sources, sort_keys=True).encode()).hexdigest()}
    return d


def validate(d, baseline):
    if d["custom_order"] != baseline["custom_order"]: raise ValueError("Existing portfolio list changed")
    n = len(d["dates"])
    for key in d["order"]:
        r = d["results"][key]
        if len(r["monthly"]) != n or len(r["wealth"]) != n + 1: raise ValueError("Misaligned series " + key)
        if abs(sum(r["weights"].values()) - 1) > 1e-8 or abs(sum(r["geo_total"]) - 1) > 1e-6: raise ValueError("Invalid weights " + key)
        if key in baseline["results"]:
            old = baseline["results"][key]
            if r["weights"] != old["weights"] or r["monthly"][:len(old["monthly"])] != old["monthly"]: raise ValueError("Historical data altered " + key)
        if not all(math.isfinite(r[k]) for k in ["cagr", "vol", "sharpe", "end"]): raise ValueError("Invalid performance " + key)
    p = d["results"][PROPOSAL]
    if not set(p["weights"]) <= set(d["optimization"]["eligible_funds"]): raise ValueError("Non-equity proposal holding")
    if p["max_geo_gap"] > .1 + 1e-8 or p["max_sector_gap"] > .1 + 1e-8: raise ValueError("Proposal concentration breach")
    for a in ["bond", "gold"]:
        if p[a] > .0005: raise ValueError("Proposal includes " + a)
    crypto_cap = d["optimization"]["constraints"].get("crypto_cap", 0.)
    if not math.isfinite(crypto_cap) or not 0 <= crypto_cap <= 1: raise ValueError("Invalid cryptocurrency limit")
    crypto_bound = crypto_cap if crypto_cap > 0 else .0005
    actual_crypto = sum(w * d["universe"]["crypto"][t] for t, w in p["weights"].items())
    if abs(actual_crypto - p["crypto"]) > 1e-8 or actual_crypto > crypto_bound + 1e-8:
        raise ValueError("Proposal violates its cryptocurrency limit")
    for row in d["optimization"]["validation"]["audit"]:
        if row["training_end"] >= row["month"]: raise ValueError("Look-ahead in chronological validation")
        if sum(w * d["universe"]["crypto"][t] for t, w in row["weights"].items()) > crypto_bound + 1e-8:
            raise ValueError("Chronological allocation exceeds its cryptocurrency limit")


def history_index(root, current, baseline):
    entries = []
    for file in sorted((root / "data/fnb-history").glob("????-??.json"), reverse=True):
        old = read(file); o = old["optimization"]; p = old["results"][PROPOSAL]
        future_dates = [m for m in current["dates"] if m > o["month"]]
        # First full month after actual publication: acquired periods are not backfilled as live performance.
        indices = [current["dates"].index(m) for m in future_dates]
        if future_dates:
            rr = portfolio_returns(p["weights"], {t: [current["universe"]["returns"][t][i] for i in indices] for t in p["weights"]}, future_dates)
        else: rr = []
        entries.append({"month": o["month"], "generated_at": o["generated_at"], "as_of": o["as_of"],
            "report": "reports/fnb-history/" + o["month"] + ".html", "data": "data/fnb-history/" + file.name,
            "weights": p["weights"], "sharpe_at_publication": p["sharpe"], "forward": {"dates": future_dates, "monthly": rr,
                "total_return": math.prod(1 + r for r in rr) - 1 if rr else None}})
    return {"schema_version": 1, "updated_at": current["optimization"]["generated_at"], "entries": entries,
        "baseline": {"report": "reports/fnb-history/baseline-2026-10-19.html", "data": config_baseline_path(baseline)}}


def config_baseline_path(baseline):
    return "data/fnb-history/baseline-2026-10-19.json"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--cache", type=Path)
    parser.add_argument("--sources", type=Path, help="Replay a complete source snapshot for reproducible validation")
    parser.add_argument("--check", action="store_true", help="Validate the latest committed analysis without network access")
    parser.add_argument("--due", action="store_true", help="Print true only when this calendar month is not yet published")
    parser.add_argument("--date", type=date.fromisoformat, default=None)
    args = parser.parse_args(argv)
    root = args.root.resolve(); config = read(root / "data/fnb-model.json"); baseline = read(root / config["baseline"])
    now_local = datetime.now(ZoneInfo("America/Toronto"))
    today = args.date or now_local.date()
    month, cutoff = today.strftime("%Y-%m"), previous_month(today)
    archive = root / "data/fnb-history" / (month + ".json")
    if args.due:
        print("false" if archive.exists() else "true"); return 0
    current_file = root / "data/fnb-analysis.json"
    if args.check:
        current = read(current_file); validate(current, baseline)
        for file in (root / "data/fnb-history").glob("????-??.json"): validate(read(file), baseline)
        print("Validated", len(current["order"]), "series; allocations and acquired historical returns preserved."); return 0
    if archive.exists():
        validate(read(archive), baseline)
        print("Monthly recommendation already published; immutable archive retained:", month); return 0
    generated_at = now_local.replace(year=today.year, month=today.month, day=today.day).isoformat(timespec="seconds")
    try:
        sources = read(args.sources) if args.sources else collect(config, cutoff, today, Client(args.cache))
        if sources["as_of"][:7] != cutoff: raise ValueError("Sources do not cover the latest completed month")
        current = read(current_file) if current_file.exists() else baseline
        d = refresh_analysis(current, baseline, sources, config, generated_at)
        validate(d, baseline)
        # Consolidation uses exactly the same issuer-name harmonisation as existing reports.
        holdings = {"retrieved_at": today.isoformat(), "weight_units": "fraction_of_fund_nav",
            "funds": {t: f["holdings"] for t, f in sources["funds"].items()}}
        js = "const fs=require('node:fs'),{consolidate}=require('./scripts/fnb_holdings.cjs');const x=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(JSON.stringify(Object.fromEntries(x.order.map(k=>[k,consolidate(x.results[k].weights,x.funds)]))));"
        consolidated = json.loads(subprocess.run(["node", "-e", js], cwd=root, input=json.dumps({"order": d["order"], "results": d["results"], "funds": holdings["funds"]}),
            text=True, capture_output=True, check=True).stdout)
        d["lookthrough"] = {"retrieved_at": today.isoformat(), "method": "Poids cibles × positions officielles; sociétés et classes harmonisées; poids dans le portefeuille total.", "results": consolidated}
        # Render in a temporary checkout-shaped directory before touching published files.
        with tempfile.TemporaryDirectory(prefix="savy-fnb-") as stage:
            stage = Path(stage)
            (stage / "data").mkdir(); (stage / "reports").mkdir()
            (stage / "reports/portefeuilles-fnb.html").write_text((root / "reports/portefeuilles-fnb.html").read_text())
            write(stage / "data/fnb-analysis.json", d)
            subprocess.run(["node", str(root / "scripts/build_monthly_fnb.cjs"), str(stage)], cwd=root, check=True)
            rendered = (stage / "reports/portefeuilles-fnb.html").read_text()
            d["preference_ranking"] = read(stage / "data/fnb-analysis.json")["preference_ranking"]
        # Snapshot names are month-unique; reruns never append duplicate recommendations.
        write(archive, d)
        write(root / "data/fnb-analysis.json", d)
        required = {t for k in d["custom_order"] + d["proposal_order"] for t in d["results"][k]["weights"]}
        write(root / "data/fnb-holdings.json", {**holdings, "funds": {t: value for t, value in holdings["funds"].items() if t in required}})
        write(root / "data/fnb-lookthrough.json", d["lookthrough"])
        write(root / "data/fnb-history/index.json", history_index(root, d, baseline))
        (root / "reports/portefeuilles-fnb.html").write_text(rendered)
        archived_html = rendered.replace("../css/", "../../css/").replace("../js/", "../../js/")
        (root / "reports/fnb-history" / (month + ".html")).write_text(archived_html)
        write(root / "data/fnb-status.json", {"schema_version": 1, "status": "current", "checked_at": generated_at,
            "last_success": generated_at, "month": month, "as_of": sources["as_of"], "next_run": (month_end(month) + timedelta(days=1)).isoformat()})
        print("Published separate proposal:", month, d["results"][PROPOSAL]["weights"])
        return 0
    except Exception as exc:
        status_file = root / "data/fnb-status.json"
        previous = read(status_file) if status_file.exists() else {}
        write(status_file, {**previous, "schema_version": 1, "status": "retrying", "checked_at": generated_at,
            "pending_month": month, "message": "Mise à jour incomplète; dernier instantané validé conservé. Nouvelle tentative automatique quotidienne.", "error": str(exc)[:1800]})
        raise


if __name__ == "__main__":
    raise SystemExit(main())
