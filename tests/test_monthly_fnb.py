import copy
from datetime import date
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from scripts import fnb_sources as sources
from scripts import monthly_fnb as model

ROOT = Path(__file__).resolve().parents[1]


class ReturnGuards(unittest.TestCase):
    def test_latest_risk_free_observation_is_selected_even_in_reverse_order(self):
        class Client:
            def json(self, url):
                return {"observations": [{"d":"2026-10-16","TB.CDN.90D.MID":{"v":"2.37"}}, {"d":"2026-10-15","TB.CDN.90D.MID":{"v":"2.38"}}]}
        r = sources.risk_free(Client(), "2026-09")
        self.assertEqual(r["date"], "2026-10-16")
        self.assertAlmostEqual(r["rate"], .0237)

    def test_fidelity_foreign_and_canadian_equity_labels_are_counted(self):
        alloc = lambda values: {"CM":{"asOfDate":"2026-09-30", "allocations": {k:{"value":str(v)} for k,v in values.items()}}}
        d = {"axisCode":"FCUL", "series":{"L":{"currency":"CAD", "merPct":"0.38%"}}, "allocations":{
            "assetAllocations":alloc({"Foreign Equities":95, "Canadian Equities":4.9, "Other Investments":.1}),
            "countryAllocations":alloc({"United States":95, "Canada":4.9}),
            "sectorAllocations":alloc({"Information Technology":99.9})},
            "holdings":{"holdingsByCategory":{"":{"asOfDate":"2026-09-30", "holdings":[{"name":"Apple", "netPercent":"99.9%", "marketValue":"$999"}]}}}}
        class Client:
            def json(self, url):
                return {"asOfDate":"2026-09-30", "dailyPerformanceBySeries":{"L":[1.001]*100}} if "dailyPerformance" in url else d
        r = sources.fidelity(Client(), "FCUL", {"mer":.0038,"source_url":"https://www.fidelity.ca/","provider":"fidelity"}, "2026-09")
        self.assertAlmostEqual(r["assets"]["equity"], .999)
        self.assertAlmostEqual(r["assets"]["cash"], .001)
        self.assertAlmostEqual(r["mer"], .0038)

    def test_total_return_levels_retain_distributions_and_splits_without_raw_price_spikes(self):
        points = [("2024-09-30", 100.), ("2024-10-15", 102.), ("2024-10-31", 103.09), ("2024-11-29", 105.)]
        r = sources.monthly_from_levels(points, "2024-11")
        self.assertAlmostEqual(r["2024-10"], .0309)
        self.assertAlmostEqual(r["2024-11"], 105 / 103.09 - 1)

    def test_partial_and_missing_months_cannot_be_fabricated(self):
        r = sources.monthly_from_levels([("2026-07-31", 100.), ("2026-08-31", 102.), ("2026-09-15", 103.)], "2026-09")
        self.assertEqual(set(r), {"2026-08"})
        r = sources.monthly_from_levels([("2026-06-30", 100.), ("2026-08-31", 102.)], "2026-08")
        self.assertEqual(r, {})

    def test_completed_month_uses_the_actual_last_canadian_trading_day(self):
        self.assertEqual(sources.last_trading_day("2024-03"), date(2024,3,28))
        self.assertEqual(sources.last_trading_day("2026-10"), date(2026,10,30))
        self.assertEqual(sources.last_trading_day("2026-05"), date(2026,5,29))
        self.assertEqual(sources.monthly_from_levels([("2026-08-31",100.), ("2026-09-29",101.)],"2026-09"), {})

    def test_annual_rebalance_is_checked_against_independent_position_levels(self):
        dates = ["2025-11", "2025-12", "2026-01", "2026-02"]
        funds = {"A": [.10, .10, -.10, .20], "B": [-.05, 0., .05, 0.]}
        r = model.portfolio_returns({"A": .6, "B": .4}, funds, dates)
        self.assertAlmostEqual(r[0], .6 * .10 + .4 * -.05)
        self.assertAlmostEqual(r[1], (.6 * 1.1**2 + .4 * .95) / (.6 * 1.1 + .4 * .95) - 1)
        self.assertAlmostEqual(r[2], .6 * -.10 + .4 * .05)
        self.assertAlmostEqual(r[3], (.6 * .9 * 1.2 + .4 * 1.05) / (.6 * .9 + .4 * 1.05) - 1)


class PublicationGuards(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.baseline = model.read(ROOT / "data/fnb-history/baseline-2026-10-19.json")
        cls.current = model.read(ROOT / "data/fnb-analysis.json") if (ROOT / "data/fnb-analysis.json").exists() else None
        cls.initial = model.read(ROOT / "data/fnb-history/2026-10.json") if (ROOT / "data/fnb-history/2026-10.json").exists() else None

    def test_entire_initial_history_and_allocations_are_preserved(self):
        if not self.current: self.skipTest("Initial research not yet generated")
        model.validate(self.current, self.baseline)
        for key in self.baseline["order"]:
            self.assertEqual(self.current["results"][key]["weights"], self.baseline["results"][key]["weights"])
            self.assertEqual(self.current["results"][key]["monthly"][:40], self.baseline["results"][key]["monthly"])

    def test_archive_idempotency_never_calls_sources_or_overwrites_results(self):
        if not self.current: self.skipTest("Initial research not yet generated")
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); (root / "data/fnb-history").mkdir(parents=True)
            config = model.read(ROOT / "data/fnb-model.json")
            model.write(root / "data/fnb-model.json", config)
            model.write(root / config["baseline"], self.baseline)
            model.write(root / "data/fnb-history/2026-10.json", self.initial)
            file = root / "data/fnb-history/2026-10.json"; before = file.read_bytes()
            with patch.object(model, "collect", side_effect=AssertionError("Must not fetch a duplicate month")):
                model.main(["--root", str(root), "--date", "2026-10-31"])
            self.assertEqual(before, file.read_bytes())

    def test_new_month_proposal_can_change_while_existing_histories_only_extend(self):
        if not self.current: self.skipTest("Initial research not yet generated")
        config = model.read(ROOT / "data/fnb-model.json"); current = self.initial; u = current["universe"]
        data = {"as_of":"2026-10-31", "risk_free":current["optimization"]["risk_free"], "funds":{}}
        extra = model.read(ROOT / "data/fnb-frontier-universe.json")["funds"] if (ROOT / "data/fnb-frontier-universe.json").exists() else {}
        for t in config["funds"]:
            if t not in u["returns"] and t != "VEQT":
                f = extra[t]
                data["funds"][t] = {"returns":{**dict(zip(current["dates"], f["returns"])), "2026-10":.01},
                    "geo":f["geo"], "sector":f["sector"], "assets":{"equity":f["equity"], "cash":1-f["equity"], "bond":0., "crypto":0., "gold":0.},
                    "mer":f["mer"], "dates":f["source_dates"], "source_url":f["source_url"], "return_method":f["method"]}
                continue
            data["funds"][t] = {"returns":{"2026-10":.01}, "geo":u["geo"][t], "sector":u["sector"][t],
                "assets":{a:u[a][t] for a in ["equity","bond","crypto","gold","cash"]}, "mer":u["mer"][t],
                "dates":current["source_dates"][t], "source_url":current["source_urls"][t], "return_method":"Test fixture"}
        weights = dict(current["results"]["proposal"]["weights"])
        weights["FCUL"] -= .001; weights["FCUQ"] += .001
        original = copy.deepcopy(current)
        with patch.object(model,"optimize",return_value=weights), patch.object(model,"walk_forward",return_value=current["optimization"]["validation"]):
            new = model.refresh_analysis(current,self.baseline,data,config,"2026-11-01T12:37:00Z")
        model.validate(new,self.baseline)
        self.assertEqual(current,original)
        self.assertEqual(new["results"]["proposal"]["weights"],weights)
        for t in extra:
            self.assertEqual(new["universe"]["returns"][t][:40],extra[t]["returns"])
        self.assertNotIn("VEQT",new["optimization"]["eligible_funds"])
        self.assertNotIn("XEQT",new["optimization"]["eligible_funds"])
        self.assertNotEqual(new["results"]["proposal"]["monthly"][:40],current["results"]["proposal"]["monthly"])
        for k in self.baseline["order"]:
            self.assertEqual(new["results"][k]["monthly"][:40],current["results"][k]["monthly"])
            self.assertEqual(len(new["results"][k]["monthly"]),41)

    def test_failed_collection_changes_only_status_and_keeps_no_new_recommendation(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); (root / "data/fnb-history").mkdir(parents=True)
            config = model.read(ROOT / "data/fnb-model.json")
            model.write(root / "data/fnb-model.json", config)
            model.write(root / config["baseline"], self.baseline)
            model.write(root / "data/fnb-analysis.json", self.current or self.baseline)
            before = (root / "data/fnb-analysis.json").read_bytes()
            with patch.object(model, "collect", side_effect=ValueError("Issuer is late")):
                with self.assertRaisesRegex(ValueError, "Issuer is late"):
                    model.main(["--root", str(root), "--date", "2026-11-01"])
            self.assertEqual(before, (root / "data/fnb-analysis.json").read_bytes())
            self.assertFalse((root / "data/fnb-history/2026-11.json").exists())
            self.assertEqual(model.read(root / "data/fnb-status.json")["status"], "retrying")

    def test_funds_with_crypto_bonds_gold_or_material_cash_are_excluded(self):
        config = {"funds": {t: {"currency": "CAD", "exchange": "TSX", "equity_eligible": True} for t in ["equity", "crypto", "bond", "gold", "cash"]}}
        data = {"funds": {}}
        for ticker in config["funds"]:
            assets = dict(equity=1., crypto=0., bond=0., gold=0., cash=0.)
            if ticker != "equity": assets.update(equity=.90, **{ticker: .1})
            data["funds"][ticker] = {"assets": assets}
        self.assertEqual(model.eligible_funds(config, data), ["equity"])

    def test_chronological_training_never_reads_the_next_return(self):
        dates = model.months_between("2024-01", "2026-04")
        returns = {"A": [i / 1000 for i in range(len(dates))]}
        config = {"optimization": {"minimum_training_months": 24, "trading_cost_one_way": .0005}}
        calls = []
        def fit(train, names, src, conf, benchmark, rf):
            calls.append(len(train["A"]))
            self.assertEqual(len(benchmark), len(train["A"]))
            self.assertLess(train["A"][-1], returns["A"][len(train["A"])])
            return {"A": 1.}
        with patch.object(model, "optimize", side_effect=fit):
            v = model.walk_forward(returns, ["A"], {}, config, returns["A"], .02, dates)
        self.assertEqual(calls, [24,25,26,27])
        self.assertAlmostEqual(v["monthly"][0], (1 + .024) * .9995 - 1)
        self.assertTrue(all(r["training_end"] < r["month"] for r in v["audit"]))


if __name__ == "__main__":
    unittest.main()
