"""Recent ETF histories stay unavailable before inception; real tracking is separate."""
from copy import deepcopy
from datetime import datetime
import json
import math
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import daily_fnb as F
import monthly_fnb as M
import prospective_portfolios as P
import collect_fnb_daily_risk as R


class ConvictionPortfolios(unittest.TestCase):
    def setUp(self):
        self.catalog = F.read(ROOT / "data/fnb-prospective/2026-11-05-conviction.json")
        self.analysis = F.read(ROOT / "data/fnb-analysis.json")

    def test_accepted_allocations_and_local_mandates_are_frozen(self):
        P.validate_sources(ROOT, self.catalog)
        self.assertEqual(len(self.catalog["portfolios"]), 2)
        for p in self.catalog["portfolios"]:
            self.assertEqual(self.analysis["results"][p["id"]]["weights"], p["weights"])
            self.assertAlmostEqual(sum(p["weights"].values()), 1)
            self.assertLessEqual(max(p["weights"].values()), .30)
            self.assertEqual(p["weights"]["XCHP"], .05)
            self.assertLessEqual(p["weights"]["ZEB"], .15)
            self.assertEqual(p["weights"]["FINN"], .20)
            self.assertNotIn("HBLK", p["weights"])
            self.assertNotIn("ZVU", p["weights"])
            bad = deepcopy(self.catalog)
            bad["portfolios"][0]["weights"]["XCHP"] += .01
            bad["portfolios"][0]["weights"]["FINN"] -= .01
            with self.assertRaisesRegex(ValueError, "own mandate"):
                P.validate_catalog(bad)

    def test_independent_dollar_positions_match_only_the_available_history(self):
        d = self.analysis
        for p in self.catalog["portfolios"]:
            q = d["results"][p["id"]]
            offset = d["dates"].index("2023-10")
            self.assertEqual(q["monthly"][:offset], [None] * offset)
            self.assertEqual(q["wealth"][:offset], [None] * offset)
            self.assertEqual(q["wealth"][offset], 10000.)
            capital, sleeves = 10000., {}
            for i, month in enumerate(d["dates"][offset:], offset):
                if i == offset or month.endswith("-01"):
                    sleeves = {t: capital * w for t, w in p["weights"].items()}
                for t in sleeves:
                    sleeves[t] *= 1 + d["universe"]["returns"][t][i]
                end = sum(sleeves.values())
                self.assertAlmostEqual(q["monthly"][i], end / capital - 1, places=12)
                self.assertAlmostEqual(q["wealth"][i + 1], end, places=7)
                capital = end
            self.assertAlmostEqual(q["cagr"], (capital / 10000.) ** (12 / (len(d["dates"]) - offset)) - 1, places=12)
            for key in d["custom_order"]:
                self.assertTrue(all(isinstance(v, (int, float)) for v in d["results"][key]["monthly"]))
            bad = deepcopy(d)
            bad["universe"]["returns"]["XCHP"][offset] = None
            with self.assertRaisesRegex(ValueError, "Missing observed"):
                P.apply(bad, P.catalogs(ROOT), d)

    def test_future_month_extends_history_without_replaying_missing_months(self):
        d = deepcopy(self.analysis)
        last = d["dates"][-1]
        next_month = f"{int(last[:4]) + (last[5:] == '12'):04d}-{int(last[5:]) % 12 + 1:02d}"
        d["dates"].append(next_month)
        d["universe"]["dates"].append(next_month)
        for values in d["universe"]["returns"].values():
            values.append(.01)
        for reference in ("VEQT", "VFV"):
            d["results"][reference]["monthly"].append(.01)
        P.apply(d, P.catalogs(ROOT), self.analysis)
        for p in self.catalog["portfolios"]:
            old, new = self.analysis["results"][p["id"]], d["results"][p["id"]]
            self.assertEqual(new["monthly"][:-1], old["monthly"])
            self.assertEqual(new["weights"], old["weights"])
            self.assertAlmostEqual(new["monthly"][-1], .01)

    def test_common_start_simulation_cannot_backdate_the_after_publication_accounts(self):
        registry, days = F.load_state(ROOT)
        self.assertEqual(F.register(ROOT, registry), registry)
        comparison = F.read(ROOT / "data/fnb-comparison.json")
        for p in self.catalog["portfolios"]:
            account = next(a for a in registry["accounts"] if a["id"] == p["id"])
            self.assertEqual(account["capital"], 10000.)
            self.assertEqual(account["launch_date"], F.publication_launch(self.catalog["published_at"]).isoformat())
            for day in days:
                if day["date"] < account["launch_date"]:
                    self.assertNotIn(p["id"], day["accounts"])
            simulation = next(a for a in comparison["accounts"] if a["id"] == p["id"])
            self.assertEqual(simulation["series_type"], "simulation")
            self.assertEqual(simulation["history"][0], {"date": F.START, "value": 10000.})
            self.assertEqual(simulation["history"][-1]["date"], comparison["as_of"])

    def test_daily_risk_uses_real_common_observations_and_complete_sources(self):
        risk = R.validate(F.read(ROOT / "data/fnb-daily-risk.json"))
        self.assertEqual(risk["weights_signature"], R.signature(self.analysis))
        self.assertEqual(risk["window_start"], "2023-10-01")
        self.assertGreaterEqual(risk["sample_start"], "2023-10-01")
        for p in self.catalog["portfolios"]:
            row = risk["results"][p["id"]]
            self.assertEqual(row["weights"], p["weights"])
            self.assertTrue(math.isfinite(row["var95"]))
        self.assertEqual(F.read(ROOT / "data/fnb-model.json")["funds"]["FCUV"]["quote_symbol"], "FCUV.TO")


if __name__ == "__main__":
    unittest.main()
