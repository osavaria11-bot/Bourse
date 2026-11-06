"""Restore verified public observations needed by newly registered allocations."""
import base64
from copy import deepcopy
from datetime import datetime
import gzip
import hashlib
import json
from pathlib import PurePosixPath

import daily_fnb as F
import collect_fnb_daily_risk as R

DESCRIPTOR = "data/fnb-submitted-sources/2026-11-05-conviction.json"


def load(root):
    if not (root / DESCRIPTOR).exists():
        return None
    descriptor = F.read(root / DESCRIPTOR)
    if descriptor["schema_version"] != 1 or descriptor["compression"] != "gzip_base64":
        raise ValueError("Invalid registered ETF source bundle")
    parts = []
    for path in descriptor["parts"]:
        p = PurePosixPath(path)
        if p.parent.as_posix() != "data/fnb-submitted-sources/2026-11-05-conviction" or p.suffix != ".b64":
            raise ValueError("Invalid registered source part")
        parts.append((root / path).read_text().strip())
    raw = gzip.decompress(base64.b64decode("".join(parts), validate=True))
    if hashlib.sha256(raw).hexdigest() != descriptor["sha256"]:
        raise ValueError("Registered public source observations changed")
    bundle = json.loads(raw)
    if bundle["catalog_path"] != descriptor["catalog_path"]:
        raise ValueError("Registered source catalog mismatch")
    return bundle


def complete(root, bundle):
    if not bundle:
        return
    analysis = F.read(root / "data/fnb-analysis.json")
    old = F.read(root / "data/fnb-daily-risk.json")
    if old["weights_signature"] != R.signature(analysis):
        daily = old["daily_series"]
        observed = {t: dict(zip(daily["dates"], values)) for t, values in daily["returns"].items()}
        for ticker, values in bundle["daily"]["returns"].items():
            observed.setdefault(ticker, dict(zip(bundle["daily"]["dates"], values)))
        now = datetime.now(F.TZ).isoformat(timespec="seconds")
        updated = R.build(analysis, {}, old["as_of"], now, return_series=observed)
        updated["return_basis"] = {t: old["return_basis"].get(t, "adjusted_market_close_total_return") for t in updated["daily_series"]["returns"]}
        updated["source_urls"] = sorted(set(old["source_urls"]) | set(bundle["daily"]["source_urls"]))
        updated["method_note"] += " Fenêtre commune limitée au premier mois complet de XCHP; les anciens historiques mensuels restent conservés."
        R.validate(updated)
        F.write(root / "data/fnb-daily-risk.json", updated)
    stress = F.read(root / "data/fnb-stress-history.json")
    original = deepcopy(stress)
    for key, extra in bundle["stress"]["scenarios"].items():
        current = stress["scenarios"].get(key)
        if current and (current["start"], current["end"]) == (extra["start"], extra["end"]):
            for ticker, observation in extra["assets"].items():
                current["assets"].setdefault(ticker, observation)
    for ticker, url in bundle["stress"]["source_urls"].items():
        stress["source_urls"].setdefault(ticker, url)
    if stress != original:
        F.write(root / "data/fnb-stress-history.json", stress)
