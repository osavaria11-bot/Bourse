import importlib.util
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from forward_fiscal_calendars import fiscal_end, first_fiscal_year, normalize_monthly, normalize_snapshot
from audit_forward_internal import audit_result


class FiscalCalendarTest(unittest.TestCase):
    def test_week_based_year_ends(self):
        expected = {'NVDA': ['2026-01-25', '2027-01-31', '2028-01-30'],
                    'AAPL': ['2026-09-26', '2027-09-25', '2028-09-30'],
                    'MU': ['2026-09-03', '2027-09-02', '2028-08-31']}
        for identity, ends in expected.items():
            self.assertEqual([fiscal_end(identity, year).isoformat() for year in [2026, 2027, 2028]], ends)

    def test_rollover_uses_actual_day_and_keeps_end_day(self):
        self.assertEqual(first_fiscal_year('AAPL', '2026-09-26'), 2026)
        self.assertEqual(first_fiscal_year('AAPL', '2026-09-27'), 2027)
        self.assertEqual(first_fiscal_year('MU', '2027-08-31'), 2027)
        self.assertEqual(first_fiscal_year('MU', '2027-09-03'), 2028)
        self.assertEqual(first_fiscal_year('RY', '2026-11-02'), 2027)

    def test_historical_roll_does_not_invent_next_year_estimate(self):
        original = {'date': '2026-09-28', 'fy1': 20, 'fy2': 15,
                    'period_fy1': '2026-09-30', 'period_fy2': '2027-09-30'}
        corrected = normalize_monthly('AAPL', original)
        self.assertEqual(corrected['fy1'], 15)
        self.assertIsNone(corrected['fy2'])
        self.assertEqual(corrected['period_fy1'], '2027-09-25')
        self.assertEqual(corrected['source_fiscal_values']['fy1'], 20)
        self.assertEqual(normalize_monthly('AAPL', corrected), corrected)
        self.assertEqual(original['fy1'], 20)

    def test_source_missing_fy1_stays_missing_before_true_rollover(self):
        original = {'date': '2027-09-01', 'fy1': 10, 'fy2': 8,
                    'period_fy1': '2028-08-31', 'period_fy2': '2029-08-31'}
        corrected = normalize_monthly('MU', original)
        self.assertIsNone(corrected['fy1'])
        self.assertEqual(corrected['fy2'], 10)

    def test_snapshot_dates_are_reversible_without_changing_forecasts(self):
        original = {'ev_bridge_date': '2026-01-31', 'forecasts': [{'period_end': '2028-01-31', 'eps': 15.78}]}
        corrected = normalize_snapshot('NVDA', original)
        self.assertEqual(corrected['forecasts'][0]['period_end'], '2028-01-30')
        self.assertEqual(corrected['forecasts'][0]['source_period_end'], '2028-01-31')
        self.assertEqual(corrected['forecasts'][0]['eps'], 15.78)
        self.assertEqual(corrected['ev_bridge_date'], '2026-01-25')
        self.assertEqual(normalize_snapshot('NVDA', corrected), corrected)


class RetainedAuditTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.audit = json.loads((ROOT / 'data/forward-audit.json').read_text())
        cls.results = {r['id']: r for r in cls.audit['results']}
        cls.stocks = {r['id']: r for r in json.loads((ROOT / 'data/forward-valuation.json').read_text())['instruments']}

    def test_bank_revision_matches_fiscal_year_across_rollover(self):
        result = self.results['RY']
        self.assertTrue(result['fiscal_rollover'])
        self.assertEqual([p['fiscal_year'] for p in result['periods']], [2027, 2028])
        self.assertEqual([p['eps_revision_pct'] for p in result['periods']], [0, 0])
        self.assertAlmostEqual(result['periods'][0]['pe'], 283.93 / 17.71)

    def test_new_forecast_not_backdated_to_old_close(self):
        for result in self.results.values():
            self.assertEqual(result['snapshot']['date'], '2026-11-02')
            self.assertEqual(result['snapshot']['price_date'], '2026-10-30')
            self.assertFalse(result['snapshot']['complete_session'])
            self.assertNotIn('2026-11-02', [s['date'] for s in self.stocks[result['id']]['observations']])
            self.assertNotIn('2026-10-30', [s['date'] for s in self.stocks[result['id']]['observations']])

    def test_unreconciled_bridge_and_bank_ev_remain_unavailable(self):
        for identity in ['MDA', 'RY']:
            result = self.results[identity]
            self.assertIsNone(result['snapshot']['enterprise_value_millions'])
            self.assertTrue(all(p['ev_ebitda'] is None for p in result['periods']))
            self.assertIsNotNone(result['snapshot']['source_enterprise_value_millions'])
        self.assertEqual(self.results['MDA']['ev_status'], 'withheld')

    def test_price_mismatch_is_rejected(self):
        r = self.results['NVDA']
        for invalid in [{'value': 1}, {'currency': 'CAD'}, {'date': '2026-10-29'}]:
            with self.assertRaises(ValueError):
                audit_result(self.stocks['NVDA'], r['source_snapshot'], {**r['price_check'], **invalid})

    def test_audit_reproduction_is_deterministic(self):
        for identity, result in self.results.items():
            self.assertEqual(audit_result(self.stocks[identity], result['source_snapshot'], result['price_check']), result)


if __name__ == '__main__':
    unittest.main()
