import copy
from datetime import datetime
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import daily_fnb as daily
import monthly_fnb as monthly
import robust_fnb as robust


class RobustPortfolios(unittest.TestCase):
    def setUp(self):
        self.d = monthly.read(ROOT / "data/fnb-analysis.json")
        self.catalog = robust.catalogs(ROOT)[0]

    def test_recipes_are_reproducible_from_immutable_research_and_are_distinct(self):
        robust.validate_sources(ROOT, self.catalog)
        p = self.catalog["portfolios"]
        self.assertEqual([x["compromise_fraction"] for x in p], [1., .7, .5])
        self.assertEqual(len({json.dumps(x["weights"], sort_keys=True) for x in p}), 3)
        self.assertIn("pas un test indépendant", self.catalog["limitations"])
        broken = copy.deepcopy(self.catalog); broken["portfolios"][0]["weights"]["CGL.C"] += .001
        with self.assertRaises(ValueError): robust.validate_sources(ROOT, broken)

    def test_same_backtest_convention_all_windows_and_fee_tradeoff(self):
        ordered = []
        for p in self.catalog["portfolios"]:
            q = self.d["results"][p["id"]]
            self.assertEqual(q["weights"], p["weights"])
            expected = monthly.portfolio_returns(q["weights"], self.d["universe"]["returns"], self.d["dates"])
            self.assertEqual(q["monthly"], expected)
            for name, window in q["robust_diagnostics"].items():
                start = self.d["dates"].index(window["start"]); end = start+window["months"]
                result = monthly.period_stats(expected[start:end], self.d["results"]["VEQT"]["monthly"][start:end], self.d["assumptions"]["risk_free"])
                self.assertEqual(result["information"], window["information"], name)
            # Launch selection passes its declared recent-period review screen.
            self.assertFalse(q["robust_review"]["review_required"])
            self.assertGreater(q["robust_diagnostics"]["derniers_6"]["gap"], 0)
            self.assertGreater(q["robust_diagnostics"]["derniers_12"]["information"], 0)
            ordered.append(q["mer"])
        self.assertGreater(ordered[0], ordered[1]); self.assertGreater(ordered[1], ordered[2])

    def test_missing_source_or_changed_acquired_returns_are_rejected(self):
        d = copy.deepcopy(self.d); del d["universe"]["returns"]["XMV"]
        with self.assertRaisesRegex(ValueError, "Missing aligned"): robust.apply(d, [self.catalog])
        prior = copy.deepcopy(self.d); prior["results"][prior["robust_order"][0]]["monthly"][0] += .01
        with self.assertRaisesRegex(ValueError, "acquired return"): robust.apply(copy.deepcopy(self.d), [self.catalog], prior)

    def test_monthly_refresh_extends_robust_history_and_freezes_launch_weights(self):
        d = self.d; config = monthly.read(ROOT / "data/fnb-model.json"); u = d["universe"]
        extra = monthly.read(ROOT / "data/fnb-frontier-universe.json")["funds"]
        sources = {"as_of": "2026-10-31", "risk_free": d["optimization"]["risk_free"], "funds": {}}
        for t in config["funds"]:
            if t in u["returns"]:
                f = {"returns": {**dict(zip(d["dates"],u["returns"][t])), "2026-10": .01},
                    "geo": u["geo"][t], "sector": u["sector"][t], "assets": {a:u[a][t] for a in ["equity","cash","bond","crypto","gold"]},
                    "mer": u["mer"][t], "dates": d["source_dates"][t], "source_url": d["source_urls"][t], "return_method": "fixture"}
            else:
                x = extra[t]
                f = {"returns": {**dict(zip(d["dates"],x["returns"])), "2026-10": .01}, "geo":x["geo"], "sector":x["sector"],
                    "assets":{"equity":x["equity"],"cash":1-x["equity"],"bond":0.,"crypto":0.,"gold":0.},
                    "mer":x["mer"],"dates":x["source_dates"],"source_url":x["source_url"],"return_method":"fixture"}
            sources["funds"][t] = f
        before = copy.deepcopy(d)
        with patch.object(monthly,"optimize",return_value=d["results"]["proposal"]["weights"]), patch.object(monthly,"walk_forward",return_value=d["optimization"]["validation"]):
            new = monthly.refresh_analysis(d,monthly.read(ROOT / config["baseline"]),sources,config,"2026-11-01T09:00:00-05:00")
        self.assertEqual(d,before); self.assertEqual(new["robust_order"],d["robust_order"])
        for k in d["robust_order"]:
            self.assertEqual(new["results"][k]["weights"],d["results"][k]["weights"])
            self.assertEqual(new["results"][k]["monthly"][:-1],d["results"][k]["monthly"])
            self.assertEqual(len(new["results"][k]["monthly"]),len(d["dates"])+1)
            self.assertEqual(new["results"][k]["robust_review"]["as_of"],"2026-10-31")

    def test_new_accounts_wait_for_first_eligible_close_and_never_replay_old_days(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for name in [daily.BASELINE, "data/fnb-model.json"]:
                target = root / name; target.parent.mkdir(parents=True,exist_ok=True); shutil.copyfile(ROOT / name,target)
            registry = daily.register(root,{"schema_version":1,"accounts":[]})
            tickers = {t for a in registry["accounts"] for t in a["weights"]}
            quote = lambda t: {"close":100.,"adjusted_close":100.,"distribution":0.,"split":1.,"symbol":t,"source_url":"https://example.test"}
            prices = {t:{day:quote(t) for day in ["2026-10-19","2026-10-20","2026-10-21"]} for t in tickers}
            daily.run(root,datetime.fromisoformat("2026-10-19T18:37:00-04:00"),prices)
            archive = root / "data/fnb-performance/days/2026-10-19.json"; frozen = archive.read_bytes()
            (root / "data/fnb-robust").mkdir(); monthly.write(root / self.catalog["catalog_path"],self.catalog)
            for p in self.catalog["portfolios"]:
                for t in p["weights"]: prices.setdefault(t,{day:quote(t) for day in ["2026-10-19","2026-10-20","2026-10-21"]})
            pending = daily.run(root,datetime.fromisoformat("2026-10-20T18:37:00-04:00"),prices)
            additions = [a for a in pending["accounts"] if a["id"].startswith("robust-")]
            self.assertEqual(len(additions),3)
            for a in additions: self.assertEqual(a["launch_date"],"2026-10-21"); self.assertEqual(a["history"],[])
            started = daily.run(root,datetime.fromisoformat("2026-10-21T18:37:00-04:00"),prices)
            for a in started["accounts"]:
                if a["id"].startswith("robust-"): self.assertAlmostEqual(a["history"][0]["value"],10000.); self.assertEqual(len(a["history"]),1)
            self.assertEqual(archive.read_bytes(),frozen)
            catalog = copy.deepcopy(self.catalog); catalog["portfolios"][0]["name"] += " changed"
            monthly.write(root / catalog["catalog_path"],catalog)
            with self.assertRaisesRegex(ValueError,"Frozen account definition changed"): daily.register(root,daily.load_state(root)[0])
