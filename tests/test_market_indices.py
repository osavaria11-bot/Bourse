"""Synthetic fixtures: calendar dates, provider identity and outage preservation."""
import copy
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from scripts import collect_market_indices as markets

NOW = datetime(2026, 10, 10, 18, tzinfo=timezone.utc)

def payload():
    return {"chart": {"error": None, "result": [{
        "meta": {"symbol": "EEM", "exchangeTimezoneName": "America/New_York"},
        "timestamp": [1791466200, 1791552600],
        "indicators": {"quote": [{"close": [60.0, 61.0]}]}}]}}

class MarketHistoryTests(unittest.TestCase):
    def test_close_calendar_uses_the_exchange_timezone(self):
        data = payload()
        # 02:00 UTC belongs to the previous calendar date in New York.
        data["chart"]["result"][0]["timestamp"] = [1791424800, 1791511200]
        history = markets.parse_history(data, "EEM", NOW)
        self.assertEqual(history, [["2026-10-07", 60.0], ["2026-10-08", 61.0]])

    def test_wrong_symbol_rejected(self):
        with self.assertRaises(markets.macro.SourceError):
            markets.parse_history(payload(), "^GSPC", NOW)

    def test_wrong_currency_rejected(self):
        data = payload()
        data["chart"]["result"][0]["meta"]["currency"] = "USD"
        with self.assertRaises(markets.macro.SourceError):
            markets.parse_history(data, "EEM", NOW, "CAD")

    def test_weekend_live_fx_quote_is_not_a_daily_session(self):
        data = payload()
        result = data["chart"]["result"][0]
        result["meta"].update(symbol="CAD=X", exchangeTimezoneName="Europe/London", currency="CAD")
        result["timestamp"] = [int(datetime(2026, 10, day, tzinfo=timezone.utc).timestamp()) for day in (8, 9, 10)]
        result["indicators"]["quote"][0]["close"] = [1.42, 1.43, 1.99]
        self.assertEqual(markets.parse_history(data, "CAD=X", NOW, "CAD"), [["2026-10-08", 1.42], ["2026-10-09", 1.43]])

    def test_intraday_quote_is_not_published_as_a_close(self):
        data = payload()
        result = data["chart"]["result"][0]
        result["timestamp"].append(int(NOW.timestamp()))
        result["indicators"]["quote"][0]["close"].append(999.0)
        result["meta"]["currentTradingPeriod"] = {"regular": {"end": int(NOW.timestamp()) + 100}}
        self.assertEqual(len(markets.parse_history(data, "EEM", NOW)), 2)

    def test_invalid_values_and_future_dates_are_discarded(self):
        data = payload()
        result = data["chart"]["result"][0]
        result["timestamp"] += [int(NOW.timestamp()) - 86400 * 4, int(NOW.timestamp()) - 86400 * 3, int(NOW.timestamp()) + 86400]
        result["indicators"]["quote"][0]["close"] += [True, float("nan"), 999.0]
        self.assertEqual(len(markets.parse_history(data, "EEM", NOW)), 2)

    def test_missing_observations_remain_gaps(self):
        data = payload()
        result = data["chart"]["result"][0]
        result["timestamp"].insert(0, result["timestamp"][0] - 86400)
        result["indicators"]["quote"][0]["close"].insert(0, None)
        self.assertIsNone(markets.parse_history(data, "EEM", NOW)[0][1])

    def test_mismatched_dates_and_values_rejected(self):
        data = payload()
        data["chart"]["result"][0]["timestamp"].append(int(NOW.timestamp()))
        with self.assertRaises(markets.macro.SourceError):
            markets.parse_history(data, "EEM", NOW)

    def test_an_outage_preserves_previous_observations_per_market(self):
        definitions = markets.definitions()
        points = [markets.macro.summarize(d, [["2026-10-08", 60.0], ["2026-10-09", 61.0]], NOW) for d in definitions]
        previous = {"series": points, "last_successful_update": NOW.isoformat()}
        def fetch(definition, now):
            if definition["id"] == "EEM":
                raise markets.macro.SourceError("Synthetic outage")
            return copy.deepcopy(next(p for p in points if p["id"] == definition["id"]))
        result = markets.macro.collect_sources(definitions, previous, NOW, fetcher=fetch)
        self.assertEqual(result["coverage"], {"total": 5, "fresh": 4, "cached": 1, "unavailable": 0})
        cached = next(p for p in result["series"] if p["id"] == "EEM")
        self.assertEqual((cached["value"], cached["date"], cached["fetch_status"]), (61.0, "2026-10-09", "cached"))

    def test_total_failure_without_cache_does_not_replace_the_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "market-indices.json"
            path.write_text('{"existing":true}')
            with patch.object(markets, "fetch_index", side_effect=markets.macro.SourceError("Synthetic outage")):
                self.assertEqual(markets.main(["--output-dir", temporary]), 1)
            self.assertEqual(json.loads(path.read_text()), {"existing": True})

if __name__ == "__main__":
    unittest.main()
