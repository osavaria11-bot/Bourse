import copy
import json
import unittest
from scripts.collect_frontier_universe import build
from scripts.fnb_sources import bmo

class FrontierSourcesTests(unittest.TestCase):
    def fixture(self):
        base={"dates":["2026-08","2026-09"],"assumptions":{"as_of":"2026-09-30"}}
        spec={"name":"Test Equity","description":"Actions","source_url":"https://issuer.example/test",
              "max_weight":.35,"currency":"CAD","exchange":"TSX"}
        data={"returns":{"2026-08":.01,"2026-09":.02},"assets":{"equity":.999,"bond":0,"gold":0,"crypto":0},
              "geo":[1,0,0,0,0],"sector":[1]+[0]*11,"mer":.001,"source_url":spec["source_url"],
              "dates":{"prices":"2026-09-30","holdings":"2026-09-30","sectors":"2026-09-30"},"return_method":"Official total returns"}
        return base,{"funds":{"TEST":spec}},{"TEST":data}

    def test_common_months_and_source_dates_preserved(self):
        base,cfg,sources=self.fixture();before=copy.deepcopy(sources)
        out=build(base,cfg,sources,"2026-10-20")
        self.assertEqual(out["funds"]["TEST"]["returns"],[.01,.02])
        self.assertEqual(out["funds"]["TEST"]["source_dates"],sources["TEST"]["dates"])
        self.assertEqual(sources,before)

    def test_missing_month_and_non_equity_never_substituted(self):
        base,cfg,sources=self.fixture();del sources["TEST"]["returns"]["2026-08"]
        with self.assertRaises(ValueError):build(base,cfg,sources,"2026-10-20")
        base,cfg,sources=self.fixture();sources["TEST"]["assets"]["crypto"]=.01
        with self.assertRaises(ValueError):build(base,cfg,sources,"2026-10-20")

    def test_bmo_zero_value_rights_count_but_no_exposure(self):
        class Client:
            def get(self,url):
                data=[{"name":"BMO Test","isCurrent":True,"data":[[1788134400000,100],[1790726400000,101]]}]
                return '<script type="text/json">'+json.dumps(data)+'</script>'
            def json(self,url,payload):
                return {"data":{"portfolios":[{"entityId":"TEST","effectiveDate":"2026-10-19",
                    "numberOfEquityPositions":2,"kb2Holdings":[
                        {"holding":"Stock","allocation":1.,"assetClass":"Equity","country":"United States","sector":"INFORMATION TECHNOLOGY","baseMarketValue":100},
                        {"holding":"Corporate action right","allocation":0.,"assetClass":"Equity","country":"United States","sector":None,"baseMarketValue":None}]}]}}
        spec={"mer":.001,"source_url":"https://issuer.example","provider":"bmo"}
        result=bmo(Client(),"TEST",spec,"2026-09")
        self.assertEqual(result["assets"]["equity"],1.)
        self.assertEqual(result["holdings"]["positions"],[["Stock",1.]])

if __name__=="__main__":
    unittest.main()
