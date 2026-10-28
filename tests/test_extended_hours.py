import copy
import io
import json
import unittest
from datetime import datetime, timezone
from unittest.mock import patch
from scripts.extended_hours import extract
from scripts import collect_intraday_quotes as collector


def stamp(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()


DEFINITION = {'id': 'AAPL', 'quote_symbol': 'AAPL', 'currency': 'USD', 'title': 'Apple'}
NOW = datetime(2026, 10, 28, 13, 20, tzinfo=timezone.utc)


def fixture():
    regular = [{'start': stamp('2026-10-26T13:30:00Z'), 'end': stamp('2026-10-26T20:00:00Z')},
               {'start': stamp('2026-10-27T13:30:00Z'), 'end': stamp('2026-10-27T20:00:00Z')},
               {'start': stamp('2026-10-28T13:30:00Z'), 'end': stamp('2026-10-28T20:00:00Z')}]
    rows = [('2026-10-26T19:55:00Z', 80), ('2026-10-27T19:55:00Z', 100),
            ('2026-10-27T20:00:00Z', 101), ('2026-10-27T23:55:00Z', 103),
            ('2026-10-28T08:00:00Z', 102), ('2026-10-28T13:10:00Z', 104),
            ('2026-10-28T13:20:00Z', 999)]
    return {'chart': {'result': [{'meta': {'symbol': 'AAPL', 'currency': 'USD', 'hasPrePostMarketData': True,
        'exchangeTimezoneName': 'America/New_York', 'regularMarketPrice': 100, 'regularMarketTime': regular[1]['end'],
        'instrumentType': 'EQUITY', 'previousClose': 80, 'currentTradingPeriod': {'regular': regular[2]},
        'tradingPeriods': {'regular': [[p] for p in regular],
                          'pre': [[{'start': stamp('2026-10-28T08:00:00Z'), 'end': stamp('2026-10-28T13:30:00Z')}]],
                          'post': [[{'start': stamp('2026-10-27T20:00:00Z'), 'end': stamp('2026-10-28T00:00:00Z')}]]}},
        'timestamp': [stamp(t) for t, v in rows], 'indicators': {'quote': [{'close': [v for t, v in rows]}]}}]}}


class ExtendedTests(unittest.TestCase):
    def test_pre_and_post_use_their_actual_close_not_the_start_of_five_day_history(self):
        hours, closes = extract(fixture(), DEFINITION, NOW)
        self.assertEqual(hours['pre']['price'], 104)
        self.assertEqual(hours['pre']['baseline_price'], 100)
        self.assertEqual(hours['pre']['timestamp'], '2026-10-28T13:15:00Z')
        self.assertEqual(hours['pre']['baseline_session_date'], '2026-10-27')
        self.assertEqual(hours['post']['price'], 103)
        self.assertEqual(hours['post']['baseline_price'], 100)

        self.assertEqual(hours['post']['session_date'], '2026-10-27')
        self.assertEqual(hours['post']['timestamp'], '2026-10-28T00:00:00Z')
        self.assertEqual(len(closes), 2)

    def test_no_extended_market_never_manufactures_zero(self):
        data = fixture(); data['chart']['result'][0]['meta']['hasPrePostMarketData'] = False
        self.assertEqual(extract(data, DEFINITION, NOW)[0], {'pre': None, 'post': None})
        data = fixture(); data['chart']['result'][0]['indicators']['quote'][0]['close'] = [None] * 7
        self.assertEqual(extract(data, DEFINITION, NOW)[0], {'pre': None, 'post': None})

    def test_official_previous_close_overrides_a_different_last_regular_candle(self):
        data = fixture(); result = data['chart']['result'][0]
        result['meta'].update(regularMarketTime=stamp('2026-10-28T13:59:00Z'), regularMarketPrice=105, previousClose=100)
        result['indicators']['quote'][0]['close'][1] = 99.5
        later = datetime(2026, 10, 28, 14, 0, tzinfo=timezone.utc)
        hours, closes = extract(data, DEFINITION, later)
        self.assertEqual(hours['pre']['baseline_price'], 100)
        self.assertEqual(hours['post']['baseline_price'], 100)
        # A small provider clock lead does not invalidate a historical close.
        result['meta']['regularMarketTime'] = stamp('2026-10-28T14:00:03Z')
        self.assertEqual(extract(data, DEFINITION, later)[0]['pre']['baseline_price'], 100)

    def test_incomplete_future_and_out_of_session_candles_do_not_enter_a_percentage(self):
        data = fixture(); result = data['chart']['result'][0]
        result['timestamp'] += [stamp('2026-10-28T13:16:00Z'), stamp('2026-10-28T07:55:00Z')]
        result['indicators']['quote'][0]['close'] += [888, 777]
        self.assertEqual(extract(data, DEFINITION, NOW)[0]['pre']['price'], 104)

    def test_listing_currency_invalid_alignment_and_missing_baselines_are_rejected(self):
        for field, value in [('symbol', 'AAPL.TO'), ('currency', 'CAD')]:
            data = fixture(); data['chart']['result'][0]['meta'][field] = value
            with self.assertRaises(ValueError): extract(data, DEFINITION, NOW)
        data = fixture(); data['chart']['result'][0]['timestamp'].pop()
        with self.assertRaises(ValueError): extract(data, DEFINITION, NOW)
        data = fixture(); data['chart']['result'][0]['meta']['tradingPeriods']['regular'] = []
        self.assertIsNone(extract(data, DEFINITION, NOW)[0]['pre'])

    def test_an_extended_provider_failure_preserves_the_valid_regular_quote(self):
        data = fixture()
        parsed = collector.parse_quote(data, DEFINITION, NOW)
        with patch.object(collector, 'urlopen', side_effect=OSError('Extended provider down')):
            result = collector.with_extended(parsed, DEFINITION, NOW)
        self.assertEqual(result['price'], parsed['price'])
        self.assertEqual(result['intraday_history'], parsed['intraday_history'])
        self.assertEqual(result['timestamp'], parsed['timestamp'])
        self.assertEqual(result['extended_fetch_status'], 'unavailable')

    def test_cached_extended_hours_keep_original_times_when_regular_collection_succeeds(self):
        parsed = collector.parse_quote(fixture(), DEFINITION, NOW)
        hours, closes = extract(fixture(), DEFINITION, NOW)
        old = {'quotes': [{**parsed, 'extended_hours': hours, 'regular_closes': closes}]}
        current = {**parsed, 'extended_fetch_status': 'unavailable'}
        result = collector.collect([DEFINITION], old, NOW, fetcher=lambda *args: current)['quotes'][0]
        self.assertEqual(result['extended_hours']['pre']['fetched_at'], hours['pre']['fetched_at'])
        self.assertEqual(result['extended_hours']['pre']['timestamp'], hours['pre']['timestamp'])
        self.assertEqual(result['extended_hours']['pre']['fetch_status'], 'cached')


if __name__ == '__main__': unittest.main()
