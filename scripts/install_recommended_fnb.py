#!/usr/bin/env python3
"""Attach a reviewed frozen catalog without changing existing investments."""
import argparse
from copy import deepcopy
import json
from pathlib import Path
import subprocess

import benchmark_fnb
import daily_fnb as F
import monthly_fnb as M
import recommended_fnb as N


def install(root, snapshots):
    current = M.read(root / "data/fnb-analysis.json")
    d = deepcopy(current)
    config = M.read(root / "data/fnb-model.json")
    selections = N.catalogs(root)
    for c in selections:
        N.validate_sources(root, c)
    required = {t for c in selections for p in c["portfolios"] for t in p["weights"]} | {"VFV"}
    holdings = M.read(root / "data/fnb-holdings.json")
    for t in sorted(required):
        if t in d["universe"]["returns"] and t in holdings["funds"]:
            continue
        file = snapshots / (t + "-snapshot.json")
        source = M.read(file)
        if t not in d["universe"]["returns"]:
            if any(m not in source["returns"] for m in d["dates"]):
                raise ValueError("Missing common ETF return: " + t)
            d["universe"]["returns"][t] = [source["returns"][m] for m in d["dates"]]
            for key in ("geo", "sector", "mer"):
                d["universe"][key][t] = source[key]
            for key, value in source["assets"].items():
                d["universe"][key][t] = value
            d["source_dates"][t], d["source_urls"][t], d["data_methods"][t] = source["dates"], source["source_url"], source["return_method"]
            d["fund_labels"][t] = {k: config["funds"][t][k] for k in ("name", "description", "source_url")}
            if t not in d["funds"]:
                d["funds"].append(t)
        if t not in holdings["funds"]:
            if not source["holdings"]["complete"]:
                raise ValueError("Incomplete ETF look-through: " + t)
            holdings["funds"][t] = source["holdings"]
    benchmark_fnb.apply(d, benchmark_fnb.catalogs(root), current)
    N.apply(d, selections, current)
    added = d["recommended_order"] + ["VFV"]
    js = "const fs=require('fs'),{consolidate}=require('./scripts/fnb_holdings.cjs');const d=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(JSON.stringify(Object.fromEntries(d.ids.map(k=>[k,consolidate(d.results[k].weights,d.funds)]))));"
    result = subprocess.run(["node", "-e", js], cwd=root, input=json.dumps({"ids": added, "results": d["results"], "funds": holdings["funds"]}), capture_output=True, text=True, check=True)
    lookthrough = deepcopy(d["lookthrough"])
    lookthrough["results"].update(json.loads(result.stdout))
    d["lookthrough"] = lookthrough
    M.validate(d, M.read(root / config["baseline"]))
    for k in current["order"]:
        if d["results"][k] != current["results"][k]:
            raise ValueError("Existing portfolio was changed: " + k)
    for file, value in [("data/fnb-analysis.json", d), ("data/fnb-holdings.json", holdings), ("data/fnb-lookthrough.json", lookthrough)]:
        M.write(root / file, value)
    registry, days = F.load_state(root)
    registry = F.register(root, registry)
    F.validate(registry, days)
    F.write(root / "data/fnb-performance/registry.json", registry)
    F.write(root / "data/fnb-performance.json", F.snapshot(registry, days, config))
    print("Installed three frozen S&P 500 portfolios; existing allocations and daily sessions preserved.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--snapshot-dir", type=Path, required=True)
    args = parser.parse_args()
    install(args.root, args.snapshot_dir)
