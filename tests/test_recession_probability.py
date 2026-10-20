"""Synthetic NY Fed workbook and forecast-date regressions."""
import unittest
from datetime import date
from unittest.mock import patch

from scripts import generate_daily_briefing as G

HEADER = ["Date", "10 Year Treasury Yield", "3 Month Treasury Yield",
          "3 Month Treasury Yield (Bond Equivalent Basis)", "Spread", "Rec_prob", "NBER_Rec"]

def rows():
    return [HEADER, ["01-Aug-2026", 4, 3, 3.1, .9, .7, 0],
            ["01-Sep-2026", 4, 3, 3.1, .9, .8, 0],
            ["01-Oct-2026", 4, 3, 3.1, .9, .9, 0],
            ["01-Aug-2027", "", "", "", "", .25, ""],
            ["01-Sep-2027", "", "", "", "", .125, ""],
            ["01-Oct-2027", "", "", "", "", .5, ""]]

class RecessionTests(unittest.TestCase):
    def item(self):
        return next(d for d in G.read_json(G.ROOT / "data/series.json")["series"] if d["id"] == "NYFEDRECPROB")

    def test_forecast_month_is_shifted_back_exactly_twelve_months(self):
        self.assertEqual(G.parse_recession_rows(rows(), date(2026, 10, 20)),
                         [["2026-08-01", 25.0], ["2026-09-01", 12.5]])

    def test_bad_headers_duplicate_months_and_invalid_probabilities_are_rejected(self):
        for value in (-.1, 1.01, float("nan"), True, "bad"):
            data = rows(); data[-2][5] = value
            with self.subTest(value=value), self.assertRaises(G.SourceError):
                G.parse_recession_rows(data, date(2026, 10, 20))
        for data in ([[], *rows()[1:]], [*rows(), rows()[1]], []):
            with self.assertRaises(G.SourceError): G.parse_recession_rows(data, date(2026, 10, 20))

    def test_missing_input_month_is_not_invented_and_zero_is_valid(self):
        data = rows(); data[-2][5] = 0
        self.assertEqual(G.parse_recession_rows(data, date(2026, 10, 20))[-1], ["2026-09-01", 0])
        del data[2]
        self.assertEqual(G.parse_recession_rows(data, date(2026, 10, 20)), [["2026-08-01", 25]])
        with self.assertRaises(G.SourceError): G.parse_recession_workbook(b"<html>outage</html>", date(2026, 10, 20))

    def test_collector_source_and_outage_preserve_dates_and_history(self):
        from datetime import datetime, timezone
        now = datetime(2026, 10, 20, 15, tzinfo=timezone.utc)
        item = self.item()
        with patch.object(G, "fetch_bytes", return_value=b"synthetic"), patch.object(G, "parse_recession_workbook", return_value=[["2026-08-01", 25], ["2026-09-01", 12.5]]):
            point = G.fetch_series(item, now)
        self.assertEqual((point["date"], point["value"], point["source_label"]), ("2026-09-01", 12.5, "Fed de New York"))
        self.assertEqual(point["source_data_url"], G.NYFED_RECESSION_DATA_URL)
        with patch.object(G, "fetch_bytes", side_effect=G.SourceError("outage")):
            dataset = G.collect_sources([item], {"series": [point]}, now)
        cached = dataset["series"][0]
        self.assertEqual(cached["date"], point["date"])
        self.assertEqual(cached["history"], point["history"])
        self.assertEqual(cached["fetch_status"], "cached")
        self.assertNotIn(item["id"], G.BRIEFING_IDS)
