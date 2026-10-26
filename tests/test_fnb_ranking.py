"""Independent numerical audit of the shared ranking and displayed returns."""
import json
import math
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import monthly_fnb as monthly


class RankingAudit(unittest.TestCase):
    def test_all_candidates_match_the_common_financial_calculator(self):
        d = json.loads((ROOT / "data/fnb-analysis.json").read_text())
        output = subprocess.check_output(["node", "-e", "const D=require('./data/fnb-analysis.json');console.log(JSON.stringify(require('./scripts/fnb_preferences.cjs')(D)))"], cwd=ROOT, text=True)
        ranking = json.loads(output)
        for entry in ranking["entries"]:
            p = d["results"][entry["id"]]
            for window in entry["diagnostics"].values():
                start = d["dates"].index(window["start"])
                end = start + window["months"]
                returns = p["monthly"][start:end]
                benchmark = "VFV" if entry["id"] in d.get("recommended_order", []) + d.get("prospective_order", []) else "VEQT"
                self.assertEqual(entry["benchmark"], benchmark)
                expected = monthly.period_stats(returns, d["results"][benchmark]["monthly"][start:end], d["assumptions"]["risk_free"])
                for key in ["sharpe", "information"]:
                    if expected[key] is None: self.assertIsNone(window[key])
                    else: self.assertAlmostEqual(expected[key], window[key], places=11)
                self.assertAlmostEqual(math.prod(1+r for r in returns)-1, window["total_return"], places=11)
        for portfolio in d["results"].values():
            value = d["assumptions"]["initial"]
            for i, r in enumerate(portfolio["monthly"]):
                value *= 1+r
                self.assertAlmostEqual(value, portfolio["wealth"][i+1], places=7)
            self.assertAlmostEqual(value, portfolio["end"], places=7)
            self.assertAlmostEqual((value/10000)**(12/len(d["dates"]))-1, portfolio["cagr"], places=11)
