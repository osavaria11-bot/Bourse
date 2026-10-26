"""Dated research proposals, never changes registered SAVY portfolios.

Black–Litterman calibration and limits come from the existing JavaScript engine.
Here the joint block paths are aggregated by actual holdings, drifting between
January rebalances. A new Monte Carlo seed tests simulation selection noise; it
is NOT a chronological out-of-sample test or proof of a future success rate.
"""
import argparse
from datetime import datetime
import hashlib
import json
import math
from pathlib import Path
import subprocess
from zoneinfo import ZoneInfo

import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp, minimize
from scipy.special import expit

ROOT = Path(__file__).resolve().parents[1]
HORIZONS = (2, 5, 10)


def wilson(successes, observations):
    if observations <= 0 or not 0 <= successes <= observations:
        raise ValueError("Invalid binomial count")
    z = 1.959963984540054
    p = successes / observations
    denominator = 1 + z*z/observations
    center = (p + z*z/(2*observations))/denominator
    radius = z*math.sqrt(p*(1-p)/observations + z*z/(4*observations**2))/denominator
    return [0. if successes == 0 else max(0., center-radius),
            1. if successes == observations else min(1., center+radius)]


def allocation_valid(weights, packet):
    ids = packet["ids"]
    if set(weights) - set(ids) or not 1 <= len(weights) <= packet["maxFunds"]:
        return False
    w = np.array([weights.get(t, 0) for t in ids])
    caps = np.array(packet["limits"]["caps"])
    return bool(np.isfinite(w).all() and abs(w.sum()-1) < 1e-9
            and all(packet["minWeight"]-1e-9 <= v <= caps[i]+1e-9 for i, v in enumerate(w) if v)
            and np.max(np.array(packet["limits"]["rows"])@w-np.array(packet["limits"]["bounds"])) < 1e-8)


def round_allocation(weights, packet):
    """Nearest feasible 0.1 percentage point weights; never round past a limit."""
    names = list(weights)
    indices = [packet["ids"].index(t) for t in names]
    n = len(names)
    target = np.array([weights[t] for t in names])*1000
    a = np.array(packet["limits"]["rows"])[:, indices]/1000
    caps = np.array(packet["limits"]["caps"])[indices]*1000
    # Integer weight units plus continuous absolute-distance variables.
    matrix = np.vstack([np.c_[a, np.zeros_like(a)],
                        np.r_[np.ones(n), np.zeros(n)][None, :],
                        np.c_[np.eye(n), -np.eye(n)],
                        np.c_[-np.eye(n), -np.eye(n)]])
    lower = np.r_[np.full(len(a), -np.inf), 1000, np.full(2*n, -np.inf)]
    upper = np.r_[packet["limits"]["bounds"], 1000, target, -target]
    result = milp(np.r_[np.zeros(n), np.ones(n)],
                  integrality=np.r_[np.ones(n), np.zeros(n)],
                  bounds=Bounds(np.r_[np.full(n, packet["minWeight"]*1000), np.zeros(n)], np.r_[caps, np.full(n, np.inf)]),
                  constraints=LinearConstraint(matrix, lower, upper), options={"time_limit": 30})
    if not result.success:
        raise ValueError("No defensible rounded allocation: " + result.message)
    out = dict(zip(names, np.rint(result.x[:n])/1000))
    if not allocation_valid(out, packet):
        raise ValueError("Rounded weights violate SAVY limits")
    return out


def portfolio_values(multipliers, weights, start_month=9):
    """Analytical test helper: each row is one month, not an independent year."""
    r = np.asarray(multipliers, dtype=float)
    w = np.asarray(weights, dtype=float)
    if r.ndim != 2 or r.shape[1] != len(w) or np.any(r <= 0) or not np.isfinite(r).all() or np.any(w < 0) or abs(w.sum()-1) > 1e-9:
        raise ValueError("Invalid total-return paths")
    holdings = w.copy()
    values = [1.]
    for t, step in enumerate(r):
        if t and (start_month+t) % 12 == 0:
            holdings = holdings.sum()*w
        holdings *= step
        values.append(float(holdings.sum()))
    return values


def metrics(wealth, benchmark_log, drawdown, years):
    wealth = np.asarray(wealth)
    log_gap = np.log(wealth) - benchmark_log
    wins = int(np.sum(log_gap > 1e-12))
    return {"years": years, "paths": len(wealth), "beatProbability": wins/len(wealth),
            "simulationInterval95": wilson(wins, len(wealth)),
            "tieProbability": float(np.mean(np.abs(log_gap) <= 1e-12)),
            "medianAnnual": float(np.median(wealth)**(1/years)-1),
            "expectedAnnual": float(np.mean(wealth**(1/years)-1)),
            "p10": float(np.quantile(wealth, .1)-1), "median": float(np.median(wealth)-1), "p90": float(np.quantile(wealth, .9)-1),
            "futureValue": float(np.median(wealth)*100000),
            "lossProbability": float(np.mean(wealth < 1)),
            "drawdownProbability": {str(t): float(np.mean(drawdown >= t)) for t in [.2, .3, .4]},
            "medianDrawdown": float(np.median(drawdown))}


def simulate(packet, basis, count, seed, *, vol=1., shift=0., correlation=False, allocations=None):
    """Joint thick-tail block bootstrap; identical paths for all portfolios/VFV.

    Original assets, cores, residuals, mean uncertainty and current-volatility
    adjustment are reused unchanged. No assumed persistence of recent alpha.
    Intermediate horizon measurements never trigger a rebalance.
    """
    if basis not in ('history', 'planning') or not isinstance(count, int) or count < 1:
        raise ValueError('Invalid simulation request')
    p = packet["prepared" if basis == "history" else "planning"]
    rows = p["rows"]
    rng = np.random.default_rng(seed)
    indices = np.array(packet["indices"])
    reference = packet["reference"]
    mu = np.array([r["mean"] for r in rows])
    variance = np.array([r["annualLogVariance"]/12 for r in rows])
    response = np.array([r["viewResponse"] for r in rows])
    beta = np.array([r["beta"] for r in rows])
    delta = rng.standard_normal((count, len(rows)))@np.array(p["means"]["cholesky"]).T
    targets = np.maximum(-.8, mu[None, :]+delta+shift*response[None, :])
    base = np.log1p(targets)/12
    core = np.array(p["core"])
    coefficients = np.array([r["coreCoefficients"] for r in rows])
    residuals = np.array([r["residual"] for r in rows]).T
    correlation_scale = np.array([r["correlationScale"] for r in rows])
    if not p["longAvailable"] or len(core) < 120 or not np.isfinite(coefficients).all():
        raise ValueError("Long common core history required for this dated study")
    growth = np.ones((count, len(rows)))
    closed = []
    benchmark = np.zeros(count)
    bundles, results = {}, {}
    weights = {k: np.array([w.get(t, 0) for t in packet["ids"]]) for k, w in (allocations or {}).items()}
    holdings = {k: np.broadcast_to(w, (count, len(w))).copy() for k, w in weights.items()}
    peak = {k: np.ones(count) for k in weights}
    drawdown = {k: np.zeros(count) for k in weights}
    start_month = int(p["end"][5:7]) % 12
    block = p["options"]["blockLength"]
    for t in range(120):
        if t and (start_month+t) % 12 == 0:
            closed.append(growth[:, indices].copy())
            growth.fill(1.)
            for k in weights:
                holdings[k] = holdings[k].sum(axis=1)[:, None]*weights[k][None, :]
        if t % block == 0:
            short_start = rng.integers(0, len(residuals), count)
            long_start = rng.integers(0, len(core), count)
        offset = t % block
        common = core[(long_start+offset) % len(core)]
        noise = common@coefficients.T + residuals[(short_start+offset) % len(residuals)]
        if correlation:
            noise = (.5*noise+.5*common[:, 0, None]*beta[None, :])*correlation_scale[None, :]
        scale = vol*(1+(p["initialVol"]-1)*math.exp(-t/12))
        step = base-.5*variance[None, :]*scale*scale+noise*scale
        gross = np.exp(step)
        growth *= gross
        benchmark += step[:, reference]
        for k in weights:
            holdings[k] *= gross[:, indices]
            wealth = holdings[k].sum(axis=1)
            peak[k] = np.maximum(peak[k], wealth)
            drawdown[k] = np.maximum(drawdown[k], 1-wealth/peak[k])
        if t+1 in (24, 60, 120):
            years = (t+1)//12
            if not weights:
                bundles[years] = {"segments": np.stack([*closed, growth[:, indices].copy()]), "benchmark": benchmark.copy()}
            else:
                results[years] = {k: metrics(holdings[k].sum(axis=1), benchmark, drawdown[k], years) for k in weights}
    return results if weights else bundles


def smooth_probability(bundle, weights, temperature=.035):
    segments = bundle["segments"]
    values = np.einsum('spn,n->sp', segments, weights)
    relative = np.log(values).sum(axis=0)-bundle["benchmark"]
    p = expit(relative/temperature)
    gradient = np.einsum('spn,sp,p->n', segments, 1/values, p*(1-p))/len(p)/temperature
    return float(p.mean()), gradient


def optimize(packet, bundles, year, start, support=None):
    n = len(start)
    a, b = np.array(packet["limits"]["rows"]), np.array(packet["limits"]["bounds"])
    lower, upper = np.zeros(n), np.array(packet["limits"]["caps"])
    if support is not None:
        for i in range(n):
            if i in support: lower[i] = packet["minWeight"]
            else: upper[i] = 0
    def margins(v):
        return np.array([smooth_probability(s[year], v[:-1])[0]-v[-1] for s in bundles])
    def margin_gradient(v):
        return np.array([np.r_[smooth_probability(s[year], v[:-1])[1], -1.] for s in bundles])
    initial = np.r_[start, min(smooth_probability(s[year], start)[0] for s in bundles)]
    result = minimize(lambda v: -v[-1], initial, jac=lambda v: np.r_[np.zeros(n), -1.], method='SLSQP',
                      bounds=Bounds(np.r_[lower, 0], np.r_[upper, 1]),
                      constraints=[LinearConstraint(np.c_[a, np.zeros(len(a))], -np.inf, b),
                                   LinearConstraint(np.r_[np.ones(n), 0.][None, :], 1, 1),
                                   {"type": "ineq", "fun": margins, "jac": margin_gradient}],
                      options={"maxiter": 150, "ftol": 1e-9})
    w = result.x[:-1]
    valid = (result.success and abs(w.sum()-1) < 1e-7 and np.max(a@w-b) < 1e-7
             and np.all(w >= lower-1e-7) and np.all(w <= upper+1e-7))
    return (w, min(smooth_probability(s[year], w)[0] for s in bundles)) if valid else None


def starting_allocation(packet):
    n = len(packet['ids'])
    caps = np.array(packet['limits']['caps'])
    a = np.array(packet['limits']['rows'])
    matrix = [*np.c_[a, np.zeros_like(a)], np.r_[np.ones(n), np.zeros(n)]]
    lower = [*np.full(len(a), -np.inf), 1.]
    upper = [*packet['limits']['bounds'], 1.]
    for i in range(n):
        row = np.zeros(2*n); row[i] = 1; row[n+i] = -caps[i]
        matrix.append(row); lower.append(-np.inf); upper.append(0.)
        row = np.zeros(2*n); row[i] = -1; row[n+i] = packet['minWeight']
        matrix.append(row); lower.append(-np.inf); upper.append(0.)
    matrix.append(np.r_[np.zeros(n), np.ones(n)])
    lower.append(0.); upper.append(packet['maxFunds'])
    means = np.array([packet['prepared']['rows'][i]['mean'] for i in packet['indices']])
    result = milp(np.r_[-means, np.zeros(n)], integrality=np.r_[np.zeros(n), np.ones(n)],
                  bounds=Bounds(np.zeros(2*n), np.r_[caps, np.ones(n)]),
                  constraints=LinearConstraint(matrix, lower, upper), options={'time_limit': 40})
    if result.x is None:
        raise ValueError('No feasible initial portfolio: '+result.message)
    return result.x[:n]


def search(packet):
    initial = starting_allocation(packet)
    selected = {}
    for years in (2, 10):
        count, seed = (2048, 271828) if years == 2 else (4096, 314159)
        bundles = [simulate(packet, 'history', count, seed)]
        if years == 2:
            bundles += [simulate(packet, 'planning', count, seed),
                        simulate(packet, 'history', count, seed, vol=1.25),
                        simulate(packet, 'history', count, seed, shift=-.03)]
        candidates = []
        for fixed in (False, True):
            support = set(np.flatnonzero(initial > 1e-7)) if fixed else None
            result = optimize(packet, bundles, years, initial, support)
            if result is None:
                continue
            w, score = result
            if support is None:
                support = set(np.flatnonzero(w > 1e-6))
                while len(support) > packet['maxFunds']:
                    trials = []
                    for i in sorted(support, key=lambda i: w[i])[:8]:
                        r = optimize(packet, bundles, years, w, support-{i})
                        if r:
                            trials.append((r, support-{i}))
                    if not trials:
                        break
                    (w, score), support = max(trials, key=lambda x: x[0][1])
                result = optimize(packet, bundles, years, w, support)
                if result:
                    w, score = result
            if sum(w > 1e-7) <= packet['maxFunds']:
                candidates.append((score, w))
        if not candidates:
            raise ValueError('No converged sparse allocation for '+str(years)+' years')
        score, w = max(candidates, key=lambda x: x[0])
        selected[str(years)] = {'weights': dict((t, float(v)) for t, v in zip(packet['ids'], w) if v > 1e-7),
                               'search_paths': count, 'search_seed': seed,
                               'search_criterion': 'worst_of_four_assumptions' if years == 2 else 'central',
                               'internal_smooth_objective': score}
    return selected


def constraint_summary(weights, packet):
    w = np.array([weights.get(t, 0) for t in packet["ids"]])
    limits = packet["limits"]
    eq = np.array(limits["equity"])*w
    geo = eq@np.array(limits["geo"])/eq.sum()
    sector = eq@np.array(limits["sector"])/eq.sum()
    return {"valid": allocation_valid(weights, packet), "funds": len(weights),
            "geo": list(geo), "sector": list(sector),
            "maxGeoGap": float(np.max(np.abs(geo-np.array(limits["refGeo"])))),
            "maxSectorGap": float(np.max(np.abs(sector-np.array(limits["refSector"])))),
            "maxSector": float(sector.max()),
            "crypto": float(w@np.array(limits["assets"]["crypto"])),
            "gold": float(w@np.array(limits["assets"]["gold"])),
            "innovationMomentum": float(sum(weights.get(t, 0) for t in limits['innovationMomentumIds'])),
            "mer": float(sum(weights.get(t, 0)*packet["prepared"]["rows"][packet["indices"][i]]["mer"] for i, t in enumerate(packet["ids"])))}


def evaluate(packet, allocations, count=25000, seed=20261025):
    if count < 25000:
        raise ValueError("25,000 validation paths required")
    if any(not allocation_valid(w, packet) for w in allocations.values()):
        raise ValueError("SAVY limits violated")
    variants = {"central": {}, "volatility": {"vol": 1.25}, "lower": {"shift": -.03},
                "higher": {"shift": .03}, "correlation": {"correlation": True}}
    output = []
    for basis in ("history", "planning"):
        for variant, kwargs in variants.items():
            result = simulate(packet, basis, count, seed, allocations=allocations, **kwargs)
            output.append({"basis": basis, "variant": variant, "horizons": result})
    return output


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':'))+'\n'
    if 'fnb-prospective-history' in path.parts and path.exists() and path.read_text() != payload:
        raise ValueError('A published research archive cannot be replaced: '+str(path))
    temporary = path.with_suffix('.tmp')
    temporary.write_text(payload)
    temporary.replace(path)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    choice = parser.add_mutually_exclusive_group(required=True)
    choice.add_argument('--weights', type=Path)
    choice.add_argument('--search', action='store_true')
    parser.add_argument('--root', type=Path, default=ROOT)
    args = parser.parse_args()
    packet = json.loads(subprocess.check_output(['node', str(args.root/'scripts/prepare_prospective_research.cjs'), str(args.root)], text=True))
    selected = search(packet) if args.search else json.loads(args.weights.read_text())
    allocations = {k: round_allocation(v["weights"], packet) for k, v in selected.items()}
    evaluation = evaluate(packet, allocations)
    now = datetime.now(ZoneInfo('America/Toronto')).isoformat(timespec='seconds')
    study_date = now[:10]
    snapshot_path = 'data/fnb-prospective-history/'+study_date+'-model.json'
    save(args.root/snapshot_path, packet)
    save(args.root/('data/fnb-prospective-history/'+study_date+'-search.json'), selected)
    proposals = []
    for key, w in allocations.items():
        year = int(key)
        central = [v["horizons"][year][key] for v in evaluation if v["variant"] == 'central']
        variants = [v["horizons"][year][key] for v in evaluation]
        proposals.append({"id": 'research-'+key+'y-'+study_date, "name": 'Projet · '+('2 ans' if year == 2 else 'Long terme'),
                          "years": year, "weights": w, "limits": constraint_summary(w, packet),
                          "centralThreshold": all(v["simulationInterval95"][0] >= .5 for v in central),
                          "robustThreshold": all(v["simulationInterval95"][0] >= .5 for v in variants),
                          "probabilityRange": [min(v["beatProbability"] for v in variants), max(v["beatProbability"] for v in variants)],
                          "history": central[0], "planning": central[1]})
    catalog = {
        "schema_version": 1, "kind": "dated_research_proposals", "evaluated_at": now,
        "as_of": packet['prepared']['end'], "benchmark": "VFV", "currency": "CAD", "total_return": True,
        "rebalance": "january_targets", "registered": False, "paths": 25000, "seed": 20261025,
        "search": {k: {a: v for a, v in item.items() if a != 'weights'} for k, item in selected.items()},
        "source": snapshot_path, "source_sha256": hashlib.sha256((args.root/snapshot_path).read_bytes()).hexdigest(),
        "model_version": packet['modelVersion'], "portfolios": proposals, "evaluation": evaluation,
        "fund_names": packet['names'], "source_urls": packet['sourceUrls'],
        "limits": {"max_funds": 8, "min_weight": .02, "FEQT": .5, "FINN": .15, "other": .35,
                   "CGL.C": .05, "XIT": .10, "ZEB": .10, "ZEO": .05, "geo_gap": .10, "sector_gap": .07, "sector_cap": .35, "crypto": .03,
                   "innovation_momentum_cap": .30, "innovation_momentum_funds": ['FINN','FCMO','VMO','XMI']},
        "method": "Black–Litterman SAVY inchangé, bootstrap joint par blocs de trois mois, noyaux historiques longs et résidus communs, incertitude corrélée des rendements. Dérive des positions et rééquilibrage en janvier. RFG des FNB pris en compte une seule fois. Impôts et courtage personnel exclus, comme le comparateur. Les frais de négociation internes futurs ne sont pas estimés séparément. Reculs mesurés en fin de mois.",
        "selection": "Recherche numérique locale de pondérations sous les limites SAVY actuelles. Court terme : fréquence de surperformance sous plusieurs hypothèses. Long terme : fréquence du scénario central. Le nombre de FNB est réduit puis les poids sont arrondis à 0,1 point sous contraintes. Aucune garantie d’optimum global.",
        "uncertainty": "Les bornes sont des tests de sensibilité, pas un intervalle de prévision calibré. Les intervalles de Wilson ne mesurent que le bruit Monte Carlo : ils ne mesurent pas la fiabilité économique du modèle.",
        "validation": "25 000 nouvelles trajectoires par hypothèse, distinctes de celles de la recherche. Ce contrôle teste le bruit de simulation, pas la performance hors échantillon dans le temps. Les 40 mois communs ne valident pas des probabilités à 2 ou 10 ans. Propositions de recherche, sans modification des portefeuilles ni du suivi enregistrés.",
        "sensitivity": "Deux bases de rendement; vues actions ±3 points/an, volatilité +25 %, corrélations rapprochées du marché commun avec variance marginale préservée. Aucun supplément de rendement récent conservé.",
        "source_note": "Rendements réels des FNB en CAD sur la période commune; noyaux de marché de 2008 à 2026 pour les chocs. Expositions sectorielles et géographiques actuelles : elles ne reconstituent pas des compositions passées. Pas d’historique inventé avant le lancement d’un FNB."}
    save(args.root/('data/fnb-prospective-history/'+study_date+'-proposals.json'), catalog)
    save(args.root/'data/fnb-prospective-proposals.json', catalog)
    print(json.dumps([{'years': q['years'], 'weights': q['weights'], 'history': q['history']['beatProbability'],
                       'planning': q['planning']['beatProbability'], 'range': q['probabilityRange'],
                       'centralThreshold': q['centralThreshold'], 'robustThreshold': q['robustThreshold']} for q in proposals]))
