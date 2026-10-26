"""Registered allocations selected prospectively; shared analysis and tracking.

The dated numerical study remains immutable provenance. Its probabilities are
not substituted for the common forecast engine used for all dashboard rows.
"""
from datetime import datetime
import hashlib
import json
import math
from pathlib import PurePosixPath

try:
    from .robust_fnb import apply_frozen
except ImportError:
    from robust_fnb import apply_frozen


def catalogs(root):
    return [json.loads(p.read_text()) for p in sorted((root / "data/fnb-prospective").glob("*.json"))]


def validate_catalog(catalog):
    if catalog["schema_version"] != 1 or catalog["kind"] != "registered_prospective_allocation" or len(catalog["portfolios"]) != 1:
        raise ValueError("One registered prospective allocation required")
    published = datetime.fromisoformat(catalog["published_at"].replace("Z", "+00:00"))
    if published.tzinfo is None or catalog["as_of"] >= published.date().isoformat():
        raise ValueError("Invalid prospective publication date")
    if catalog["benchmark"] != "VFV" or catalog["rebalance"] != "january_targets" or catalog["innovation_momentum_cap"] != .30:
        raise ValueError("Prospective investment conventions changed")
    caps = {"FEQT": .50, "FINN": .15, "XIT": .10, "ZEB": .10, "ZEO": .05, "CGL.C": .05}
    for p in catalog["portfolios"]:
        w = p["weights"]
        if not p["id"].startswith("prospective-") or p["benchmark"] != "VFV" or {"VEQT", "XEQT"} & w.keys():
            raise ValueError("Invalid prospective identity or benchmark")
        if not 1 <= len(w) <= 8 or abs(sum(w.values()) - 1) > 1e-8:
            raise ValueError("Invalid prospective allocation")
        if any(not math.isfinite(v) or not .02 <= v <= caps.get(t, .35) + 1e-8 for t, v in w.items()):
            raise ValueError("Prospective fund cap exceeded")
        if sum(w.get(t, 0) for t in ("FINN", "FCMO", "VMO", "XMI")) > .30 + 1e-8:
            raise ValueError("Innovation and momentum exceed 30%")
    return catalog


def validate_sources(root, catalog):
    validate_catalog(catalog)
    source = PurePosixPath(catalog["source"])
    if source.parent.as_posix() != "data/fnb-prospective-history" or source.suffix != ".json":
        raise ValueError("Invalid frozen prospective source")
    raw = (root / source).read_bytes()
    if hashlib.sha256(raw).hexdigest() != catalog["source_sha256"]:
        raise ValueError("Frozen prospective research changed")
    study = json.loads(raw)
    if study["benchmark"] != "VFV" or study["as_of"] != catalog["as_of"][:7]:
        raise ValueError("Prospective source identity mismatch")
    for p in catalog["portfolios"]:
        origins = [q for q in study["portfolios"] if q["id"] in p["research_ids"]]
        if len(origins) != len(p["research_ids"]) or not origins or any(q["weights"] != p["weights"] for q in origins):
            raise ValueError("Registered prospective weights differ from frozen research")


def apply(analysis, selections, previous=None):
    d = apply_frozen(analysis, selections, previous, family="prospective", validator=validate_catalog, benchmark_id="VFV")
    for k in d["prospective_order"]:
        q = d["results"][k]
        q["months_beat_benchmark"] = q.pop("months_beat_veqt")
        q["months_beat_veqt"] = sum(r > b + 1e-12 for r, b in zip(q["monthly"], d["results"]["VEQT"]["monthly"]))
    return d
