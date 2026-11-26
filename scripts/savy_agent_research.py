"""Deterministic checks on paired, dated observations supplied by SAVY agents."""

from math import isfinite, prod
from statistics import median, stdev

from .savy_agent_memory import instant, is_hash, require, slug


def number(value, minimum=None, maximum=None):
    require(type(value) in (int, float) and isfinite(value), "A finite number is required")
    require(minimum is None or value >= minimum, "Number is below its permitted range")
    require(maximum is None or value <= maximum, "Number is above its permitted range")
    return value


def compounded(returns):
    return prod(1.0 + ret for ret in returns) - 1.0


def relative(rows, sessions, *, horizon, min_history, dispersion_multiple, floor_bps, direction="lower"):
    """Calibrate on nonoverlapping history and evaluate the newest disjoint window."""
    require(type(horizon) is int and horizon >= 1, "Invalid signal horizon")
    require(type(min_history) is int and min_history >= 8, "At least eight historical windows are required")
    number(dispersion_multiple, 1)
    number(floor_bps, 0)
    require(direction in {"lower", "both"}, "Invalid alert direction")
    require(isinstance(sessions, list) and sessions and sessions == sorted(set(sessions)),
            "Supply sorted unique completed, common sessions from the venue calendar")
    for session in sessions:
        require(isinstance(session, str) and len(session) == 10, "Invalid session")
        instant(session + "T00:00:00Z")
    require(isinstance(rows, list), "Supply paired observations")
    meta = {"as_of": sessions[-1], "horizon_sessions": horizon}
    if [row["session"] for row in rows] != sessions:
        return {**meta, "status": "unavailable", "reason": "missing_or_unaligned_sessions"}
    require(all(set(row) == {"session", "portfolio_return", "benchmark_return"} for row in rows),
            "Use paired decimal returns on the same basis")
    for row in rows:
        number(row["portfolio_return"], -1)
        number(row["benchmark_return"], -1)

    window_count = len(rows) // horizon
    if window_count <= min_history:
        return {**meta, "status": "insufficient_history", "historical_windows": max(0, window_count - 1)}

    def active(window):
        portfolio = compounded(row["portfolio_return"] for row in window)
        benchmark = compounded(row["benchmark_return"] for row in window)
        return (portfolio - benchmark) * 10_000

    first = len(rows) % horizon
    history = [active(rows[i:i + horizon]) for i in range(first, len(rows) - horizon, horizon)]
    current = active(rows[-horizon:])
    center = median(history)
    robust_scale = 1.4826 * median(abs(value - center) for value in history)
    scale = robust_scale if robust_scale > 1e-9 else stdev(history)
    threshold = max(floor_bps, dispersion_multiple * scale)
    lower = min(-floor_bps, center - threshold)
    upper = max(floor_bps, center + threshold)
    status = "alert" if current < lower or (direction == "both" and current > upper) else "normal"
    return {
        **meta, "status": status, "historical_windows": len(history), "active_bps": current,
        "center_bps": center, "dispersion_bps": scale, "threshold_bps": threshold,
        "lower_bps": lower, "upper_bps": upper if direction == "both" else None,
    }


EVENTS = {
    "portfolio_underperformance", "position_move", "risk_limit", "fundamental_change",
    "earnings", "macro_change", "recommendation_miss", "data_gap", "system_failure", "opportunity",
    "cre_market_change", "cre_comparable_change", "cre_listing_change",
}


def event_queue(events, cutoff):
    """Select material, current events once, keeping the latest actionable version."""
    instant(cutoff)
    current = {}
    for event in events:
        require(set(event) == {"key", "kind", "available_at", "expires_at", "priority", "evidence", "material"},
                "Invalid event fields")
        key = slug(event["key"])
        require(event["kind"] in EVENTS, "Unknown event category")
        require(instant(event["available_at"]) <= instant(event["expires_at"]), "Inconsistent event lifetime")
        require(type(event["priority"]) is int and event["priority"] in (1, 2, 3), "Invalid event priority")
        require(type(event["material"]) is bool and is_hash(event["evidence"]), "Event needs a dated source fingerprint")
        if not event["available_at"] <= cutoff <= event["expires_at"]:
            continue
        latest = current.get(key)
        if latest and latest["available_at"] == event["available_at"]:
            require(latest == event, "Conflicting observations for the same event and timestamp")
        if not latest or latest["available_at"] < event["available_at"]:
            current[key] = event
    return sorted((e for e in current.values() if e["material"]), key=lambda e: (e["priority"], e["key"]))


def backtest(spec, windows):
    """Score paired candidate and baseline returns with a purged chronological split."""
    require(set(spec) == {"method_fingerprint", "frozen_at", "evaluated_at", "min_oos", "currency", "return_basis"},
            "Invalid experiment configuration")
    frozen, cutoff = instant(spec["frozen_at"]), instant(spec["evaluated_at"])
    require(frozen < cutoff and is_hash(spec["method_fingerprint"]), "Freeze and fingerprint the method before validation")
    require(type(spec["min_oos"]) is int and spec["min_oos"] >= 2, "Specify the required holdout size")
    require(spec["currency"] in {"CAD", "USD"} and spec["return_basis"] in {"total_return", "price_return"},
            "Choose a common currency and return basis")
    periods = {"calibration": [], "holdout": []}
    purged, pending, last_exit = 0, 0, None
    for row in windows:
        require(set(row) == {"formed_at", "data_available_at", "entered_at", "exited_at", "outcome_available_at",
                             "universe_fingerprint", "candidate_return", "baseline_return",
                             "candidate_turnover", "baseline_turnover", "cost_bps"},
                "Invalid experimental observation")
        data, formed, entered, exited, available = (instant(row[k]) for k in (
            "data_available_at", "formed_at", "entered_at", "exited_at", "outcome_available_at",
        ))
        require(data <= formed < entered < exited <= available, "Look-ahead or inconsistent execution chronology")
        require(is_hash(row["universe_fingerprint"]), "Retain the point-in-time universe, including exclusions")
        require(last_exit is None or entered >= last_exit, "Periods must be sorted and nonoverlapping")
        last_exit = exited
        candidate = number(row["candidate_return"], -1)
        baseline = number(row["baseline_return"], -1)
        cost = number(row["cost_bps"], 0, 10_000) / 10_000.0
        candidate_cost = cost * number(row["candidate_turnover"], 0, 1)
        baseline_cost = cost * number(row["baseline_turnover"], 0, 1)
        if available > cutoff:
            pending += 1
            continue
        if available <= frozen:
            bucket = "calibration"
        elif formed > frozen:
            bucket = "holdout"
        else:
            purged += 1
            continue
        periods[bucket].append(((1.0 + candidate) * (1.0 - candidate_cost) - 1.0,
                                (1.0 + baseline) * (1.0 - baseline_cost) - 1.0))

    def summarize(pairs):
        if not pairs:
            return {"periods": 0, "candidate_net": None, "baseline_net": None, "active_bps": None}
        candidate = compounded(pair[0] for pair in pairs)
        baseline = compounded(pair[1] for pair in pairs)
        return {"periods": len(pairs), "candidate_net": candidate, "baseline_net": baseline,
                "active_bps": (candidate - baseline) * 10_000}

    return {
        "method_fingerprint": spec["method_fingerprint"], "currency": spec["currency"],
        "return_basis": spec["return_basis"], "evaluated_at": spec["evaluated_at"],
        "status": "scored" if len(periods["holdout"]) >= spec["min_oos"] else "insufficient_holdout",
        "calibration": summarize(periods["calibration"]), "holdout": summarize(periods["holdout"]),
        "purged_periods": purged, "pending_periods": pending,
    }


def score_forecasts(forecasts, cutoff):
    """Score matured probabilistic outcomes by outcome provenance and horizon."""
    as_of = instant(cutoff)
    groups, seen, pending = {}, set(), 0
    for f in forecasts:
        require(set(f) == {"key", "provenance", "horizon", "issued_at", "due_at", "resolved_at",
                           "probability", "outcome"}, "Invalid forecast fields")
        key = slug(f["key"])
        require(key not in seen, "Forecast appears twice")
        seen.add(key)
        require(f["provenance"] in {"observed", "reconstructed", "hypothetical"}, "Unknown provenance")
        horizon = slug(f["horizon"])
        p = number(f["probability"], 0, 1)
        require(instant(f["issued_at"]) < instant(f["due_at"]), "Invalid forecast horizon")
        resolved = instant(f["resolved_at"]) if f["resolved_at"] is not None else None
        require(resolved is None or instant(f["due_at"]) <= resolved, "Forecast scored before its deadline")
        require(type(f["outcome"]) is bool if resolved else f["outcome"] is None, "Invalid forecast outcome")
        if resolved is None or resolved > as_of:
            pending += 1
            continue
        groups.setdefault((f["provenance"], horizon), []).append((p, int(f["outcome"])))

    output = []
    for (provenance, horizon), rows in sorted(groups.items()):
        n = len(rows)
        groups_by_probability = []
        for low, high in ((0.0, 0.25), (0.25, 0.5), (0.5, 0.75), (0.75, 1.0)):
            rows_in_bin = [(p, y) for p, y in rows if low <= p < high or high == 1.0 == p]
            count = len(rows_in_bin)
            if count:
                groups_by_probability.append({
                    "range": [low, high], "count": count,
                    "mean_forecast": sum(p for p, _ in rows_in_bin) / count,
                    "observed_rate": sum(y for _, y in rows_in_bin) / count,
                })
        output.append({
            "provenance": provenance, "horizon": horizon, "scored": n,
            "brier": sum((p - y) ** 2 for p, y in rows) / n,
            "outcome_rate": sum(y for _, y in rows) / n,
            "calibration_bins": groups_by_probability,
        })
    return {"groups": output, "pending": pending}


def rank_predictiveness(weeks, cutoff):
    """Measure per-cohort rank correlation from vintage selection and matured outcomes."""
    as_of = instant(cutoff)
    correlations, missing, pending, inconclusive = [], 0, 0, 0
    cohorts = set()

    def ranks(values):
        results, start = {}, 0
        ordered = sorted(values)
        while start < len(ordered):
            end = start + 1
            while end < len(ordered) and ordered[end] == ordered[start]:
                end += 1
            results[ordered[start]] = (start + end + 1) / 2
            start = end
        return [results[value] for value in values]

    for week in weeks:
        require(set(week) == {"formation", "data_available", "execution", "outcome_available",
                             "universe_fingerprint", "expected_count", "ranks"},
                "Invalid rank experiment cohort")
        formed, vintage, entry, available = (instant(week[key]) for key in (
            "formation", "data_available", "execution", "outcome_available",
        ))
        require(vintage <= formed < entry < available, "Look-ahead in ranking experiment")
        require(formed not in cohorts and is_hash(week["universe_fingerprint"]), "Duplicate or unverified cohort")
        cohorts.add(formed)
        if available > as_of:
            pending += 1
            continue
        expected = week["expected_count"]
        require(type(expected) is int and expected >= 0 and isinstance(week["ranks"], dict), "Invalid cohort coverage")
        require(len(week["ranks"]) <= expected, "Cohort includes unexpected observations")
        if len(week["ranks"]) < expected:
            missing += 1
            continue
        if expected < 3:
            inconclusive += 1
            continue
        scores, outcomes = [], []
        for symbol, row in week["ranks"].items():
            slug(symbol)
            require(set(row) == {"score", "realized_return"}, "Invalid rank observation")
            scores.append(number(row["score"]))
            outcomes.append(number(row["realized_return"], -1))
        a, b = ranks(scores), ranks(outcomes)
        center = (expected + 1) / 2
        denom = (sum((x - center) ** 2 for x in a) * sum((y - center) ** 2 for y in b)) ** 0.5
        if denom == 0:
            inconclusive += 1
            continue
        correlations.append({
            "formation": week["formation"], "cohort_size": expected,
            "spearman": sum((x - center) * (y - center) for x, y in zip(a, b)) / denom,
        })
    return {
        "cohorts": correlations, "mean_spearman": (
            sum(row["spearman"] for row in correlations) / len(correlations) if correlations else None
        ),
        "incomplete": missing, "immature": pending, "constant_or_small": inconclusive,
    }
