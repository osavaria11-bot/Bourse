#!/usr/bin/env python3
"""Complete lagging FRED rate observations from dated primary publications.

Never change an observation's date to the collection date. Nominal and real
Treasury yields/spreads are matched by actual date. Canadian policy is verified
against the current decision table, independently from its daily time series.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import csv
from datetime import date, datetime, timedelta, timezone
from html.parser import HTMLParser
import io
import json
import math
from pathlib import Path
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/Toronto")
KINDS = {"nominal": "daily_treasury_yield_curve", "real": "daily_treasury_real_yield_curve"}
POINTS = {"DGS10": ("nominal", "10 yr"), "DFII10": ("real", "10 yr"),
          "T10Y2Y": ("nominal", "2 yr"), "T10Y3M": ("nominal", "3 mo")}
POLICY_URL = "https://www.bankofcanada.ca/core-functions/monetary-policy/key-interest-rate/"


def source_url(kind):
    return "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=" + KINDS[kind]


def treasury_rows(text, kind, today):
    rows = csv.DictReader(io.StringIO(text.lstrip("\ufeff")))
    required = ["date", "10 yr", "2 yr", "3 mo"] if kind == "nominal" else ["date", "5 yr", "10 yr", "30 yr"]
    fields = {str(k).strip().lower(): k for k in rows.fieldnames or []}
    if not all(k in fields for k in required): raise ValueError("Unexpected Treasury CSV columns")
    result = {}
    for row in rows:
        try: day = datetime.strptime(row[fields["date"]], "%m/%d/%Y").date()
        except (ValueError, TypeError): continue
        if day > today or day.weekday() >= 5 or day.year != today.year: continue
        values = {}
        for key in required[1:]:
            value = row[fields[key]]
            if value is None or value.strip() in ["", "N/A", "NA", ".", "--"]: values[key] = None; continue
            value = float(value)
            if not math.isfinite(value) or not -20 <= value <= 100: raise ValueError("Invalid Treasury yield")
            values[key] = value
        if day.isoformat() in result and result[day.isoformat()] != values: raise ValueError("Conflicting Treasury date")
        result[day.isoformat()] = values
    if not result: raise ValueError("No dated Treasury observations")
    return result


class PolicyTable(HTMLParser):
    def __init__(self):
        super().__init__(); self.rows = []; self.row = None; self.cell = None

    def handle_starttag(self, tag, attrs):
        if tag == "tr": self.row = []
        if tag in ["td", "th"] and self.row is not None: self.cell = []

    def handle_data(self, data):
        if self.cell is not None: self.cell.append(data)

    def handle_endtag(self, tag):
        if tag in ["td", "th"] and self.cell is not None:
            self.row.append(" ".join(" ".join(self.cell).split())); self.cell = None
        if tag == "tr" and self.row is not None:
            self.rows.append(self.row); self.row = None; self.cell = None


def policy_value(text, today):
    parser = PolicyTable(); parser.feed(text); decisions = []
    if "Policy interest rate" not in text: raise ValueError("Not the Bank of Canada policy page")
    for row in parser.rows:
        if len(row) < 3: continue
        try:
            announced = datetime.strptime(row[0].replace("*", "").strip(), "%B %d, %Y").date()
            rate = float(row[1].replace("%", ""))
            change = row[2].replace("%", "").replace("−", "-").replace("—", "").strip()
            changed = change not in ["", "---", "--", "-"] and float(change) != 0
        except (ValueError, TypeError): continue
        effective = announced + timedelta(days=1) if changed and announced.year >= 2021 else announced
        if effective <= today and math.isfinite(rate) and 0 <= rate <= 30:
            decisions.append((announced, effective, rate))
    if not decisions: raise ValueError("No effective Canadian policy decision")
    announced, effective, rate = max(decisions)
    return {"value": rate, "decision_date": announced.isoformat(), "effective_date": effective.isoformat(), "source_url": POLICY_URL}


def accepted_primary(point, now):
    """Validate a previously published primary snapshot before reusing it."""
    try:
        sid = point["id"]; kind = POINTS[sid][0]; source = point["observation_source"]
        checked = datetime.fromisoformat(source["checked_at"].replace("Z", "+00:00"))
        day = date.fromisoformat(point["date"])
        history = point["history"]
        valid = [(date.fromisoformat(d), v) for d, v in history if v is not None]
        return source["id"] == "us_treasury_" + kind and source["source_url"] == source_url(kind) and \
            source["date"] == day.isoformat() and checked <= now + timedelta(minutes=5) and \
            day <= now.astimezone(TZ).date() and valid[-1] == (day, point["value"]) and \
            all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for _, v in valid) and \
            all(a[0] < b[0] for a, b in zip(valid, valid[1:]))
    except (KeyError, ValueError, TypeError, IndexError): return False


def enrich(dataset, now, fetcher, previous=None):
    data = deepcopy(dataset); today = now.astimezone(TZ).date(); stamp = now.isoformat()
    points = {p["id"]: p for p in data["series"]}; errors = {}; sources = {}
    # A successful but delayed FRED response must not erase a newer primary
    # publication, including when the Treasury endpoint temporarily fails.
    for old in (previous or {}).get("series", []):
        if not isinstance(old, dict): continue
        sid = old.get("id"); p = points.get(sid)
        if sid in POINTS and p and accepted_primary(old, now) and \
                (p.get("date") or "") < (old.get("date") or "") <= today.isoformat():
            points[sid] = deepcopy(old)
            points[sid]["fetch_status"] = "cached"
        if sid == "V39079" and p and old.get("value") == p.get("value") and isinstance(old.get("current_policy"), dict) and \
                old["current_policy"].get("source_url") == POLICY_URL:
            p["current_policy"] = deepcopy(old["current_policy"])
    data["series"] = [points[p["id"]] for p in data["series"]]
    needed = {kind for sid, (kind, _) in POINTS.items() if sid in points and points[sid].get("date", "") != today.isoformat()}
    policy = points.get("V39079"); verified = (policy or {}).get("current_policy") or {}
    try: recent = timedelta(0) <= now - datetime.fromisoformat(verified["verified_at"].replace("Z", "+00:00")) < timedelta(minutes=30)
    except (KeyError, ValueError, TypeError): recent = False
    if policy and not recent: needed.add("policy")

    def fetch(kind):
        try:
            if kind == "policy": return kind, policy_value(fetcher(POLICY_URL), today), None
            query = urlencode({"type": KINDS[kind], "field_tdr_date_value": today.year, "_format": "csv"})
            url = f"https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/{today.year}/all?{query}"
            return kind, treasury_rows(fetcher(url), kind, today), None
        except Exception as exc: return kind, None, str(exc)[:220]

    with ThreadPoolExecutor(max_workers=3) as pool:
        for kind, rows, error in pool.map(fetch, sorted(needed)):
            if error: errors[kind] = error
            else: sources[kind] = rows
    for sid, (kind, column) in POINTS.items():
        p = points.get(sid)
        if not p or kind not in sources: continue
        incoming = {}
        for day, row in sources[kind].items():
            value = row[column]
            if sid in ["T10Y2Y", "T10Y3M"]:
                value = round(row["10 yr"] - value, 8) if value is not None and row["10 yr"] is not None else None
            if value is not None: incoming[day] = value
        if not incoming: continue
        last = max(incoming)
        if p.get("date") and last < p["date"]: continue
        # Existing dated observations stay intact; add only later publications.
        history = dict(p.get("history", [])); old_date = p.get("date") or ""
        for day, value in incoming.items():
            if day > old_date: history[day] = value
        valid = sorted((d, v) for d, v in history.items() if v is not None and math.isfinite(v))
        if not valid: continue
        day, value = valid[-1]
        if day != last or abs(value - incoming[last]) > .00001:
            errors[sid] = "Dated FRED and Treasury observations disagree; accepted value retained"; continue
        previous = valid[-2] if len(valid) > 1 else (None, None)
        p.update(date=day, value=value, history=[[d, v] for d, v in sorted(history.items())],
            previous_date=previous[0], previous_value=previous[1], change=round(value - previous[1], 6) if previous[1] is not None else None,
            fetch_status="fresh", last_successful_fetch=stamp,
            source_label="FRED / U.S. Treasury", source_url=source_url(kind),
            observation_source={"id": "us_treasury_" + kind, "source_url": source_url(kind), "date": day, "checked_at": stamp})
        p.pop("error", None)
    if policy and "policy" in sources:
        current = sources["policy"]
        if abs(current["value"] - (policy.get("value") or 0)) < .000001:
            policy["current_policy"] = {**current, "verified_at": stamp}
        else:
            errors["policy"] = "Current decision and daily Canadian rate disagree; no current-rate label published"
            policy.pop("current_policy", None)
    pending = [sid for sid in POINTS if sid in points and points[sid].get("date") != today.isoformat()]
    data["interest_rate_check"] = {"checked_at": stamp, "day": today.isoformat(), "awaiting_publication": pending, "errors": errors}
    counts = {status: sum(p.get("fetch_status") == status for p in data["series"]) for status in ["fresh", "cached", "unavailable"]}
    data["coverage"] = {"total": len(data["series"]), **counts}
    data["update_status"] = "fresh_data" if counts["fresh"] == len(data["series"]) else "partial_data" if counts["fresh"] else "stale_data_kept"
    if any(p.get("observation_source") for p in data["series"]):
        if "U.S. Treasury" not in data.get("data_provider", ""): data["data_provider"] = data.get("data_provider", "FRED") + " / U.S. Treasury"
    return data


def main():
    try: from scripts import generate_daily_briefing as macro
    except ModuleNotFoundError: import generate_daily_briefing as macro
    p = argparse.ArgumentParser(description=__doc__); p.add_argument("--output-dir", type=Path, default=Path(__file__).resolve().parents[1] / "data")
    p.add_argument("--published-baseline", help="Reuse newer validated public observations when the checkout snapshot lags")
    args = p.parse_args(); file = args.output_dir / "macro-data.json"; data = macro.read_json(file)
    if not data: raise ValueError("No validated macro history to refresh")
    now = datetime.now(timezone.utc); previous = None
    if args.published_baseline and any(p["id"] in POINTS and p.get("date") != now.astimezone(TZ).date().isoformat() for p in data["series"]):
        try:
            published = json.loads(macro.fetch_text(args.published_baseline + "?rates=" + str(int(now.timestamp()))))
            if isinstance(published, dict) and published.get("schema_version") == 2 and isinstance(published.get("series"), list): previous = published
        except Exception as exc: print("::warning::Previous public rate snapshot unavailable:", str(exc)[:180])
    data = enrich(data, now, macro.fetch_text, previous)
    data["generated_at"] = now.isoformat()
    macro.atomic_write_json(file, data, compact=True)
    macro.atomic_write_json(args.output_dir / "macro-briefing.json", macro.build_briefing(data))
    print("Dated interest-rate refresh:", [(p["id"], p["date"]) for p in data["series"] if p["id"] in POINTS])
    print("Publication check:", data["interest_rate_check"])


if __name__ == "__main__": main()
