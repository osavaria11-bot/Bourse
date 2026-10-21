import copy
from datetime import datetime
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT / "scripts"))
import daily_fnb as F
import common_fnb as C


class CommonStart(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        for name in [F.BASELINE,"data/fnb-model.json"]:
            target=self.root / name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT / name,target)
        self.registry=F.register(self.root,{"schema_version":1,"accounts":[]})
        self.dates=["2026-10-19","2026-10-20","2026-10-21"]
        self.quotes={t:{d:{"close":100.+i,"adjusted_close":100.+i,"distribution":0.,"split":1.,"source_url":"https://example.test","symbol":t} for i,d in enumerate(self.dates)} for a in self.registry["accounts"] for t in a["weights"]}
        F.run(self.root,datetime.fromisoformat("2026-10-20T18:37:00-04:00"),self.quotes)

    def tearDown(self):self.temp.cleanup()

    def test_later_portfolio_joins_same_dates_without_editing_its_real_launch(self):
        registry,days=F.load_state(self.root);frozen={p.name:p.read_bytes() for p in (self.root / "data/fnb-performance/days").glob('*.json')}
        later=F.definition("future",{"weights":{"FEQT":1.},"name":"Nouveau","color":"#fff"},"2026-11-02","fixture",published="2026-11-01T09:00:00-05:00")
        registry["accounts"].append(later);F.write(self.root / "data/fnb-performance/registry.json",registry)
        result=C.run(self.root,datetime.fromisoformat("2026-11-01T09:00:00-05:00"),self.quotes)
        a=next(a for a in result["accounts"] if a["id"]=="future")
        self.assertEqual(a["launch_date"],F.START);self.assertEqual(a["actual_launch_date"],"2026-11-02");self.assertEqual(a["series_type"],"simulation")
        self.assertEqual(a["history"],[{"date":"2026-10-19","value":10000.},{"date":"2026-10-20","value":10100.}])
        self.assertEqual(F.load_state(self.root)[0]["accounts"][-1],later)
        self.assertEqual(frozen,{p.name:p.read_bytes() for p in (self.root / "data/fnb-performance/days").glob('*.json')})

    def test_existing_values_match_the_accepted_ledger_and_refresh_is_idempotent(self):
        now=datetime.fromisoformat("2026-10-20T19:00:00-04:00");result=C.run(self.root,now,self.quotes)
        live=F.read(self.root / "data/fnb-performance.json")
        for a in live["accounts"]:self.assertEqual(a["history"],next(q for q in result["accounts"] if q["id"]==a["id"])["history"])
        again=C.run(self.root,datetime.fromisoformat("2026-10-20T21:00:00-04:00"),self.quotes);self.assertEqual(result,again)

    def test_robust_supplemental_prices_and_dividend_split_are_used_once(self):
        registry,days=F.load_state(self.root)
        a=F.definition("new",{"weights":{"NEW":1.},"color":"#fff"},"2026-10-21","fixture")
        registry["accounts"].append(a)
        cfg=F.read(self.root / "data/fnb-model.json");cfg["funds"]["NEW"]={"name":"Fixture"};F.write(self.root / "data/fnb-model.json",cfg)
        q={"NEW":{"2026-10-19":{"close":100.,"adjusted_close":50.,"split":1.,"distribution":0.},"2026-10-20":{"close":50.,"adjusted_close":51.,"split":2.,"distribution":1.}}}
        snapshot,cache,errors=C.build(self.root,registry,days,C.cached_prices(self.root),"now",q)
        self.assertFalse(errors);self.assertAlmostEqual(snapshot["accounts"][-1]["history"][-1]["value"],10200.)
        replay,_,_=C.build(self.root,registry,days,cache,"now");self.assertEqual(snapshot,replay)
        bad=copy.deepcopy(q);bad["NEW"]["2026-10-19"]["adjusted_close"]=100.
        missing,_,errors=C.build(self.root,registry,days,C.cached_prices(self.root),"now",bad)
        self.assertTrue(errors);self.assertEqual(missing["accounts"][-1]["history"],[])

    def test_missing_pre_inception_prices_never_fabricate_a_common_start(self):
        registry,days=F.load_state(self.root);registry["accounts"].append(F.definition("late",{"weights":{"NEW":1.},"color":"#fff"},"2026-11-02","fixture"))
        result,_,_=C.build(self.root,registry,days,C.cached_prices(self.root),"now",sources={"NEW":{}})
        late=result["accounts"][-1];self.assertEqual(late["history"],[]);self.assertEqual(late["status"],"unavailable");self.assertIn("NEW",late["unavailable_reason"])
        self.assertTrue(all(a["history"] for a in result["accounts"][:-1]))
