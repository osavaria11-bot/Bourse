"""Submitted allocations stay exact and distinct from optimized research."""
from copy import deepcopy
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import daily_fnb as daily
import prospective_portfolios as prospective
from fnb_sources import globalx


class SubmittedAllocations(unittest.TestCase):
    def setUp(self):
        self.catalog = json.loads((ROOT / "data/fnb-prospective/2026-10-26-user-allocations.json").read_text())

    def test_exact_user_weights_join_analysis_and_future_tracking_without_backdating(self):
        prospective.validate_sources(ROOT, self.catalog)
        analysis = daily.read(ROOT / "data/fnb-analysis.json")
        registry, days = daily.load_state(ROOT)
        self.assertEqual(daily.register(ROOT, registry), registry)
        daily.validate(registry, days)
        expected = [
            {"ZUQ": .20, "VFV": .15, "HXQ": .198, "XIC": .169, "ZEB": .10, "XIT": .055, "XEF": .072, "ZLB": .031, "ZLU": .025},
            {"ZUQ": .253, "FINN": .15, "HXQ": .10, "VDY": .11, "ZEB": .10, "VVL": .075, "XIT": .072, "FCMO": .045, "ZEO": .043, "XEF": .031, "FCIV": .021},
        ]
        comparison = daily.read(ROOT / "data/fnb-comparison.json")
        for portfolio, weights in zip(self.catalog["portfolios"], expected):
            key = portfolio["id"]
            self.assertEqual(portfolio["weights"], weights)
            self.assertEqual(analysis["results"][key]["weights"], weights)
            self.assertIn(key, analysis["prospective_order"])
            account = next(a for a in registry["accounts"] if a["id"] == key)
            self.assertEqual(account["weights"], weights)
            self.assertEqual(account["launch_date"], daily.publication_launch(self.catalog["published_at"]).isoformat())
            for day in days:
                if day["date"] < account["launch_date"]:
                    self.assertNotIn(key, day["accounts"])
            simulated = next(a for a in comparison["accounts"] if a["id"] == key)
            self.assertEqual(simulated["series_type"], "simulation")
            self.assertEqual(simulated["status"], "complete")
            self.assertEqual(simulated["weights"], weights)
            self.assertIsNone(analysis["lookthrough"]["results"][key]["top10_weight"])

    def test_invalid_or_changed_submissions_are_rejected_without_relaxing_research_limits(self):
        bad = deepcopy(self.catalog)
        bad["portfolios"][0]["weights"]["ZUQ"] += .001
        with self.assertRaises(ValueError):
            prospective.validate_catalog(bad)
        bad["portfolios"][0]["weights"]["VFV"] -= .001
        with self.assertRaisesRegex(ValueError, "differ from submitted"):
            prospective.validate_sources(ROOT, bad)
        research = prospective.catalogs(ROOT)[0]
        bad = deepcopy(research)
        bad["portfolios"][0]["weights"]["VCN"] -= .001
        bad["portfolios"][0]["weights"]["VMO"] += .001
        with self.assertRaisesRegex(ValueError, "exceed 30%"):
            prospective.validate_catalog(bad)


class GlobalXSource(unittest.TestCase):
    def test_total_return_chart_is_used_and_top_positions_remain_partial(self):
        body = '''<title>HXQ - Global X</title>
        <div data-growth='{"2023-05-31":"10000","2023-06-30":"11000"}'
             data-nav='{"2023-05-31":"10","2023-06-30":"9"}'></div>
        <h2>Top Sector Allocations</h2><p>As at June 30, 2023</p>
        <div data-chart='{"TECHNOLOGY":"99.8"}'></div>
        <h2>Top Geographic Exposure</h2><p>As at June 30, 2023</p>
        <div data-chart='{"UNITED STATES":"100"}'></div>
        <h2>Top Underlying Holdings</h2><p>As at June 30, 2023</p>
        <p>NVIDIA CORP</p><p>8.35%</p><p>APPLE INC</p><p>7.37%</p>
        <h2>Documents</h2>'''
        class Client:
            def get(self, url):
                return body
        fund = {"source_url": "https://www.globalx.ca/product/hxq", "provider": "globalx", "mer": .0028}
        value = globalx(Client(), "HXQ", fund, "2023-06")
        self.assertAlmostEqual(value["returns"]["2023-06"], .10)
        self.assertFalse(value["holdings"]["complete"])
        self.assertTrue(value["holdings"]["partial"])
        self.assertAlmostEqual(value["holdings"]["positions"][0][1], .0835)
        self.assertAlmostEqual(value["assets"]["equity"], .998)
        self.assertEqual(value["dates"]["prices"], "2023-06-30")
        body = body.replace("HXQ - Global X", "OTHER - Global X")
        with self.assertRaisesRegex(ValueError, "identity"):
            globalx(Client(), "HXQ", fund, "2023-06")
