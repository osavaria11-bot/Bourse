"""Audit the exact three accepted recipes, annual research and common start."""
from copy import deepcopy
import json
import math
from pathlib import Path
import statistics
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import common_fnb as common
import daily_fnb as daily
import recommended_fnb as recommended


RECIPES = [
    {"ZNQ": .35, "ZUQ": .226, "VDY": .188, "XEF": .12, "VEE": .066, "VCN": .05},
    {"ZNQ": .35, "ZUQ": .195, "VDY": .09, "XEF": .114, "VEE": .063, "ZLB": .088, "CGL.C": .05, "ZEO": .05},
    {"ZNQ": .35, "ZUQ": .114, "VDY": .128, "XEF": .082, "VEE": .051, "ZEO": .05, "VEQT": .20, "VVL": .025},
]


class RecommendedPortfolios(unittest.TestCase):
    def setUp(self):
        self.catalog = recommended.catalogs(ROOT)[0]
        self.data = daily.read(ROOT / "data/fnb-analysis.json")

    def test_accepted_recipes_and_annual_history_match_independent_accounting(self):
        recommended.validate_sources(ROOT, self.catalog)
        source = daily.read(ROOT / self.catalog["source"])
        for item, recipe, cagr in zip(self.catalog["portfolios"], RECIPES, [.18073363226886086, .18134342816672588, .1802977149286249]):
            self.assertEqual(item["weights"], recipe)
            h = item["historical_backtest"]
            self.assertEqual(h["rebalance"], "january_targets")
            self.assertEqual(h["validation_type"], "retrospective_reused")
            self.assertEqual(h["periods"]["full"]["months"], 91)
            self.assertEqual(h["periods"]["after"]["months"], 33)
            self.assertAlmostEqual(h["periods"]["full"]["cagr"], cagr, places=11)
            # Independently track capital invested in each sleeve, resetting
            # to target dollars only at January boundaries.
            capital, holdings, rr = 10000., {}, []
            for i, month in enumerate(h["dates"]):
                if i == 0 or month.endswith("-01"):
                    holdings = {t: capital*w for t,w in recipe.items()}
                for t in recipe:
                    holdings[t] *= 1+source["funds"][t]["returns"][month]
                end = sum(holdings.values())
                rr.append(end/capital-1)
                capital = end
            for actual, expected in zip(h["monthly"], rr):
                self.assertAlmostEqual(actual, expected, places=13)
            active = [r-source["funds"]["VFV"]["returns"][m] for r,m in zip(rr,h["dates"])]
            ir = statistics.mean(active)*12/(statistics.stdev(active)*math.sqrt(12))
            self.assertAlmostEqual(h["periods"]["full"]["information_sp500"], ir, places=11)
            for key in ("full", "before", "after"):
                self.assertTrue(h["periods"][key]["beats_sp500"])

    def test_frozen_recipe_research_and_veqt_cap_are_enforced(self):
        bad = deepcopy(self.catalog)
        bad["portfolios"][0]["weights"]["VCN"] -= .001
        bad["portfolios"][0]["weights"]["XEF"] += .001
        with self.assertRaisesRegex(ValueError, "research allocation or result changed"):
            recommended.validate_sources(ROOT, bad)
        bad = deepcopy(self.catalog)
        bad["portfolios"][2]["weights"] = {"VEQT": .401, "ZNQ": .30, "ZUQ": .299}
        with self.assertRaisesRegex(ValueError, "cap exceeded"):
            recommended.validate_catalog(bad)
        for item in self.catalog["portfolios"]:
            q = self.data["results"][item["id"]]
            self.assertEqual(q["benchmark"], "VFV")
            self.assertEqual(q["weights"], item["weights"])

    def test_common_start_is_complete_without_backdating_the_permanent_ledger(self):
        registry, days = daily.load_state(ROOT)
        daily.validate(registry, days)
        saved = daily.read(ROOT / common.DATA)
        rebuilt, cache, errors = common.build(ROOT, registry, days, common.cached_prices(ROOT), saved["updated_at"])
        self.assertEqual(saved, rebuilt)
        self.assertFalse(errors)
        self.assertEqual(saved["benchmarks"], ["FEQT", "VEQT", "VGRO", "VBAL", "VFV"])
        for item in self.catalog["portfolios"]:
            account = next(a for a in registry["accounts"] if a["id"] == item["id"])
            self.assertEqual(account["launch_date"], daily.publication_launch(self.catalog["published_at"]).isoformat())
            for day in days:
                if day["date"] < account["launch_date"]:
                    self.assertNotIn(item["id"], day["accounts"])
            simulation = next(a for a in saved["accounts"] if a["id"] == item["id"])
            self.assertEqual(simulation["weights"], item["weights"])
            self.assertEqual(simulation["series_type"], "simulation")
            self.assertEqual(simulation["history"][0], {"date": "2026-10-19", "value": 10000.})
            self.assertEqual(simulation["history"][-1]["date"], saved["as_of"])
            self.assertEqual(simulation["status"], "complete")
