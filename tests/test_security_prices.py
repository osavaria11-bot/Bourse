"""Price catalogue and protection against using a different cached listing."""
import unittest
from datetime import datetime, timezone
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
        self.assertEqual(points['MAXQ']['quote_symbol'], 'MAXQ.NE')
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

if __name__ == '__main__':
    unittest.main()
