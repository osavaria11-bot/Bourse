import copy
from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from scripts import collect_market_breadth as B

class BreadthTests(unittest.TestCase):
    def test_counts_are_equal_weighted_and_use_each_stocks_own_sma(self):
        from datetime import date,timedelta
        dates=[(date(2025,1,1)+timedelta(days=i)).isoformat() for i in range(220)]
        holdings=[{'symbol':'A'},{'symbol':'B'}]
        histories={'A':list(zip(dates,range(1,221))),'B':list(zip(dates,range(220,0,-1)))}
        rows=B.breadth_history(holdings,histories,dates[-1],dates[-1]);last=rows[-1]
        self.assertEqual(last['values'],{str(w):50. for w in B.WINDOWS})
        self.assertEqual(last['eligible'],{str(w):2 for w in B.WINDOWS})
        self.assertEqual(last['above'],{str(w):1 for w in B.WINDOWS})
        self.assertIsNone(next(r for r in rows if r['date']==dates[100])['values']['200'])

    def test_insufficient_coverage_is_missing_not_zero(self):
        from datetime import date,timedelta
        dates=[(date(2025,1,1)+timedelta(days=i)).isoformat() for i in range(220)]
        rows=B.breadth_history([{'symbol':str(i)} for i in range(10)],{'0':list(zip(dates,range(1,221)))},dates[-1],dates[-1])
        self.assertTrue(all(v is None for v in rows[-1]['values'].values()))
        self.assertEqual(rows[-1]['eligible']['200'],1)

    def test_missing_close_resets_sma_window_and_equality_does_not_count_above(self):
        from datetime import date,timedelta
        dates=[(date(2025,1,1)+timedelta(days=i)).isoformat() for i in range(221)]
        series=list(zip(dates,[10.]*221));series[-10]=(dates[-10],None)
        rows=B.breadth_history([{'symbol':'A'}],{'A':series},dates[-1],dates[-1])
        self.assertTrue(all(v is None for v in rows[-1]['values'].values()))
        first=next(r for r in rows if r['eligible']['200']);self.assertEqual(first['values']['200'],0.)
        flat=B.breadth_history([{'symbol':'A'}],{'A':list(zip(dates,[.1]*len(dates)))},dates[-1],dates[-1]);self.assertEqual(flat[-1]['values']['200'],0.)

    def test_exchange_mapping_handles_share_classes_and_adr_listings(self):
        self.assertEqual(B.yahoo_symbol({'Ticker':'BRK.B','Location':'United States'}),'BRK-B')
        self.assertEqual(B.yahoo_symbol({'Ticker':'700','Location':'China','Exchange':'Hong Kong Exchanges And Clearing Ltd'}),'0700.HK')
        self.assertEqual(B.yahoo_symbol({'Ticker':'BABA','Location':'China','Exchange':'New York Stock Exchange Inc.'}),'BABA')
        self.assertEqual(B.yahoo_symbol({'Ticker':'BT.A','Location':'United Kingdom'}),'BT-A.L')
        self.assertEqual(B.yahoo_symbol({'Ticker':'005930','Location':'Korea (South)','Exchange':'Korea Exchange (Stock Market)'}),'005930.KS')
        self.assertEqual(B.yahoo_symbol({'Ticker':'DELTA.R','Location':'Thailand'}),'DELTA-R.BK')
        self.assertEqual(B.yahoo_symbol({'Ticker':'ASELS.E','Location':'Turkey'}),'ASELS.IS')
        self.assertEqual(B.yahoo_symbol({'Ticker':'NU','Location':'Brazil','Exchange':'NYSE'}),'NU')
        self.assertIsNone(B.yahoo_symbol({'Ticker':'-','Location':'Canada'}))

    def test_local_holiday_carries_indicator_not_prices_and_expires_after_three_days(self):
        from datetime import date,timedelta
        dates=[];day=date(2025,12,1)
        while day<=date(2026,10,26):
            if day.weekday()<5:dates.append(day.isoformat())
            day+=timedelta(days=1)
        bdates=[d for d in dates if d<='2026-10-22']
        histories={'A':list(zip(dates,range(1,len(dates)+1))),'B':list(zip(bdates,range(1,len(bdates)+1)))}
        rows=B.breadth_history([{'symbol':'A'},{'symbol':'B'}],histories,dates[-1],dates[-1])
        friday=next(r for r in rows if r['date']=='2026-10-23')
        self.assertEqual(friday['eligible']['200'],2);self.assertEqual(friday['lagged']['200'],1)
        self.assertEqual(rows[-1]['eligible']['200'],1);self.assertIsNone(rows[-1]['values']['200'])
        histories['B']=histories['B'][-19:]
        rows=B.breadth_history([{'symbol':'A'},{'symbol':'B'}],histories,dates[-1],dates[-1])
        friday=next(r for r in rows if r['date']=='2026-10-23')
        self.assertEqual(friday['eligible']['20'],1)

    def test_holdings_are_dated_and_equities_only_and_do_not_use_nav_weights_for_counts(self):
        csv='Fund Holdings as of,"Oct 22, 2026"\n\nTicker,Name,Asset Class,Market Value,Location,Exchange,Market Currency\nA,Alpha,Equity,100,United States,NASDAQ,USD\nUSD,Dollars,Cash,99,United States,-,USD\nB,Beta,Equity,1,United States,NASDAQ,USD\n'
        dated,rows=B.parse_holdings(csv,2);self.assertEqual(dated,'2026-10-22');self.assertEqual(len(rows),2)
        with self.assertRaises(ValueError):B.parse_holdings('<html>not csv</html>',1)
        with self.assertRaises(ValueError):B.parse_holdings(csv,500)

    def test_malaysia_codes_require_exact_local_equity_identity(self):
        good={'symbol':'1295.KL','exchange':'KLS','quoteType':'EQUITY','shortname':'PBBANK'}
        with patch.object(B,'fetch',return_value=json.dumps({'quotes':[good]})):
            self.assertEqual(B.resolve_malaysia_symbol({'ticker':'PBBANK'}),'1295.KL')
        for bad in [{**good,'exchange':'NYQ'},{**good,'shortname':'OTHER'},{**good,'quoteType':'ETF'}]:
            with patch.object(B,'fetch',return_value=json.dumps({'quotes':[bad]})):
                self.assertIsNone(B.resolve_malaysia_symbol({'ticker':'PBBANK'}))

    def test_adjusted_cache_bridge_rescales_older_closes_and_does_not_mix_split_bases(self):
        old=[(f'2026-10-{i:02d}',100.+i) for i in range(1,11)]
        recent=[(d,p/2) for d,p in old[4:]]+[('2026-10-11',56.)]
        result=B.merge_adjusted(old,recent)
        self.assertEqual(result[0],('2026-10-01',50.5));self.assertEqual(result[-1],('2026-10-11',56.))
        self.assertEqual(len(result),11)
        with self.assertRaises(ValueError):B.merge_adjusted(old,recent[-2:])

    def test_quote_identity_and_completed_date_are_checked(self):
        payload={'chart':{'result':[{'meta':{'symbol':'A','exchangeTimezoneName':'America/Toronto'},'timestamp':[datetime(2026,10,20,20,tzinfo=timezone.utc).timestamp(),datetime(2026,10,21,20,tzinfo=timezone.utc).timestamp()],'indicators':{'adjclose':[{'adjclose':[10.,11.]}]}}]}}
        points=B.parse_prices(payload,'A','2026-10-20',1);self.assertEqual(points,[('2026-10-20',10.)])
        with self.assertRaises(ValueError):B.parse_prices(payload,'B','2026-10-20',1)

if __name__=='__main__':unittest.main()
