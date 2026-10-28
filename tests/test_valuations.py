import copy
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("collect_valuations", ROOT / "scripts/collect_valuations.py")
C = importlib.util.module_from_spec(spec)
spec.loader.exec_module(C)
NOW = datetime(2026, 10, 28, 22, tzinfo=timezone.utc)
STOCK = {"id":"TEST", "symbol":"TEST", "title":"Synthetic Company", "type":"stock", "financial":False}
URL = C.HOST + "/quote/stock/SYNTHETIC-COMPANY-1234/valuation/"


def source():
    rows = {"Market Cap":[1000,1500,None,None], "Enterprise Value (EV)":[1200,1650,1600,1400],
        "EPS":[4,5,6,8], "P/E":[20,30,25,18.75], "EBITDA":[100,150,200,300],
        "Reference price":[80,150,150,150]}
    html = '<table id="valuationEnterpriseTable"><tr><th>Fiscal Period: December</th>'
    html += ''.join('<th>'+str(y)+'</th>' for y in [2025,2026,2027,2028])+'</tr>'
    for key, values in rows.items():
        unit = 'USD' if key in ['EPS','Reference price'] else 'USD in Million'
        html += '<tr><td>'+key+'<sup title="'+unit+'">1</sup></td>'
        for i,value in enumerate(values):
            estimate = key in ['EPS','EBITDA'] and i > 0
            html += '<td class="'+('table-child--bg-estimates' if estimate else '')+'" title="Number of financial analysts who provided an estimate: 12">'+(str(value) if value is not None else '-')+'</td>'
        html += '</tr>'
    return html+'</table><span title="EUR">An unrelated sidebar must not change the financial currency.</span>'


class ValuationTests(unittest.TestCase):
    def snapshot(self):
        return C.table_snapshot(source(), STOCK, URL, NOW)

    def test_eps_and_ev_use_same_source_units_and_current_ev(self):
        snap = self.snapshot()
        self.assertEqual(snap["currency"], "USD")
        self.assertEqual(snap["price"], 150)
        self.assertEqual(snap["enterprise_value_millions"], 1700)
        # Neither 1600 nor 1400 (projected future EV) is the current numerator.
        self.assertEqual(snap["ev_bridge_date"], "2025-12-31")
        self.assertEqual(snap["forecasts"][0]["eps_analysts"], 12)
        self.assertEqual(len(snap["forecasts"]), 3)

    def test_12_and_24_month_horizons_blend_denominators_before_dividing(self):
        snap = self.snapshot()
        w = 64/365
        result = C.ratios(snap)
        self.assertAlmostEqual(result['1']['pe'], 150/(5*w+6*(1-w)))
        self.assertAlmostEqual(result['2']['pe'], 150/(6*w+8*(1-w)))
        self.assertAlmostEqual(result['1']['ev_ebitda'], 1700/(150*w+200*(1-w)))
        self.assertAlmostEqual(result['2']['ev_ebitda'], 1700/(200*w+300*(1-w)))

    def test_no_extrapolation_when_year_three_is_missing(self):
        snap = self.snapshot()
        snap['forecasts'] = snap['forecasts'][:2]
        self.assertIsNotNone(C.ratios(snap)['1']['pe'])
        self.assertIsNone(C.ratios(snap)['2']['pe'])

    def test_negative_earnings_and_financial_company_ev_are_unavailable(self):
        snap = self.snapshot()
        for p in snap['forecasts']: p['eps'] = -1
        self.assertIsNone(C.ratios(snap)['1']['pe'])
        self.assertIsNone(C.ratios(snap, True)['1']['ev_ebitda'])

    def test_leap_day_blend_and_fiscal_rollover(self):
        snap = self.snapshot()
        snap['date'] = '2026-12-31'
        self.assertEqual(C.forward_denominator(snap,'eps',1),6)
        snap['date'] = '2027-01-01'
        self.assertAlmostEqual(C.forward_denominator(snap,'eps',1),6*364/365+8/365)

    def test_refuse_mixed_currency_or_adr_price(self):
        with self.assertRaises(C.SourceError):
            C.table_snapshot(source().replace('title="USD"','title="CAD"',1),STOCK,URL,NOW)
        with self.assertRaises(C.SourceError):
            C.table_snapshot(source().replace('<td class="" title="Number of financial analysts who provided an estimate: 12">30</td>','<td>3</td>'),STOCK,URL,NOW)

    def test_price_date_comes_from_source_never_from_download_clock(self):
        snap = self.snapshot()
        stamp = datetime(2026,10,27,11,tzinfo=timezone.utc).timestamp()*1000
        data = {'error':False,'data':[{'P/E (Estimate)':[[stamp,30]],'P/E (Released)':[], 'Synthetic Company':[[stamp,150]]},['marketscreener.com','x','USD']]}
        C.price_dates(data,snap,NOW)
        self.assertEqual(snap['date'],'2026-10-28')
        self.assertEqual(snap['price_date'],'2026-10-27')
        snap['price']=151
        C.price_dates(data,snap,NOW)
        self.assertIsNone(snap['price_date'])

    def test_daily_close_updates_price_and_market_cap_but_keeps_reported_debt(self):
        snap=self.snapshot()
        snap['price_date']='2026-10-27'
        stamp=int(datetime(2026,10,28,13,30,tzinfo=timezone.utc).timestamp())
        data={'chart':{'error':None,'result':[{'meta':{'symbol':'TEST','currency':'USD','exchangeTimezoneName':'America/New_York',
            'currentTradingPeriod':{'regular':{'start':stamp,'end':stamp+23400}}},'timestamp':[stamp],
            'indicators':{'quote':[{'close':[165]}]}}]}}
        C.reprice(data,snap,STOCK,NOW)
        self.assertEqual(snap['price'],165)
        self.assertEqual(snap['price_date'],'2026-10-28')
        self.assertAlmostEqual(snap['market_cap_millions'],1650)
        self.assertAlmostEqual(snap['enterprise_value_millions'],1850)
        self.assertEqual(snap['source_table_price'],150)
        wrong=copy.deepcopy(data);wrong['chart']['result'][0]['meta']['currency']='CAD'
        with self.assertRaises(C.SourceError): C.reprice(wrong,self.snapshot(),STOCK,NOW)
        unfinished=copy.deepcopy(data);unfinished['chart']['result'][0]['meta']['currentTradingPeriod']['regular']['end']=int(NOW.timestamp()+60)
        with self.assertRaises(C.SourceError): C.reprice(unfinished,self.snapshot(),STOCK,NOW)
        split=copy.deepcopy(data);split['chart']['result'][0]['events']={'splits':{'s':{'date':stamp}}}
        with self.assertRaises(C.SourceError): C.reprice(split,self.snapshot(),STOCK,NOW)

    def test_reported_net_debt_is_preferred_to_ev_bridge_with_repriced_market_cap(self):
        raw=source().replace('</table>','<tr><td>Net Debt</td><td>90</td><td>30</td><td>20</td><td>10</td></tr></table>')
        snap=C.table_snapshot(raw,STOCK,URL,NOW)
        self.assertEqual(snap['enterprise_value_millions'],1590)
        self.assertEqual(snap['ev_method'],'current_market_cap_plus_reported_net_debt')

    def test_prior_daily_consensus_is_not_recomputed_using_current_estimates(self):
        snap = self.snapshot()
        old = copy.deepcopy(snap); old['date']='2026-10-27'; old['observed_at']='2026-10-27T22:00:00+00:00'
        old['ratios']=C.ratios(old)
        previous={'observations':[old]}
        snap['forecasts'][0]['eps']=50
        result=C.preserve(previous,snap)
        self.assertEqual(result[0],old)
        self.assertEqual(previous['observations'],[old])
        with self.assertRaises(C.SourceError): C.preserve({'observations':[snap]},old)

    def test_source_failure_preserves_dated_observations(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)
            old={'id':'TEST','source_url':URL,'observations':[self.snapshot()]}
            C.write(path/'TEST.json',old)
            with patch.object(C,'fetch',side_effect=C.SourceError('Unavailable')):
                result=C.collect_one(STOCK,path,NOW)
            self.assertEqual(result['fetch_status'],'cached')
            self.assertEqual(result['latest'],old['observations'][-1])

    def test_repository_universe_has_no_funds_and_keeps_every_archived_screener_member(self):
        config=json.loads((ROOT/'data/valuation-universe.json').read_text())
        ids={i['id'] for i in config['instruments']}
        self.assertTrue({'NVDA','MU','AAPL','RY','WMG','FIX','SN'} <= ids)
        self.assertFalse({'FEQT','VFV','VBAL','MSFTCDR','SNDK'} & ids)
        self.assertTrue(all(i['type']=='stock' for i in config['instruments']))
        self.assertTrue(all(set(e['tickers']) <= ids for e in config['research_editions']))


if __name__ == '__main__': unittest.main()
