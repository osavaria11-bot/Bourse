"""One deduplicated allocation joins existing analysis and append-only tracking."""
from copy import deepcopy
import json
import math
from pathlib import Path
import statistics
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import daily_fnb as daily
import monthly_fnb as monthly
import prospective_portfolios as prospective


class ProspectiveRegistration(unittest.TestCase):
    def setUp(self):
        self.catalogs = prospective.catalogs(ROOT)
        self.catalog = self.catalogs[0]
        self.registered_ids = [p["id"] for c in self.catalogs for p in c["portfolios"]]
        self.data = daily.read(ROOT / "data/fnb-analysis.json")
        self.item = self.catalog["portfolios"][0]
        self.key = self.item["id"]

    def test_two_identical_research_allocations_become_one_frozen_investment(self):
        prospective.validate_sources(ROOT, self.catalog)
        self.assertEqual(self.data["prospective_order"], self.registered_ids)
        self.assertEqual(len(self.item["research_ids"]), 2)
        self.assertEqual(self.data["results"][self.key]["weights"], self.item["weights"])
        self.assertEqual(sum(self.item["weights"].get(t, 0) for t in ("FINN", "FCMO", "VMO", "XMI")), .30)
        bad = deepcopy(self.catalog)
        bad["portfolios"][0]["weights"]["XSU"] -= .001
        bad["portfolios"][0]["weights"]["VCN"] += .001
        with self.assertRaisesRegex(ValueError, "differ from frozen research"):
            prospective.validate_sources(ROOT, bad)
        bad = deepcopy(self.catalog)
        bad["portfolios"][0]["weights"]["VCN"] -= .001
        bad["portfolios"][0]["weights"]["VMO"] += .001
        with self.assertRaisesRegex(ValueError, "exceed 30%"):
            prospective.validate_catalog(bad)

    def test_historical_metrics_share_annual_rebalancing_and_the_vfv_benchmark(self):
        q, w = self.data["results"][self.key], self.item["weights"]
        funds = self.data["universe"]["returns"]
        capital, sleeves, returns = 10000., {}, []
        for i, month in enumerate(self.data["dates"]):
            if i == 0 or month.endswith("-01"):
                sleeves = {t: capital * v for t, v in w.items()}
            for t in w:
                sleeves[t] *= 1 + funds[t][i]
            end = sum(sleeves.values())
            returns.append(end / capital - 1)
            capital = end
        for a, b in zip(returns, q["monthly"]):
            self.assertAlmostEqual(a, b, places=13)
        active = [a - b for a, b in zip(returns, self.data["results"]["VFV"]["monthly"])]
        self.assertAlmostEqual(q["information"], statistics.mean(active) * 12 / (statistics.stdev(active) * math.sqrt(12)), places=12)
        self.assertAlmostEqual(q["mer"], sum(v * self.data["universe"]["mer"][t] for t, v in w.items()), places=12)
        self.assertEqual(q["benchmark"], "VFV")

    def test_monthly_append_preserves_the_allocation_and_every_acquired_return(self):
        current = deepcopy(self.data)
        prospective.apply(current, self.catalogs, self.data)
        self.assertEqual(current, self.data)
        current["dates"].append("2026-10")
        for t, r in current["universe"]["returns"].items():
            r.append(.01)
        for b in ("VEQT", "VFV"):
            current["results"][b]["monthly"].append(.01)
        prospective.apply(current, self.catalogs, self.data)
        q = current["results"][self.key]
        self.assertEqual(q["weights"], self.item["weights"])
        self.assertEqual(q["monthly"][:-1], self.data["results"][self.key]["monthly"])
        self.assertAlmostEqual(q["monthly"][-1], .01, places=12)
        self.assertEqual(current["prospective_order"], self.registered_ids)
        bad = deepcopy(self.data)
        bad["results"][self.key]["monthly"][0] += .001
        with self.assertRaisesRegex(ValueError, "acquired return changed"):
            prospective.apply(deepcopy(self.data), self.catalogs, bad)

    def test_post_publication_launch_is_not_backdated_to_the_common_start_simulation(self):
        registry, days = daily.load_state(ROOT)
        self.assertEqual(daily.register(ROOT, registry), registry)
        daily.validate(registry, days)
        account = next(a for a in registry["accounts"] if a["id"] == self.key)
        self.assertEqual(account["launch_date"], daily.publication_launch(self.catalog["published_at"]).isoformat())
        for day in days:
            if day["date"] < account["launch_date"]:
                self.assertNotIn(self.key, day["accounts"])
        comparison = daily.read(ROOT / "data/fnb-comparison.json")
        simulation = next(a for a in comparison["accounts"] if a["id"] == self.key)
        self.assertEqual(simulation["series_type"], "simulation")
        self.assertEqual(simulation["actual_launch_date"], account["launch_date"])
        self.assertEqual(simulation["weights"], account["weights"])
        self.assertEqual(simulation["history"][0], {"date": daily.START, "value": 10000.})
        self.assertEqual(simulation["history"][-1]["date"], comparison["as_of"])
