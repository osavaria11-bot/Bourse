from datetime import date, timedelta
import math
import unittest
from scripts import collect_fnb_daily_risk as R

class DailyRiskTests(unittest.TestCase):
    def test_empirical_one_session_tail_and_bias_corrected_shape(self):
        self.assertAlmostEqual(R.historical_var([-.01,-.02,-.03,.02]),.03)
        symmetric=R.distribution_shape([-.03,-.01,.01,.03])
        self.assertAlmostEqual(symmetric['skewness'],0.)
        self.assertAlmostEqual(symmetric['excess_kurtosis'],-1.2)
        asymmetric=R.distribution_shape([0.,0.,0.,1.])
        self.assertAlmostEqual(asymmetric['skewness'],2.)
        self.assertAlmostEqual(asymmetric['excess_kurtosis'],4.)
        self.assertIsNone(R.distribution_shape([.01]*300)['skewness'])
        with self.assertRaises(ValueError):R.historical_var([.01,float('nan')])

    def sample(self):
        day=date(2023,12,29);dates=[]
        while day<=date(2025,12,31):
            if R.F.trading_day(day):dates.append(day.isoformat())
            day+=timedelta(days=1)
        analysis={'dates':['2024-01'],'order':['p'],'results':{'p':{'weights':{'X':1.}}}}
        prices={'X':{d:{'adjusted_close':100*1.001**i,'source_url':'https://finance.yahoo.com/quote/X/history/'} for i,d in enumerate(dates)}}
        return analysis,prices,dates

    def test_missing_close_drops_both_affected_sessions_instead_of_creating_a_two_day_return(self):
        analysis,prices,dates=self.sample();del prices['X'][dates[40]]
        result=R.validate(R.build(analysis,prices,dates[-1],'test'))
        self.assertEqual(result['missing_sessions'],dates[40:42])
        self.assertEqual(result['observations'],len(dates)-3)
        self.assertAlmostEqual(result['results']['p']['var95'],-.001)
        self.assertIsNone(result['results']['p']['skewness'])

    def test_issuer_returns_are_used_for_the_whole_fund_without_manufacturing_prices(self):
        analysis,prices,dates=self.sample();analysis['results']['p']['weights']={'FEQT':1.}
        returns={'FEQT':{d:.001 for d in dates[1:]}}
        result=R.build(analysis,{},dates[-1],'test',returns)
        self.assertAlmostEqual(result['results']['p']['var95'],-.001)
        self.assertEqual(result['return_basis']['FEQT'],'issuer_nav_total_return')

    def test_suspect_split_moves_and_insufficient_daily_samples_are_rejected(self):
        analysis,prices,dates=self.sample();prices['X'][dates[40]]['adjusted_close']*=6
        with self.assertRaisesRegex(ValueError,'Suspicious'):R.build(analysis,prices,dates[-1],'test')
        with self.assertRaisesRegex(ValueError,'Insufficient'):R.build(analysis,{},dates[-1],'test')

if __name__=='__main__':unittest.main()
