#!/usr/bin/env python3
"""Apply only submitted additions to data already present in this repository.

The small input bundle contains public ETF observations for three new funds.
Existing portfolio datasets are read locally; no replacement dataset is needed.
Accepted daily sessions and monthly archives are never edited.
"""
from copy import deepcopy
from datetime import datetime
import json
from pathlib import Path
import tempfile

import common_fnb as C
import daily_fnb as F
import collect_fnb_daily_risk as V
import install_prospective_portfolio as I
import prospective_portfolios as P

ROOT = Path(__file__).resolve().parents[1]
BUNDLE = "data/fnb-submitted-sources/2026-10-26.json"


def prepare(root=ROOT):
    bundle = F.read(root / BUNDLE)
    if bundle["schema_version"] != 1 or bundle["kind"] != "public_etf_sources_for_submitted_allocations" or set(bundle["tickers"]) != {"HXQ", "XIC", "ZLU"}:
        raise ValueError("Unexpected submitted ETF sources")
    catalog = F.read(root / bundle["catalog_path"])
    P.validate_sources(root, catalog)
    ids = [p["id"] for p in catalog["portfolios"]]
    config = F.read(root / "data/fnb-model.json")
    for ticker, fund in bundle["fund_config"].items():
        config["funds"].setdefault(ticker, fund)
    F.write(root / "data/fnb-model.json", config)
    labels = F.read(root / "data/fnb-catalog.json")
    for ticker, label in bundle["labels"].items():
        labels["funds"].setdefault(ticker, label)
    F.write(root / "data/fnb-catalog.json", labels)
    with tempfile.TemporaryDirectory(prefix="savy-submitted-etfs-") as folder:
        folder = Path(folder)
        for ticker, snapshot in bundle["snapshots"].items():
            F.write(folder / (ticker + ".json"), snapshot)
        I.install(root, folder)

    registry, days = F.load_state(root)
    comparison = F.read(root / C.DATA)
    if comparison["source_registry_sha256"] != F.digest(registry):
        C.run(root, datetime.now(F.TZ), sources=bundle["common_prices"])

    analysis = F.read(root / "data/fnb-analysis.json")
    risk = F.read(root / "data/fnb-daily-risk.json")
    if any(key not in risk["results"] for key in ids):
        dates = risk["daily_series"]["dates"]
        retained = risk["daily_series"]["returns"]
        observed = {t: dict(zip(bundle["daily"]["dates"], values)) for t, values in bundle["daily"]["returns"].items()}
        missing = {t for key in ids for t in analysis["results"][key]["weights"] if t not in retained}
        # Later samples are refreshed by the normal daily collector; never
        # pad a new session with an old quote or shorten an existing sample.
        if all(t in observed and all(d in observed[t] for d in dates) for t in missing):
            risk = deepcopy(risk)
            for ticker in missing:
                risk["daily_series"]["returns"][ticker] = [observed[ticker][d] for d in dates]
                risk["return_basis"][ticker] = "adjusted_market_close_total_return"
            for key in ids:
                weights = analysis["results"][key]["weights"]
                values = [sum(w * risk["daily_series"]["returns"][t][i] for t, w in weights.items()) for i in range(len(dates))]
                risk["results"][key] = {"weights": weights, "var95": V.historical_var(values), **V.distribution_shape(values)}
            risk["source_urls"] = sorted(set(risk["source_urls"]) | set(bundle["daily"]["source_urls"]))
            risk["weights_signature"] = V.signature(analysis)
            risk["generated_at"] = catalog["published_at"]
            V.validate(risk)
            F.write(root / "data/fnb-daily-risk.json", risk)

    stress = F.read(root / "data/fnb-stress-history.json")
    for key, extra in bundle["stress"]["scenarios"].items():
        existing = stress["scenarios"].get(key)
        if existing and (existing["start"], existing["end"]) == (extra["start"], extra["end"]):
            for ticker, value in extra["assets"].items():
                existing["assets"].setdefault(ticker, value)
    for ticker, url in bundle["stress"]["source_urls"].items():
        stress["source_urls"].setdefault(ticker, url)
    F.write(root / "data/fnb-stress-history.json", stress)
    print("Prepared A — Hybride and B — Multifactoriel using existing repository data.")


if __name__ == "__main__":
    prepare()
