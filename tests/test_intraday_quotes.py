import copy
import unittest
from datetime import datetime, timezone
from scripts import collect_intraday_quotes as quotes

NOW = datetime(2026, 10, 12, 14, 0, tzinfo=timezone.utc)
DEFINITION = {"id": "MSFT", "title": "Microsoft", "quote_symbol": "MSFT", "currency": "USD"}

def fixture(symbol="MSFT", currency="USD", stamp=None, start=None, end=None):
    return {"chart": {"error": None, "result": [{"meta": {
        "symbol": symbol, "currency": currency, "regularMarketPrice": 100,
        "regularMarketTime": stamp if stamp is not None else NOW.timestamp() - 60,
        "exchangeTimezoneName": "America/New_York", "instrumentType": "EQUITY", "previousClose": 99,
        "currentTradingPeriod": {"regular": {"start": start or NOW.timestamp() - 1800,
            "end": end or NOW.timestamp() + 21600}}}}]}}

class QuoteTests(unittest.TestCase):
    def test_forex_history_keeps_the_recent_closed_equity_session(self):
        data = fixture("CAD=X", "CAD"); result = data["chart"]["result"][0]
        result["meta"]["regularMarketPrice"] = 1.4
        friday = datetime(2026, 10, 9, 19, 55, tzinfo=timezone.utc).timestamp()
        result["timestamp"] = [friday, NOW.timestamp() - 600, NOW.timestamp() - 300]
        result["indicators"] = {"quote": [{"close": [1.3, 99, 1.39]}]}
        definition = {"id": "USDCAD", "title": "USD/CAD", "quote_symbol": "CAD=X", "currency": "CAD"}
        parsed = quotes.parse_quote(data, definition, NOW)
        self.assertEqual(parsed["intraday_sessions"]["2026-10-09"], [["2026-10-09T19:55:00Z", 1.3]])
        self.assertEqual(parsed["intraday_history"], [["2026-10-12T13:55:00Z", 1.39], ["2026-10-12T13:59:00Z", 1.4]])
        result["meta"]["regularMarketPrice"] = 100
        with self.assertRaises(quotes.markets.macro.SourceError):
            quotes.parse_quote(data, definition, NOW)
    def test_intraday_history_filters_other_sessions_future_and_invalid_points(self):
        data = fixture(); result = data["chart"]["result"][0]
        ticks = [NOW.timestamp() - 3 * 86400, NOW.timestamp() - 1200, NOW.timestamp() - 600,
                 NOW.timestamp() - 300, NOW.timestamp() + 60]
        result["timestamp"] = ticks
        result["indicators"] = {"quote": [{"close": [90, 98, None, 99, 120]}]}
        parsed = quotes.parse_quote(data, DEFINITION, NOW)
        self.assertEqual(parsed["intraday_history"], [["2026-10-12T13:40:00Z", 98], ["2026-10-12T13:55:00Z", 99], ["2026-10-12T13:59:00Z", 100]])
        self.assertEqual(parsed["history_interval_minutes"], 5)
        result["indicators"]["quote"] = []
        self.assertEqual(quotes.parse_quote(data, DEFINITION, NOW)["intraday_history"], [])
    def test_regular_quote_preserves_trade_time_not_fetch_time(self):
        result = quotes.parse_quote(fixture(), DEFINITION, NOW)
        self.assertEqual(result["price"], 100)
        self.assertEqual(result["timestamp"], "2026-10-12T13:59:00Z")
        self.assertEqual(result["session_date"], "2026-10-12")
        self.assertEqual(result["market_state"], "regular")
        self.assertIsNone(result["provider_delay_minutes"])

    def test_canadian_holiday_keeps_fridays_trade_and_closed_status(self):
        friday = datetime(2026, 10, 9, 19, 59, tzinfo=timezone.utc).timestamp()
        data = fixture("VBAL.TO", "CAD", stamp=friday, start=friday - 23000, end=friday + 60)
        result = quotes.parse_quote(data, {"id": "VBAL", "title": "VBAL", "quote_symbol": "VBAL.TO", "currency": "CAD"}, NOW)
        self.assertEqual(result["session_date"], "2026-10-09")
        self.assertEqual(result["market_state"], "closed")

    def test_open_market_without_new_trade_is_not_called_closed(self):
        old = NOW.timestamp() - 3 * 86400
        result = quotes.parse_quote(fixture(stamp=old), DEFINITION, NOW)
        self.assertEqual(result["market_state"], "regular")
        self.assertEqual(result["session_date"], "2026-10-09")

    def test_symbol_currency_invalid_price_and_future_time_rejected(self):
        invalid = [fixture(symbol="MSFT.TO"), fixture(currency="CAD"), fixture(stamp=NOW.timestamp() + 600),
            fixture(stamp=NOW.timestamp() - 8 * 86400)]
        for price in (0, -1, True, None, float("nan")):
            data = fixture(); data["chart"]["result"][0]["meta"]["regularMarketPrice"] = price; invalid.append(data)
        for data in invalid:
            with self.subTest(data=data), self.assertRaises(quotes.markets.macro.SourceError):
                quotes.parse_quote(data, DEFINITION, NOW)

    def test_cache_keeps_original_trade_and_fetch_dates(self):
        old = quotes.parse_quote(fixture(), DEFINITION, NOW)
        def failure(*args):
            raise quotes.markets.macro.SourceError("Provider down")
        result = quotes.collect([DEFINITION], {"quotes": [old]}, NOW, fetcher=failure)
        self.assertEqual(result["quotes"][0]["timestamp"], old["timestamp"])
        self.assertEqual(result["quotes"][0]["fetched_at"], old["fetched_at"])
        self.assertEqual(result["quotes"][0]["fetch_status"], "cached")
        wrong = copy.deepcopy(old); wrong["currency"] = "CAD"
        with self.assertRaises(quotes.markets.macro.SourceError):
            quotes.collect([DEFINITION], {"quotes": [wrong]}, NOW, fetcher=failure)

if __name__ == "__main__":
    unittest.main()
