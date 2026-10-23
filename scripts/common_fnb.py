#!/usr/bin/env python3
"""Common-start comparisons, separate from the immutable prospective ledger.

New allocations are replayed from 19 October 2026 with their own frozen weights.
Their entire curve remains a simulation; it is never spliced into a real account.
Only missing historical ETF observations are collected and cached separately.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime
import math
from pathlib import Path

import daily_fnb as F

DATA = "data/fnb-comparison.json"
CACHE = "data/fnb-comparison/prices.json"
STATUS = "data/fnb-comparison-status.json"
MODEL = "common_start_buy_hold_v1"


def cached_prices(root):
    file = root / CACHE
    if not file.exists(): return {"schema_version": 1, "inception": F.START, "prices": {}}
    cache = F.read(file)
    if cache.get("sha256") != F.digest({k:v for k,v in cache.items() if k != "sha256"}):
        raise ValueError("Common comparison price cache changed")
    if cache["inception"] != F.START: raise ValueError("Common start changed")
    for history in cache["prices"].values():
        for p in history.values():
            if not all(math.isfinite(p[k]) and p[k] > 0 for k in ["close", "adjusted_close", "split"]) or not math.isfinite(p["distribution"]) or p["distribution"] < 0:
                raise ValueError("Invalid common comparison quote")
    return cache


def quote_window(history, dates, canonical):
    """Check new quotes against one response; archived adjusted levels have
    different vintages and must not be compared across future distributions.
    """
    for i, day in enumerate(dates):
        if day not in history: raise ValueError("Missing common-start close: " + day)
        p = history[day]
        if not all(math.isfinite(p[k]) and p[k] > 0 for k in ["close", "adjusted_close", "split"]) or not math.isfinite(p["distribution"]) or p["distribution"] < 0:
            raise ValueError("Invalid common-start close")
        old = canonical.get(day)
        if old and abs(p["close"] / old["close"] - 1) > .0001:
            raise ValueError("Nominal close disagrees with saved history: " + day)
        if i:
            anchor = history[dates[i-1]]
            gross = p["adjusted_close"] / anchor["adjusted_close"]
            close_ratio = p["close"] * p["split"] / anchor["close"]
            div_ratio = p["distribution"] * p["split"] / anchor["close"]
            low = close_ratio + div_ratio
            high = close_ratio / (1-div_ratio) if div_ratio < 1 else float("inf")
            if not min(low,high)-.0002 <= gross <= max(low,high)+.0002:
                raise ValueError("Common comparison distribution/split mismatch: " + day)


def build(root, registry, days, cache, updated_at, sources=None, fetch=False):
    if not days or days[0]["date"] != F.START: raise ValueError("Common-start ledger missing")
    dates = [d["date"] for d in days]
    prices = deepcopy(cache["prices"])
    # Accepted nominal closes, splits and distributions remain authoritative.
    for day in days:
        for t,p in day["prices"].items():
            old = prices.setdefault(t,{}).get(day["date"])
            if old and any(abs(old[k]-p[k]) > 1e-8 for k in ["close","split","distribution"]):
                raise ValueError("Supplemental quote disagrees with accepted ledger: " + t)
            prices[t][day["date"]] = p
    tickers = {t for a in registry["accounts"] for t in a["weights"]}
    missing = [t for t in sorted(tickers) if any(d not in prices.get(t,{}) for d in dates)]
    config = F.read(root / "data/fnb-model.json")
    supplemental = deepcopy(cache["prices"])
    errors = {}
    def collect_one(t):
        try:
            preferred = {t} if any(p.get("price_source") == "TMX Money" for p in prices.get(t,{}).values()) else set()
            fresh = sources.get(t,{}) if sources is not None else F.collect(config,{t},F.START,dates[-1],preferred_tmx=preferred)[t]
            quote_window(fresh,dates,prices.get(t,{}))
            return t,fresh,None
        except Exception as e: return t,{},str(e)[:800]
    if fetch or sources is not None:
        with ThreadPoolExecutor(max_workers=4) as pool:
            for t,fresh,error in pool.map(collect_one,missing):
                if error: errors[t]=error;continue
                for day in dates:
                    if day not in prices.setdefault(t,{}):
                        supplemental.setdefault(t,{})[day] = fresh[day]
                        prices[t][day] = fresh[day]
    accounts = []
    for a in registry["accounts"]:
        absent = [t for t in a["weights"] if any(day not in prices.get(t,{}) for day in dates)]
        history,positions = [],[]
        if not absent:
            state = None
            for day in dates:
                state = F.calculate(a,{t:prices[t][day] for t in a["weights"]},state)
                history.append({"date":day,"value":state["value"]})
            positions = [{"ticker":t,"name":config["funds"][t]["name"],"weight":w,
                "close":prices[t][F.START]["close"],"units":a["capital"]*w/prices[t][F.START]["close"]} for t,w in a["weights"].items()]
        accounts.append({**{k:v for k,v in a.items() if k != "definition_sha256"},
            "source_definition_sha256":a["definition_sha256"],"actual_launch_date":a["launch_date"],"launch_date":F.START,
            "series_type":"simulation" if a["launch_date"] > F.START else "recorded_from_common_start",
            "status":"unavailable" if absent else "complete",
            "unavailable_reason":"Historique complet au départ commun indisponible : "+", ".join(absent) if absent else None,
            "history":history,"initial_positions":positions})
    cache_out = {"schema_version":1,"inception":F.START,"prices":supplemental}
    cache_out["sha256"] = F.digest(cache_out)
    result = {"schema_version":1,"model":MODEL,"currency":"CAD","capital":F.CAPITAL,"inception":F.START,
        "as_of":dates[-1],"updated_at":updated_at,"benchmarks":F.benchmark_ids(registry),"accounts":accounts,
        "source_ledger_sha256":days[-1]["sha256"],"source_registry_sha256":F.digest(registry),"supplemental_sha256":cache_out["sha256"],
        "price_revisions":[{"ticker":t, "recorded_on":d["date"], **p["previous_close_revision"]}
            for d in days for t,p in d["prices"].items() if p.get("previous_close_revision")],
        "methodology":{
            "start":"10 000 $ CA pour tous à la clôture du 19 octobre 2026, avec les pondérations figées propres à chaque portefeuille; aucun rééquilibrage.",
            "simulation":"Les portefeuilles ajoutés après cette date sont simulés depuis le départ commun. Leur allocation était inconnue au début de la comparaison : biais rétrospectif. La courbe entière reste une simulation, distincte du compte réellement enregistré après publication.",
            "accounting":"Parts fractionnaires, distributions réinvesties à la clôture ex-distribution, fractionnements appliqués une seule fois. Frais internes inclus; courtage et fiscalité exclus.",
            "sources":"Clôtures et événements du registre permanent, complétés par les historiques datés Yahoo Finance / TMX Money pour les FNB manquants. Aucun cours ni rendement inventé avant la création d’un FNB.",
            "future":"Chaque nouveau portefeuille enregistré rejoint automatiquement cette comparaison à la même date, dès que tous ses cours depuis le départ commun sont disponibles."}}
    return result,cache_out,errors


def run(root, now, sources=None):
    registry,days = F.load_state(root)
    result,cache,errors = build(root,registry,days,cached_prices(root),now.isoformat(timespec="seconds"),sources,fetch=True)
    prior_file = root / DATA
    if prior_file.exists():
        previous = F.read(prior_file)
        same = {k:v for k,v in result.items() if k != "updated_at"} == {k:v for k,v in previous.items() if k != "updated_at"}
        if same: result["updated_at"] = previous["updated_at"]
    F.write(root / CACHE,cache);F.write(prior_file,result)
    unavailable = [a["id"] for a in result["accounts"] if a["status"] != "complete"]
    expected = F.completed_session(now).isoformat()
    stale = result["as_of"] < expected
    F.write(root / STATUS,{"schema_version":1,"status":"retrying" if unavailable or stale else "current","checked_at":now.isoformat(timespec="seconds"),
        "as_of":result["as_of"],"expected_session":expected,"unavailable":unavailable,"errors":errors,
        "message": "Clôture attendue du " + expected + " non encore intégrée; reprise automatique." if stale else
            "Historiques incomplets; reprise automatique." if unavailable else "Toutes les clôtures attendues sont intégrées."})
    print(f"Common start {F.START}: {len(result['accounts'])-len(unavailable)}/{len(result['accounts'])} complete; as of {result['as_of']}")
    return result


def check_freshness(root, now):
    expected = F.completed_session(now).isoformat()
    for name, status_path in [("fnb-performance.json", "data/fnb-performance-status.json"), ("fnb-comparison.json", STATUS)]:
        data, status = F.read(root / "data" / name), F.read(root / status_path)
        if data["as_of"] != expected or status.get("status") != "current" or status.get("expected_session") != expected:
            raise ValueError(f"FNB daily update incomplete: {name} as of {data['as_of']}; expected {expected}; status {status.get('status')}")
        for account in data["accounts"]:
            if account["launch_date"] <= expected and (not account["history"] or account["history"][-1]["date"] != expected):
                raise ValueError("FNB closing history incomplete: " + account["id"])
    print("All FNB portfolios and benchmarks current through", expected)


def main():
    p=argparse.ArgumentParser();p.add_argument("--root",type=Path,default=Path(__file__).resolve().parents[1]);p.add_argument("--check",action="store_true");p.add_argument("--check-freshness",action="store_true")
    args=p.parse_args();root=args.root
    if args.check_freshness:
        check_freshness(root,datetime.now(F.TZ));return 0
    if args.check:
        registry,days=F.load_state(root);saved=F.read(root / DATA)
        expected,cache,_=build(root,registry,days,cached_prices(root),saved["updated_at"])
        if saved != expected: raise ValueError("Common comparison disagrees with source records")
        if cache != F.read(root / CACHE): raise ValueError("Common price cache disagrees")
        print("Validated common-start comparison:",len(saved["accounts"]),"accounts");return 0
    now=datetime.now(F.TZ)
    try: run(root,now)
    except Exception as exc:
        saved = F.read(root / DATA) if (root / DATA).exists() else {}
        F.write(root / STATUS,{"schema_version":1,"status":"retrying","checked_at":now.isoformat(timespec="seconds"),
            "as_of":saved.get("as_of"),"expected_session":F.completed_session(now).isoformat(),
            "message":"Comparaison non actualisée; dernier relevé conservé. Reprise automatique.","error":str(exc)[:1600]})
        raise
    return 0


if __name__ == "__main__": raise SystemExit(main())
