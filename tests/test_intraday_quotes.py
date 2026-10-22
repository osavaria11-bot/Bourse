import copy
import unittest
import io
import json
from unittest.mock import patch
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
    def test_cboe_backup_preserves_index_time_instead_of_file_generation_time(self):
        definition = {"id": "SPX", "title": "S&P 500", "quote_symbol": "^GSPC", "currency": "USD"}
        source = {"symbol": "_SPX", "timestamp": "2026-10-12 14:00:00", "data": {"symbol": "^SPX", "security_type": "index",
            "current_price": 100, "prev_day_close": 99, "last_trade_time": "2026-10-12T09:44:00"}}
        parsed = quotes.parse_cboe(source, definition, NOW)
        self.assertEqual(parsed["timestamp"], "2026-10-12T13:44:00Z")
        self.assertEqual(parsed["fetched_at"], "2026-10-12T14:00:00Z")
        self.assertEqual(parsed["provider_delay_minutes"], 15)
        self.assertEqual(parsed["source_provider"], "cboe")
        for field, value in [("symbol", "SPY"), ("security_type", "future"), ("current_price", True),
                ("last_trade_time", "2026-10-12T11:00:00"), ("last_trade_time", "2026-10-12T09:44:00Z")]:
            wrong = copy.deepcopy(source); wrong["data"][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(quotes.markets.macro.SourceError):
                quotes.parse_cboe(wrong, definition, NOW)
        with patch.object(quotes, "urlopen", side_effect=OSError("Yahoo down")), patch.object(quotes, "fetch_cboe", return_value=parsed) as backup:
            self.assertEqual(quotes.fetch_quote(definition, NOW)["timestamp"], parsed["timestamp"])
            backup.assert_called_once()
        old = fixture("^GSPC", stamp=NOW.timestamp() - 3600)
        with patch.object(quotes, "urlopen", side_effect=lambda *a, **kw: io.StringIO(json.dumps(old))), patch.object(quotes, "fetch_cboe", return_value=parsed) as backup:
            self.assertEqual(quotes.fetch_quote(definition, NOW)["source_provider"], "cboe")
            backup.assert_called_once()

    def test_forex_history_keeps_the_recent_closed_equity_session(self):
        data = fixture("CAD=X", "CAD"); result = data["chart"]["result"][0]
        result["meta"]["regularMarketPrice"] = 1.4
        friday = datetime(2026, 10, 9, 19, 55, tzinfo=timezone.utc).timestamp()
        result["timestamp"] = [friday, NOW.timestamp() - 900, NOW.timestamp() - 600, NOW.timestamp() - 300]
        result["indicators"] = {"quote": [{"close": [1.3, 99, 1.38, 1.39]}]}
        definition = {"id": "USDCAD", "title": "USD/CAD", "quote_symbol": "CAD=X", "currency": "CAD"}
        parsed = quotes.parse_quote(data, definition, NOW)
        self.assertEqual(parsed["intraday_sessions"]["2026-10-09"], [["2026-10-09T20:00:00Z", 1.3]])
        self.assertEqual(parsed["intraday_history"], [["2026-10-12T13:55:00Z", 1.38], ["2026-10-12T13:59:00Z", 1.4]])
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
        self.assertEqual(parsed["intraday_history"], [["2026-10-12T13:45:00Z", 98], ["2026-10-12T13:59:00Z", 100]])
        self.assertEqual(parsed["history_interval_minutes"], 5)
        result["indicators"]["quote"] = []
        self.assertEqual(quotes.parse_quote(data, DEFINITION, NOW)["intraday_history"], [["2026-10-12T13:59:00Z", 100]])
    def test_thinly_traded_etf_without_candles_keeps_its_actual_last_trade(self):
        definition = {"id": "XIG", "title": "XIG", "quote_symbol": "XIG.TO", "currency": "CAD"}
        trade = datetime(2026, 10, 12, 13, 39, 3, tzinfo=timezone.utc)
        for close_rows in (None, [], [None, None]):
            data = fixture("XIG.TO", "CAD", stamp=trade.timestamp())
            result = data["chart"]["result"][0]
            if close_rows is not None:
                result["timestamp"] = [trade.timestamp() - 600, trade.timestamp() - 300][:len(close_rows)]
                result["indicators"] = {"quote": [{"close": close_rows}]}
            parsed = quotes.parse_quote(data, definition, NOW)
            self.assertEqual(parsed["intraday_history"], [["2026-10-12T13:39:03Z", 100]])
            self.assertEqual(parsed["timestamp"], "2026-10-12T13:39:03Z")
            self.assertEqual(parsed["fetched_at"], "2026-10-12T14:00:00Z")
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
