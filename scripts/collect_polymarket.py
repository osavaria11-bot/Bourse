#!/usr/bin/env python3
"""Read the largest open Polymarket events; preserve dated snapshots on outages."""
from __future__ import annotations

import argparse
import json
import math
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode

try:
    from scripts import generate_daily_briefing as macro
except ModuleNotFoundError:
    import generate_daily_briefing as macro

ROOT = Path(__file__).resolve().parents[1]
API = "https://gamma-api.polymarket.com"
GROUPS = {"finance": ("finance", "volume", 3), "popular": ("politics", "volume24hr", 2)}


def iso(value):
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def timestamp(value):
    try:
        stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if stamp.tzinfo is not None and stamp.year >= 2000:
            return stamp
    except (AttributeError, TypeError, ValueError):
        pass
    raise macro.SourceError("Polymarket : date invalide")


def number(value):
    if isinstance(value, bool) or value is None:
        raise ValueError("Missing number")
    result = float(value)
    if not math.isfinite(result) or result < 0:
        raise ValueError("Invalid number")
    return result


def array(value):
    return json.loads(value) if isinstance(value, str) else value


def is_open(row, now, *, market=False):
    try:
        return (isinstance(row, dict) and row.get("active") is True and row.get("closed") is False
                and row.get("archived") is not True and timestamp(row.get("endDate")) > now
                and (not market or (row.get("acceptingOrders") is True
                     and row.get("umaResolutionStatus") not in ("resolved", "disputed", "proposed"))))
    except macro.SourceError:
        return False


def parse_event(raw, now):
    """Pair each price with its actual outcome, never sum independent markets."""
    if not is_open(raw, now):
        return None
    try:
        slug, title, eid = raw["slug"], raw["title"].strip(), str(raw["id"])
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug) or not title or not eid.isdigit():
            return None
        volume, daily = number(raw["volume"]), number(raw.get("volume24hr", 0))
        markets = raw["markets"]
        if not isinstance(markets, list):
            return None
        outcomes = []
        for market in markets:
            if not is_open(market, now, market=True):
                continue
            try:
                published = timestamp(market["updatedAt"])
                if published > now + timedelta(minutes=5):
                    continue
                labels, prices = array(market["outcomes"]), array(market["outcomePrices"])
                if not isinstance(labels, list) or not isinstance(prices, list) or not 2 <= len(labels) == len(prices) <= 20:
                    continue
                prices = [number(price) for price in prices]
                if any(p > 1 for p in prices) or abs(sum(prices) - 1) > .05:
                    continue
                if any(not isinstance(label, str) or not label.strip() for label in labels):
                    continue
                indexes = range(len(labels))
                if len(markets) > 1:
                    # A multi-market event lists the Yes price of each scenario.
                    indexes = [next(i for i, label in enumerate(labels) if label.lower() == "yes")]
                for index in indexes:
                    label = labels[index].strip()
                    if len(markets) > 1:
                        label = str(market.get("groupItemTitle") or market.get("question") or "").strip()
                    if label:
                        outcomes.append({"label": label, "probability": prices[index], "market_id": str(market["id"]),
                                         "ends_at": iso(timestamp(market["endDate"]))})
            except (KeyError, TypeError, ValueError, StopIteration, macro.SourceError):
                continue
        outcomes.sort(key=lambda row: (-row["probability"], row["label"]))
        if not outcomes or volume <= 0:
            return None
        return {"id": eid, "slug": slug, "title": title, "url": "https://polymarket.com/event/" + slug,
                "volume": volume, "volume_24h": daily, "ends_at": iso(timestamp(raw["endDate"])),
                "outcomes": outcomes[:2]}
    except (KeyError, TypeError, ValueError, macro.SourceError):
        return None


def fetch_json(url):
    try:
        return json.loads(macro.fetch_text(url))
    except ValueError as exc:
        raise macro.SourceError("Polymarket : réponse JSON invalide") from exc


def fetch_group(kind, now, excluded=()):
    tag_slug, order, count = GROUPS[kind]
    tag = fetch_json(API + "/tags/slug/" + tag_slug)
    if not isinstance(tag, dict) or tag.get("slug") != tag_slug or not str(tag.get("id", "")).isdigit():
        raise macro.SourceError("Polymarket : catégorie introuvable")
    candidates = {}
    for page in range(4):
        query = urlencode({"tag_id": tag["id"], "active": "true", "closed": "false", "archived": "false",
                           "related_tags": "true" if kind == "finance" else "false",
                           "order": order, "ascending": "false", "limit": 20, "offset": page * 20})
        rows = fetch_json(API + "/events?" + query)
        if not isinstance(rows, list):
            raise macro.SourceError("Polymarket : liste d’événements invalide")
        for raw in rows:
            event = parse_event(raw, now)
            if event and event["id"] not in excluded:
                # Politics can cross-list financial events; keep two other topics.
                tags = raw.get("tags") or []
                if kind == "popular" and any(isinstance(t, dict) and t.get("slug") == "finance" for t in tags):
                    continue
                candidates[event["id"]] = event
        if len(candidates) >= count or len(rows) < 20:
            break
    key = "volume" if kind == "finance" else "volume_24h"
    selected = sorted(candidates.values(), key=lambda row: (-row[key], row["id"]))[:count]
    if len(selected) != count:
        raise macro.SourceError("Polymarket : pas assez d’événements ouverts avec des prix valides")
    return selected


def cached_events(group, now, count, excluded):
    """Accept only our normalized, still-open cache, without changing its date."""
    try:
        fetched = timestamp(group["fetched_at"])
        if group.get("fetch_status") not in ("fresh", "cached") or fetched > now + timedelta(minutes=5):
            return []
        rows, result = group["events"], []
        if not isinstance(rows, list) or len(rows) != count:
            return []
        for row in rows:
            slug = row["slug"]
            if (not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug) or not str(row["id"]).isdigit()
                    or row["id"] in excluded or row["id"] in {r["id"] for r in result}
                    or row["url"] != "https://polymarket.com/event/" + slug or not row["title"].strip()
                    or timestamp(row["ends_at"]) <= now or number(row["volume"]) <= 0):
                return []
            number(row["volume_24h"])
            outcomes = row["outcomes"]
            if not isinstance(outcomes, list) or not 1 <= len(outcomes) <= 2:
                return []
            if any(not p["label"].strip() or number(p["probability"]) > 1 or not str(p["market_id"]).isdigit()
                   or timestamp(p["ends_at"]) <= now for p in outcomes):
                return []
            result.append(row)
        return result
    except (KeyError, TypeError, ValueError, AttributeError, macro.SourceError):
        return []


def collect(previous, now, fetcher=fetch_group):
    result = {"schema_version": 1, "kind": "polymarket_events", "provider": "polymarket",
              "generated_at": iso(now), "groups": {}}
    old = previous.get("groups", {}) if (isinstance(previous, dict) and previous.get("schema_version") == 1
          and previous.get("kind") == result["kind"] and previous.get("provider") == result["provider"]) else {}
    excluded = set()
    for kind, (_, ranking, count) in GROUPS.items():
        try:
            rows = fetcher(kind, now, excluded)
            group = {"fetch_status": "fresh", "fetched_at": iso(now), "ranking": ranking, "events": rows}
            if len(cached_events(group, now, count, excluded)) != count:
                raise macro.SourceError("Polymarket : sélection invalide")
        except macro.SourceError as exc:
            prior = old.get(kind, {}) if isinstance(old, dict) else {}
            rows = cached_events(prior, now, count, excluded)
            group = {"fetch_status": "cached" if rows else "unavailable", "fetched_at": prior.get("fetched_at") if rows else None,
                     "ranking": ranking, "events": rows, "error": str(exc)[:180]}
        result["groups"][kind] = group
        excluded.update(row["id"] for row in group["events"])
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "data")
    args = parser.parse_args()
    output = args.output_dir / "polymarket.json"
    result = collect(macro.read_json(output), datetime.now(timezone.utc))
    macro.atomic_write_json(output, result)
    for kind, group in result["groups"].items():
        print("Polymarket", kind, group["fetch_status"], [row["title"] for row in group["events"]])
        if group.get("error"):
            print("::warning::" + group["error"])


if __name__ == "__main__":
    main()
