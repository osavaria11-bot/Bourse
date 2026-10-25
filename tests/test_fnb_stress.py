from datetime import datetime
import copy
import unittest
from zoneinfo import ZoneInfo
from scripts import collect_fnb_stress as S


class StressSourceTests(unittest.TestCase):
    def payload(self, currency='CAD', instrument='ETF', symbol='X.TO', timezone='America/Toronto'):
        stamps = [int(datetime(2020, 2, day, 9, 30, tzinfo=ZoneInfo(timezone)).timestamp()) for day in [19,20,21]]
        return {'chart': {'result': [{'meta': {'symbol':symbol, 'currency':currency, 'instrumentType':instrument,
                     'exchangeTimezoneName':timezone}, 'timestamp':stamps,
                     'indicators': {'quote':[{'close':[100.,90.,95.]}], 'adjclose':[{'adjclose':[100.,90.,95.]}]}}]}}

    def test_exact_endpoints_never_invent_an_earlier_inception(self):
        h=S.parse_history(self.payload(),'X.TO','CAD')
        self.assertAlmostEqual(S.period_return(h,'2020-02-19','2020-02-21'),-.05)
        self.assertIsNone(S.period_return(h,'2008-01-01','2020-02-21'))
        self.assertIsNone(S.period_return(h,'2020-02-18','2020-02-21'))

    def test_london_midnight_fx_is_labeled_by_its_local_session_not_the_prior_utc_date(self):
        p=self.payload(instrument='CURRENCY',symbol='CAD=X',timezone='Europe/London')
        p['chart']['result'][0]['timestamp']=[int(datetime(2024,7,d,0,0,tzinfo=ZoneInfo('Europe/London')).timestamp()) for d in [29,30,31]]
        h=S.parse_history(p,'CAD=X','CAD','CURRENCY')
        self.assertIn('2024-07-31',h)
        self.assertNotIn('2024-07-28',h)

    def test_source_identity_adjustments_and_extreme_price_checks(self):
        p=self.payload()
        with self.assertRaises(ValueError):S.parse_history(p,'WRONG','CAD')
        with self.assertRaises(ValueError):S.parse_history(p,'X.TO','USD')
        invalid=copy.deepcopy(p);invalid['chart']['result'][0]['indicators'].pop('adjclose')
        with self.assertRaises(ValueError):S.parse_history(invalid,'X.TO','CAD')
        invalid=copy.deepcopy(p);invalid['chart']['result'][0]['indicators']['adjclose'][0]['adjclose'][1]=10
        with self.assertRaisesRegex(ValueError,'Suspicious'):S.parse_history(invalid,'X.TO','CAD')
        h=S.parse_history(invalid,'X.TO','CAD',quarantine=True)
        self.assertIsNone(S.period_return(h,'2020-02-19','2020-02-21'))
        # A bad unrelated old interval must not contaminate every later crisis.
        h.update({'2022-01-03':100,'2022-12-30':88})
        self.assertAlmostEqual(S.period_return(h,'2022-01-03','2022-12-30'),-.12)

    def test_schema_rejects_non_cad_and_non_total_return_stress_rows(self):
        analysis={'universe':{'dates':['2024-01'],'geo':{'VEQT':[.5,.3,.15,.05]}}}
        h={'US':{'2007-12-31':100,'2008-12-31':60},'CA':{'2007-12-31':100,'2008-12-31':70},
           'DEV':{'2007-12-31':100,'2008-12-31':55},'EM':{'2007-12-31':100,'2008-12-31':50}}
        d=S.validate(S.build(analysis,h,'2026-10-23',{k:'https://example.org/'+k for k in h}))
        self.assertAlmostEqual(d['scenarios']['gfc2008']['factor_shocks']['market'],.5*(-.4)+.3*(-.3)+.15*(-.45)+.05*(-.5))
        bad=copy.deepcopy(d);bad['scenarios']['gfc2008']['assets']['US']['currency']='USD'
        with self.assertRaises(ValueError):S.validate(bad)
        bad=copy.deepcopy(d);bad['scenarios']['gfc2008']['assets']['US']['total_return']=False
        with self.assertRaises(ValueError):S.validate(bad)
        self.assertEqual(d['indices'],{})
        self.assertEqual(d['reconstructions'],{})


if __name__=='__main__':unittest.main()
