from copy import deepcopy
from datetime import datetime, timezone
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import refresh_forward_internal as R


def fixture(identity='TEST'):
    snapshot = {'date': '2026-11-02', 'observed_at': '2026-11-02T14:00:00+00:00',
        'consensus_date': '2026-11-02', 'consensus_observed_at': '2026-11-02T14:00:00+00:00',
        'source_url': 'https://www.marketscreener.com/quote/stock/TEST-123/valuation/',
        'currency': 'USD', 'price': 100, 'price_date': '2026-10-30', 'fiscal_month': 12,
        'market_cap_millions': 1000, 'enterprise_value_millions': 1100, 'complete_session': False,
        'forecasts': [{'period_end': '2026-12-31', 'eps': 5, 'ebitda_millions': 100},
                      {'period_end': '2027-12-31', 'eps': 8, 'ebitda_millions': 150}]}
    stock = {'id': identity, 'title': identity, 'type': 'stock', 'symbol': identity,
             'financial': False, 'latest': deepcopy(snapshot), 'current_snapshot': deepcopy(snapshot),
             'observations': [deepcopy(snapshot)], 'pe_history': {'rows': [{'date': '2026-10-28', 'fy1': 30, 'fy2': 20}]}}
    close = {'id': identity, 'value': 100, 'date': '2026-10-30', 'currency': 'USD', 'quote_symbol': identity,
             'source_url': 'https://finance.yahoo.com/quote/' + identity + '/'}
    dashboard = {'schema_version': 1, 'kind': 'savy_forward_dashboard', 'instruments': [stock]}
    prices = {'kind': 'security_prices', 'generated_at': '2026-11-02T13:00:00+00:00', 'series': [close]}
    config = {'instruments': [{'id': identity, 'symbol': identity}]}
    return dashboard, prices, config


class RefreshTest(unittest.TestCase):
    now = datetime(2026, 11, 2, 15, tzinfo=timezone.utc)

    def test_same_day_is_idempotent_and_never_calls_provider(self):
        data, prices, config = fixture()
        def no_fetch(_):
            self.fail('Duplicate provider request')
        first = R.refresh(data, prices, config, self.now, fetcher=no_fetch)
        second = R.refresh(first, prices, config, self.now, fetcher=no_fetch)
        self.assertEqual(first, second)
        self.assertEqual(second['refresh']['counts']['reused'], 1)
        self.assertEqual(len(second['instruments'][0]['refresh_history']), 1)

    def test_morning_observations_do_not_overwrite_old_histories_or_close_date(self):
        data, prices, config = fixture()
        result = R.refresh(data, prices, config, self.now)
        stock = result['instruments'][0]
        self.assertEqual(stock['observations'], data['instruments'][0]['observations'])
        self.assertEqual(stock['pe_history'], data['instruments'][0]['pe_history'])
        self.assertEqual(stock['current_snapshot']['price_date'], '2026-10-30')
        self.assertFalse(stock['refresh_history'][0]['complete_session'])
        self.assertFalse(result['refresh']['historical_quartiles_refreshed'])

    def test_old_prior_consensus_does_not_prevent_fresh_collection(self):
        data, prices, config = fixture()
        old = data['instruments'][0]['current_snapshot']
        old.update(date='2026-10-20', consensus_date='2026-10-20')
        fresh = deepcopy(old)
        fresh.update(date='2026-11-02', consensus_date='2026-11-02')
        with patch.object(R, 'source_snapshot', return_value=fresh) as provider:
            result = R.refresh(data, prices, config, self.now)
        self.assertEqual(provider.call_count, 1)
        self.assertEqual(result['refresh']['counts']['collected'], 1)

    def test_failed_source_keeps_consensus_date_and_flags_cache(self):
        data, prices, config = fixture()
        data['instruments'][0]['current_snapshot']['consensus_date'] = '2026-10-29'
        result = R.refresh(data, prices, config, self.now, fetcher=lambda _: (_ for _ in ()).throw(ValueError('source offline')))
        stock = result['instruments'][0]
        self.assertEqual(stock['current_status']['status'], 'cached')
        self.assertEqual(stock['current_snapshot']['consensus_date'], '2026-10-29')
        self.assertIn('source offline', stock['current_status']['error'])

    def test_refusal_stops_subsequent_provider_calls(self):
        data, prices, config = fixture('ONE')
        d2, p2, c2 = fixture('TWO')
        data['instruments'] += d2['instruments']; prices['series'] += p2['series']; config['instruments'] += c2['instruments']
        for stock in data['instruments']:
            stock['current_snapshot']['consensus_date'] = '2026-10-29'
        calls = []
        def refused(url):
            calls.append(url)
            raise HTTPError(url, 403, 'Forbidden', {}, io.BytesIO())
        result = R.refresh(data, prices, config, self.now, fetcher=refused, workers=1)
        self.assertEqual(len(calls), 1)
        self.assertTrue(result['refresh']['source_refused'])
        self.assertEqual(result['refresh']['counts']['cached'], 2)
        again = R.refresh(result, prices, config, self.now, fetcher=refused, workers=1)
        self.assertEqual(len(calls), 1)
        self.assertTrue(again['refresh']['source_refused'])

    def test_time_budget_and_html_challenge_stop_requests(self):
        data, prices, config = fixture()
        data['instruments'][0]['current_snapshot']['consensus_date'] = '2026-10-29'
        calls = []
        result = R.refresh(data, prices, config, self.now, budget_seconds=0, fetcher=lambda url: calls.append(url))
        self.assertEqual(calls, [])
        self.assertEqual(result['refresh']['counts']['cached'], 1)
        challenged = R.refresh(data, prices, config, self.now, fetcher=lambda _: '<html><title>Just a moment</title>Verify you are human</html>')
        self.assertTrue(challenged['refresh']['source_refused'])
        self.assertEqual(challenged['refresh']['counts']['cached'], 1)

    def test_incompatible_currency_or_split_does_not_replace_last_good_input(self):
        for wrong in [{'currency': 'CAD'}, {'quote_symbol': 'CDR'}, {'value': 1}, {'date': '2026-11-03'}]:
            data, prices, config = fixture()
            prices['series'][0].update(wrong)
            result = R.refresh(data, prices, config, self.now)
            self.assertEqual(result['instruments'][0]['current_snapshot'], data['instruments'][0]['current_snapshot'])
            self.assertEqual(result['refresh']['counts']['retained'], 1)

    def test_new_price_with_cached_consensus_preserves_ev_bridge(self):
        data, prices, config = fixture()
        snapshot = data['instruments'][0]['current_snapshot']
        close = {**prices['series'][0], 'value': 110}
        repriced = R.revalue(snapshot, close, config['instruments'][0], self.now)
        self.assertAlmostEqual(repriced['market_cap_millions'], 1100)
        self.assertAlmostEqual(repriced['enterprise_value_millions'], 1200)
        self.assertEqual(snapshot['price'], 100)

    def test_ev_withheld_and_banks_stay_unavailable(self):
        for financial in [True, False]:
            data, prices, config = fixture()
            stock = data['instruments'][0]
            stock['financial'] = financial
            if not financial:
                stock['ev_quality'] = {'status': 'withheld'}
            result = R.refresh(data, prices, config, self.now)
            self.assertIsNone(result['instruments'][0]['current_snapshot']['enterprise_value_millions'])

    def test_older_price_archive_is_rejected_without_downgrade(self):
        data, prices, config = fixture()
        prices['series'][0]['date'] = '2026-10-29'
        result = R.refresh(data, prices, config, self.now)
        self.assertEqual(result['instruments'][0]['current_snapshot'], data['instruments'][0]['current_snapshot'])
        self.assertEqual(result['refresh']['counts']['retained'], 1)


if __name__ == '__main__':
    unittest.main()
