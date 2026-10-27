import copy
from datetime import date, datetime, timedelta
import importlib.util
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import daily_fnb as F


class PermanentTracking(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name)
        for name in [F.BASELINE, "data/fnb-model.json"]:
            p = self.root / name; p.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(ROOT / name, p)
        self.registry = F.register(self.root, {"schema_version": 1, "accounts": []})
        self.tickers = {t for a in self.registry["accounts"] for t in a["weights"]}

    def tearDown(self): self.temp.cleanup()

    def quotes(self, last="2026-10-19"):
        out = {t: {} for t in self.tickers}; day = date.fromisoformat(F.START)
        while day.isoformat() <= last:
            for t in out:
                out[t][day.isoformat()] = {"close": 100., "adjusted_close": 100., "distribution": 0., "split": 1., "symbol": t, "source_url": "https://example.test"}
            day = F.next_session(day)
        return out

    def run_day(self, day="2026-10-19", quotes=None):
        return F.run(self.root, datetime.fromisoformat(day + "T18:37:00").replace(tzinfo=F.TZ), quotes or self.quotes(day))

    def test_launch_16_accounts_at_exact_capital_and_original_weights(self):
        d = self.run_day(); self.assertEqual(len(d["accounts"]), 16)
        baseline = F.read(self.root / F.BASELINE)
        for a in d["accounts"]:
            self.assertAlmostEqual(a["history"][0]["value"], 10000.)
            self.assertEqual(a["launch_date"], F.START)
        for k in baseline["custom_order"]:
            self.assertEqual(next(a for a in d["accounts"] if a["id"] == "savy-" + k)["weights"], baseline["results"][k]["weights"])

    def test_idempotent_refresh_preserves_units_capital_and_daily_bytes(self):
        first = self.run_day(); file = self.root / "data/fnb-performance/days/2026-10-19.json"; accepted = file.read_bytes()
        second = self.run_day(); self.assertEqual(first, second); self.assertEqual(accepted, file.read_bytes())
        registry, days = F.load_state(self.root); F.validate(registry, days)

    def test_dividend_and_split_are_applied_once_then_reinvested(self):
        self.run_day(); q = self.quotes("2026-10-20")
        q["FEQT"]["2026-10-20"].update(close=50., adjusted_close=51., distribution=1., split=2.)
        q["FEQT"][F.START]["adjusted_close"] = 50.
        d = self.run_day("2026-10-20", q); a = next(a for a in d["accounts"] if a["id"] == "FEQT")
        self.assertAlmostEqual(a["history"][-1]["value"], 10200.)
        _, days = F.load_state(self.root); self.assertAlmostEqual(days[-1]["accounts"]["FEQT"]["units"]["FEQT"], 204.)
        self.run_day("2026-10-20", q); self.assertEqual(len(F.load_state(self.root)[1]), 2)

    def test_weights_drift_without_target_rebalancing(self):
        self.run_day(); q = self.quotes("2026-10-20"); q["FEQT"]["2026-10-20"].update(close=200., adjusted_close=200.)
        d = self.run_day("2026-10-20", q); a = next(a for a in d["accounts"] if a["id"] == "savy-1")
        self.assertAlmostEqual(a["history"][-1]["value"], 14000.)
        _, days = F.load_state(self.root); self.assertEqual(days[0]["accounts"]["savy-1"]["units"], days[1]["accounts"]["savy-1"]["units"])

    def test_missing_one_close_leaves_all_existing_files_intact(self):
        self.run_day(); old = {p.relative_to(self.root): p.read_bytes() for p in self.root.rglob("*.json")}
        q = self.quotes("2026-10-20"); del q["FEQT"]["2026-10-20"]
        with self.assertRaisesRegex(ValueError, "Missing official"): self.run_day("2026-10-20", q)
        self.assertEqual(old, {p.relative_to(self.root): p.read_bytes() for p in self.root.rglob("*.json")})

    def test_missing_distribution_cross_check_blocks_partial_data(self):
        self.run_day(); q = self.quotes("2026-10-20"); q["FEQT"][F.START]["adjusted_close"] = 99.
        with self.assertRaisesRegex(ValueError, "does not reconcile"): self.run_day("2026-10-20", q)

    def test_vendor_revisions_never_rewrite_accepted_returns(self):
        self.run_day(); q = self.quotes("2026-10-20"); q["FEQT"][F.START].update(close=99., adjusted_close=99.)
        with self.assertRaisesRegex(ValueError, "Previously accepted"): self.run_day("2026-10-20", q)
        self.assertEqual(len(F.load_state(self.root)[1]), 1)

    def test_new_month_launches_separately_without_replaying_october(self):
        first = self.run_day(); archive = self.root / "data/fnb-performance/days/2026-10-19.json"; frozen = archive.read_bytes()
        d = F.read(self.root / F.BASELINE); d["optimization"].update(month="2026-11", generated_at="2026-11-01T07:37:00-05:00")
        d["results"]["proposal"]["name"] = "SAVY Actions · 2026-11"; d["results"]["proposal"]["weights"] = {"FEQT": 1.}
        F.write(self.root / "data/fnb-history/2026-11.json", d)
        result = self.run_day("2026-11-02"); new = next(a for a in result["accounts"] if a["id"] == "proposal-2026-11")
        self.assertEqual(new["launch_date"], "2026-11-02"); self.assertEqual(new["history"], [{"date": "2026-11-02", "value": 10000.}])
        self.assertEqual(archive.read_bytes(), frozen); self.assertEqual(len(result["accounts"]), 17)
        self.assertEqual(first["accounts"][0]["weights"], result["accounts"][0]["weights"])

    def test_publications_after_close_and_holidays_wait_next_session(self):
        self.assertEqual(F.publication_launch("2026-11-02T17:00:00-05:00"), date(2026, 11, 3))
        self.assertEqual(F.publication_launch("2026-12-24T13:01:00-05:00"), date(2026, 12, 29))
        self.assertEqual(F.publication_launch("2026-11-02T07:37:00-05:00"), date(2026, 11, 2))
        self.assertFalse(F.trading_day(date(2026, 8, 3)))
        self.assertTrue(F.trading_day(date(2026, 9, 30)))

    def test_before_publication_buffer_uses_previous_session(self):
        self.assertEqual(F.completed_session(datetime.fromisoformat("2026-10-20T17:59:00-04:00")), date(2026, 10, 19))
        self.assertEqual(F.completed_session(datetime.fromisoformat("2026-10-20T18:00:00-04:00")), date(2026, 10, 20))

    def test_erased_registry_cannot_reset_investments(self):
        self.run_day(); (self.root / "data/fnb-performance/registry.json").unlink()
        with self.assertRaisesRegex(ValueError, "refusing to reset"): F.load_state(self.root)

    def test_changed_daily_record_or_definition_is_rejected(self):
        self.run_day(); registry, days = F.load_state(self.root)
        bad = copy.deepcopy(days); bad[0]["accounts"]["FEQT"]["value"] = 9999.
        with self.assertRaisesRegex(ValueError, "Changed daily"): F.validate(registry, bad)
        bad = copy.deepcopy(registry); bad["accounts"][0]["weights"]["FEQT"] += .01
        with self.assertRaisesRegex(ValueError, "Changed frozen"): F.validate(bad, days)

    def test_parser_undoes_future_splits_in_closes_and_distributions(self):
        stamp=lambda day:int(datetime.fromisoformat(day+"T13:30:00+00:00").timestamp())
        payload={"chart":{"result":[{"meta":{"symbol":"TEST.TO","currency":"CAD","instrumentType":"ETF","exchangeTimezoneName":"America/Toronto"},"timestamp":[stamp(d) for d in ["2026-10-19","2026-10-20","2026-10-21"]],"indicators":{"quote":[{"close":[50,49,49]}],"adjclose":[{"adjclose":[49.5,49,49]}]},"events":{"splits":{"x":{"date":stamp("2026-10-21"),"numerator":2,"denominator":1}},"dividends":{"x":{"date":stamp("2026-10-20"),"amount":.5}}}}]}}
        q=F.parse_prices(payload,"TEST.TO","2026-10-19","2026-10-21")
        self.assertEqual(q["2026-10-19"]["close"],100);self.assertEqual(q["2026-10-20"]["close"],98)
        self.assertEqual(q["2026-10-20"]["distribution"],1);self.assertEqual(q["2026-10-21"]["split"],2)
        payload["chart"]["result"][0]["meta"]["currency"]="USD"
        with self.assertRaisesRegex(ValueError,"identity"):F.parse_prices(payload,"TEST.TO",F.START,"2026-10-21")

    def test_dated_tmx_fallback_never_carries_an_old_quote_to_launch(self):
        class Client:
            def json(self, url, payload):
                return {"data": {"identity": {"symbol": "TEST", "currency": "CAD", "datatype": "etf"},
                    "raw": [{"datetime": "2026-10-16", "closePrice": 77.27}, {"datetime": "2026-10-19", "closePrice": 77.21}],
                    "adjusted": [{"datetime": "2026-10-16", "closePrice": 77.27}, {"datetime": "2026-10-19", "closePrice": 77.21}]}}
        fallback = F.tmx_closes(Client(), "TEST", "2026-10-16", "2026-10-19")
        ts = int(datetime.fromisoformat("2026-10-19T13:30:00+00:00").timestamp())
        payload = {"chart": {"result": [{"meta": {"symbol": "TEST.TO", "currency": "CAD", "instrumentType": "ETF", "exchangeTimezoneName": "America/Toronto"},
            "timestamp": [ts], "indicators": {"quote": [{"close": [None]}], "adjclose": [{"adjclose": [None]}]}}]}}
        q = F.parse_prices(payload, "TEST.TO", F.START, F.START, fallback)
        self.assertEqual(q[F.START]["close"], 77.21); self.assertEqual(q[F.START]["price_source"], "TMX Money")
        del fallback[F.START]
        self.assertEqual(F.parse_prices(payload, "TEST.TO", F.START, F.START, fallback), {})

    def test_tmx_fallback_uses_one_source_for_both_return_endpoints(self):
        stamp=lambda day:int(datetime.fromisoformat(day+"T13:30:00+00:00").timestamp())
        payload={"chart":{"result":[{"meta":{"symbol":"TEST.TO","currency":"CAD","instrumentType":"ETF","exchangeTimezoneName":"America/Toronto"},
            "timestamp":[stamp("2026-10-19"),stamp("2026-10-20")],"indicators":{"quote":[{"close":[77.27,None]}],"adjclose":[{"adjclose":[77.27,None]}]}}]}}
        class Client:
            def json(self,url): return payload
        official={day:{"close":price,"adjusted_close":price,"source_url":"https://money.tmx.com/en/quote/TEST"} for day,price in [("2026-10-19",77.21),("2026-10-20",77.08)]}
        cfg={"funds":{"TEST":{"quote_symbol":"TEST.TO"}}}
        with patch.object(F,"tmx_closes",return_value=official):
            q=F.collect(cfg,{"TEST"},"2026-10-19","2026-10-20",Client())["TEST"]
        self.assertEqual(q["2026-10-19"]["close"],77.21); self.assertEqual(q["2026-10-20"]["close"],77.08)
        self.assertEqual({p["price_source"] for p in q.values()},{"TMX Money"})
        # Even when Yahoo later populates both observations, keep the source of
        # the already accepted nominal anchor. No historical record is edited.
        payload["chart"]["result"][0]["indicators"]={"quote":[{"close":[77.27,77.10]}],"adjclose":[{"adjclose":[77.27,77.10]}]}
        with patch.object(F,"tmx_closes",return_value=official):
            q=F.collect(cfg,{"TEST"},"2026-10-19","2026-10-20",Client(),preferred_tmx={"TEST"})["TEST"]
        self.assertEqual(q["2026-10-19"]["close"],77.21); self.assertEqual(q["2026-10-20"]["close"],77.08)
        del official["2026-10-19"]
        with patch.object(F,"tmx_closes",return_value=official):
            with self.assertRaisesRegex(ValueError,"consistent TMX"): F.collect(cfg,{"TEST"},"2026-10-19","2026-10-20",Client(),preferred_tmx={"TEST"})

    def test_confirmed_cboe_revision_advances_without_rewriting_prior_session(self):
        self.run_day(); q=self.quotes("2026-10-20")
        symbol="FBAL.NE";stamp=lambda day:int(datetime.fromisoformat(day+"T13:30:00+00:00").timestamp())
        payload={"chart":{"result":[{"meta":{"symbol":symbol,"currency":"CAD","instrumentType":"ETF","exchangeTimezoneName":"America/Toronto"},
            "timestamp":[stamp(F.START),stamp("2026-10-20")],"indicators":{"quote":[{"close":[99.99,101.]}],"adjclose":[{"adjclose":[99.99,101.]}]}}]}}
        class Client:
            def json(self,url):return payload
        official={day:{"close":p,"adjusted_close":p,"source_url":"https://money.tmx.com/en/quote/FBAL%3ACC"} for day,p in [(F.START,99.99),("2026-10-20",101.)]}
        cfg={"funds":{"FBAL":{"quote_symbol":symbol}}}
        # A one-cent correction exceeds the accepted nominal tolerance at $15,
        # represented here by a 0.02 correction at the fixture's $100 price.
        for source in [payload["chart"]["result"][0]["indicators"]["quote"][0]["close"],payload["chart"]["result"][0]["indicators"]["adjclose"][0]["adjclose"]]:source[0]=99.98
        official[F.START].update(close=99.98,adjusted_close=99.98)
        with patch.object(F,"tmx_closes",return_value=official) as fallback:
            collected=F.collect(cfg,{"FBAL"},F.START,"2026-10-20",Client(),anchors={"FBAL":{"date":F.START,"close":100.}})["FBAL"]
        self.assertEqual(fallback.call_args.args[1],"FBAL:CC")
        # Apply this verified observation to the existing FEQT fixture account.
        q["FEQT"]=collected
        archive=self.root / "data/fnb-performance/days/2026-10-19.json";frozen=archive.read_bytes()
        result=self.run_day("2026-10-20",q)
        self.assertEqual(archive.read_bytes(),frozen)
        self.assertAlmostEqual(next(a for a in result["accounts"] if a["id"]=="FEQT")["history"][-1]["value"],10100.)
        _,days=F.load_state(self.root);self.assertEqual(days[-1]["prices"]["FEQT"]["previous_close_revision"]["accepted_close"],100.)
        self.assertEqual(days[0]["accounts"]["FEQT"]["units"],days[1]["accounts"]["FEQT"]["units"])
        # A disagreeing second source cannot authorize the correction.
        official["2026-10-20"]["close"]=102.
        with patch.object(F,"tmx_closes",return_value=official):
            with self.assertRaisesRegex(ValueError,"Unconfirmed"):F.collect(cfg,{"FBAL"},F.START,"2026-10-20",Client(),anchors={"FBAL":{"date":F.START,"close":100.}})

    def test_confirmed_revision_with_late_yahoo_session_uses_one_official_history(self):
        self.run_day(); q=self.quotes("2026-10-20")
        symbol="FEQT.NE";stamp=int(datetime.fromisoformat(F.START+"T13:30:00+00:00").timestamp())
        payload={"chart":{"result":[{"meta":{"symbol":symbol,"currency":"CAD","instrumentType":"ETF","exchangeTimezoneName":"America/Toronto"},
            "timestamp":[stamp],"indicators":{"quote":[{"close":[99.98]}],"adjclose":[{"adjclose":[99.98]}]}}]}}
        class Client:
            def json(self,url):return payload
        official={day:{"close":price,"adjusted_close":price,"source_url":"https://money.tmx.com/en/quote/FEQT%3ACC"}
                  for day,price in [(F.START,99.98),("2026-10-20",101.)]}
        cfg={"funds":{"FEQT":{"quote_symbol":symbol}}}
        with patch.object(F,"tmx_closes",return_value=official):
            q["FEQT"]=F.collect(cfg,{"FEQT"},F.START,"2026-10-20",Client(),anchors={"FEQT":{"date":F.START,"close":100.}})["FEQT"]
        revision=q["FEQT"][F.START]["verified_revision"]
        self.assertFalse(revision["yahoo_next_close_available"])
        self.assertIsNone(revision["evidence"][0]["next_close"])
        archive=self.root / "data/fnb-performance/days/2026-10-19.json";frozen=archive.read_bytes()
        self.run_day("2026-10-20",q)
        _,days=F.load_state(self.root)
        self.assertEqual(archive.read_bytes(),frozen)
        self.assertEqual(days[0]["accounts"]["FEQT"]["units"],days[1]["accounts"]["FEQT"]["units"])
        self.assertAlmostEqual(days[1]["accounts"]["FEQT"]["value"],10100.)
        self.assertEqual(days[1]["prices"]["FEQT"]["previous_close_revision"]["revised_close"],99.98)
        # Missing a historical confirmation or the official next endpoint still blocks.
        official[F.START]["close"]=99.97
        with patch.object(F,"tmx_closes",return_value=official):
            with self.assertRaisesRegex(ValueError,"Unconfirmed"):F.collect(cfg,{"FEQT"},F.START,"2026-10-20",Client(),anchors={"FEQT":{"date":F.START,"close":100.}})
        official[F.START]["close"]=99.98;official.pop("2026-10-20")
        with patch.object(F,"tmx_closes",return_value=official):
            with self.assertRaisesRegex(ValueError,"consistent TMX"):F.collect(cfg,{"FEQT"},F.START,"2026-10-20",Client(),anchors={"FEQT":{"date":F.START,"close":100.}})

    def test_fallback_recovers_a_whole_missing_yahoo_session(self):
        symbol="TEST.TO";stamp=int(datetime.fromisoformat(F.START+"T13:30:00+00:00").timestamp())
        payload={"chart":{"result":[{"meta":{"symbol":symbol,"currency":"CAD","instrumentType":"ETF","exchangeTimezoneName":"America/Toronto"},
            "timestamp":[stamp],"indicators":{"quote":[{"close":[100.]}],"adjclose":[{"adjclose":[100.]}]}}]}}
        official={"2026-10-20":{"close":101.,"adjusted_close":101.,"source_url":"https://money.tmx.com/en/quote/TEST"}}
        parsed=F.parse_prices(payload,symbol,F.START,"2026-10-20",official)
        self.assertEqual(parsed["2026-10-20"]["close"],101.)


if __name__ == "__main__": unittest.main()
