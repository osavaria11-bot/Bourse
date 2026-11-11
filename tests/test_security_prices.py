"""Price catalogue and protection against using a different cached listing."""
import unittest
from datetime import datetime, timezone
from unittest.mock import patch
from scripts import collect_security_prices as securities
from scripts import generate_daily_briefing as macro

class SecurityTests(unittest.TestCase):
    def test_public_catalogue_and_fx_keep_exact_listings_without_personal_quantities(self):
        definitions = securities.definitions()
        catalogue = macro.read_json(securities.ROOT / 'data/securities.json')
        self.assertEqual(len(definitions), len(catalogue['series']) + 1)
        points = {p['id']: p for p in definitions}
        self.assertEqual((points['SHOP']['quote_symbol'], points['SHOP']['currency']), ('SHOP.TO', 'CAD'))
        self.assertEqual((points['CLS']['quote_symbol'], points['CLS']['currency']), ('CLS', 'USD'))
        self.assertEqual(points['FEQT']['quote_symbol'], 'FEQT.NE')
        self.assertEqual((points['MAXQ']['quote_symbol'], points['MAXQ']['currency']), ('MAXQ.TO', 'CAD'))
        self.assertEqual((points['SNDK']['quote_symbol'], points['SNDK']['currency']), ('SNDK.TO', 'CAD'))
        self.assertEqual((points['SNDKUS']['quote_symbol'], points['SNDKUS']['currency']), ('SNDK', 'USD'))
        self.assertEqual(points['USDCAD']['quote_symbol'], 'CAD=X')
        self.assertTrue(all('quantity' not in p and 'positions' not in p for p in definitions))

    def test_cache_of_another_listing_or_currency_is_never_relabelled(self):
        definition = next(p for p in securities.definitions() if p['id'] == 'SHOP')
        now = datetime(2026, 10, 10, tzinfo=timezone.utc)
        point = macro.summarize(definition, [['2026-10-08', 100], ['2026-10-09', 101]], now)
        self.assertTrue(macro.usable_previous(point, definition, now.date()))
        self.assertFalse(macro.usable_previous({**point, 'quote_symbol': 'SHOP'}, definition, now.date()))
        self.assertFalse(macro.usable_previous({**point, 'currency': 'USD'}, definition, now.date()))

    def test_maxq_history_survives_daily_refresh_and_uses_the_correct_listing(self):
        definition = next(p for p in securities.definitions() if p['id'] == 'MAXQ')
        now = datetime(2026, 11, 11, tzinfo=timezone.utc)
        tsx = macro.summarize(definition, [['2026-11-02', 0.40], ['2026-11-03', 0.47], ['2026-11-04', 0.46]], now)
        with patch.object(securities.markets, 'fetch_index', return_value=tsx):
            point = securities.fetch_security(definition, now)
        history = dict(point['history'])
        self.assertEqual(len(history), len(point['history']))
        self.assertEqual(history['2025-12-31'], 0.28)
        self.assertEqual(history['2026-07-16'], 0.465)
        self.assertEqual(point['history'][-3:], [['2026-11-02', 0.47], ['2026-11-03', 0.47], ['2026-11-04', 0.46]])
        self.assertEqual([source['symbol'] for source in point['history_sources']], ['MAXQ:CC', 'MAXQ.NE', 'MAXQ.TO'])

        truncated = macro.summarize(definition, [['2026-11-04', 0.46], ['2026-11-05', 0.44]], now)
        with patch.object(securities.markets, 'fetch_index', return_value=truncated):
            update = macro.collect_sources([definition], {'series': [point]}, now, fetcher=securities.fetch_security)
        self.assertEqual(update['series'][0]['fetch_status'], 'cached')
        self.assertEqual(update['series'][0]['history'], point['history'])

if __name__ == '__main__':
    unittest.main()
