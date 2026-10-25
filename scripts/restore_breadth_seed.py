#!/usr/bin/env python3
"""Restore the verified ten-year bootstrap only for pre-migration checkouts."""
import gzip
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "data/market-breadth.json"
SEED = ROOT / "data/market-breadth-bootstrap.json.gz"
EXPECTED_SHA256 = "a745c50a72b027851bf742e892904f94d15ff5907e3355b9860003f3f48e8a92"

def restore():
    if TARGET.exists() and json.loads(TARGET.read_text()).get("method_version") == "current_survivor_cohort_v2":
        return False
    raw = gzip.decompress(SEED.read_bytes())
    if hashlib.sha256(raw).hexdigest() != EXPECTED_SHA256:
        raise ValueError("Invalid verified breadth bootstrap")
    json.loads(raw)
    TARGET.write_bytes(raw)
    return True

if __name__ == "__main__":
    print(str(restore()).lower())
