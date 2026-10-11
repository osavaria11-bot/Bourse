import unittest
from datetime import datetime, timezone

from scripts import collect_portfolio_earnings as earnings

NOW = datetime(2026, 10, 11, 20, tzinfo=timezone.utc)
URL = "https://www.marketbeat.com/stocks/NASDAQ/MSFT/earnings/"
HEADERS = ["Date", "Quarter", "Consensus Estimate", "Reported EPS", "Beat/Miss", "GAAP EPS", "Revenue Estimate", "Actual Revenue", "Details"]


def table(rows):
    return '<table id="earnings-history"><tr>' + "".join(f"<th>{h}</th>" for h in HEADERS) + "</tr>" + "".join("<tr>" + "".join(f"<td>{v}</td>" for v in row) + "</tr>" for row in rows) + "</table>"


def sample():
    return table([
        ["10/28/2026 (Estimated)", "-", "$3.00", "$9.00", "-", "-", "$2B", "$5B", ""],
        ["7/29/2026", "Q4 2026", "$-0.50", "$-0.20", "+$0.30", "$-0.80", "$2.10B", "$2.20B", ""],
        ["7/30/2025", "Q4 2025", "$1.00", "$1.10", "$0.10", "$1.10", "$1.90B", "$2.00B", ""],
    ]) + '<a href="/earnings/reports/2026-7-29-microsoft-co-stock/">Q4 2026 Earnings Report</a>'


def yahoo(symbol="MSFT"):
    return '<table><tr><th>Symbol</th><th>Earnings Date</th><th>EPS Estimate</th><th>Reported EPS</th></tr>' + f'<tr><td>{symbol}</td><td>October 28, 2026 at 4 PM EDT</td><td>3.00</td><td>9.00</td></tr>' + f'<tr><td>{symbol}</td><td>July 29, 2026 at 4 p.m. EDT</td><td>-0.50</td><td>-0.20</td></tr></table>'


class EarningsTests(unittest.TestCase):
    def test_metrics_keep_bases_currencies_and_dates_separate(self):
        events = earnings.parse_marketbeat(sample(), "MSFT", URL, NOW)
        current = events[1]
        self.assertEqual(current["eps"]["actual"], -.2)
        self.assertEqual(current["eps"]["estimate"], -.5)
        self.assertEqual(current["revenue"]["actual"], 2.2e9)
        self.assertIn("+10,0 %", current["messages"][0]["text"])
        self.assertEqual(events[0]["date_status"], "estimated")
        self.assertIsNone(events[0]["eps"]["actual"])
        self.assertIsNone(events[0]["revenue"]["actual"])
        self.assertEqual(earnings.metric("C$2.10", "$2.00", URL)["estimate"], None)
        self.assertEqual(earnings.number("C-$0.63"), -.63)
        self.assertEqual(earnings.number("$87.62B"), 87.62e9)
        self.assertEqual(earnings.number("-"), None)

    def test_zero_revenue_placeholder_never_claims_a_collapse(self):
        html = table([["7/29/2026", "Q4 2026", "$2", "$2.10", "$0.10", "$2", "$2B", "$0.00", ""]])
        event = earnings.parse_marketbeat(html, "MSFT", URL, NOW)[0]
        self.assertIsNone(event["revenue"]["actual"])
        self.assertEqual(event["messages"], [])

    def test_yahoo_exact_symbol_timezone_future_guard_and_missing_currency(self):
        events = earnings.parse_yahoo(yahoo(), "MSFT", "MSFT", URL, NOW, "USD")
        self.assertEqual(events[1]["report_at"], "2026-07-29T20:00:00+00:00")
        self.assertEqual(events[1]["eps"]["actual"], -.2)
        self.assertEqual(events[0]["eps"]["actual"], None)
        self.assertEqual(earnings.parse_yahoo(yahoo(), "T.TO", "T.TO", URL, NOW, None), [])
        canada = earnings.parse_yahoo(yahoo("T.TO"), "T.TO", "T.TO", URL, NOW, None)
        self.assertIsNone(canada[1]["eps"]["currency"])
        with self.assertRaises(earnings.SourceError):
            earnings.parse_yahoo("<html>Service unavailable</html>", "MSFT", "MSFT", URL, NOW, "USD")

    def test_short_topics_include_caution_and_limit_quotation(self):
        topics = '<h3>Key Takeaways</h3><ul>' + "".join('<li><span>' + sentiment + ' Sentiment:</span><strong>' + title + ':</strong> Longer explanation omitted.</li>' for sentiment, title in [
            ("Positive", "Record fiscal year"), ("Positive", "Strong cloud customer demand"), ("Positive", "Revenue growth continued"), ("Negative", "Higher spending pressures margins")]) + "</ul>"
        result = earnings.parse_topics(topics, URL)
        self.assertEqual(result[-1]["text"], "Higher spending pressures margins")
        self.assertLessEqual(sum(len(row["text"].split()) for row in result), 24)
        self.assertEqual(earnings.parse_topics('<h3>Key Takeaways</h3><ul><li><strong>$650 million</strong></li></ul>', URL), [])
        self.assertEqual(earnings.parse_topics('<h3>Unrelated news</h3><ul><li><strong>Stock prices today</strong></li></ul>', URL), [])

    def test_fallback_never_mix_eps_actual_with_other_provider_estimate(self):
        calls = []
        def fetch(url):
            calls.append(url)
            if "calendar" in url:
                return yahoo()
            if "reports" in url:
                return "<h3>No transcript available</h3>"
            return sample().replace("$-0.50", "-")
        definition = {"id": "MSFT", "quote_symbol": "MSFT"}
        feed = earnings.collect_company(definition, NOW, NOW.date().replace(month=7, day=1), NOW.date().replace(month=12, day=1), fetch)
        current = feed["events"][0]
        self.assertEqual(current["eps"]["actual"], -.2)
        self.assertEqual(current["eps"]["estimate"], -.5)
        self.assertIn("calendar", current["eps"]["source_url"])
        self.assertEqual(current["revenue"]["source_url"], URL)
        self.assertTrue(all("portfolio" not in url for url in calls))

    def test_failed_sources_preserve_cache_dates_and_ignore_etfs(self):
        def fail(url):
            raise earnings.SourceError("Unavailable")
        catalog = {"series": [{"id": "MSFT", "quote_symbol": "MSFT", "source_url": URL}, {"id": "FEQT", "quote_symbol": "FEQT.NE", "source_url": URL}]}
        old_events = earnings.parse_marketbeat(sample(), "MSFT", URL, NOW)
        old = {"instruments": {"MSFT": {"fetch_status": "fresh", "fetched_at": "2026-10-01T20:00:00+00:00", "source_url": URL, "company_symbol": "MSFT", "events": old_events}}}
        result = earnings.collect(catalog, old, NOW, fail)
        self.assertEqual(result["coverage"]["cached"], 1)
        self.assertEqual(result["coverage"]["not_applicable"], 1)
        self.assertEqual(result["instruments"]["MSFT"]["fetched_at"], old["instruments"]["MSFT"]["fetched_at"])
        self.assertEqual(result["instruments"]["FEQT"]["events"], [])
        self.assertEqual(earnings.collect(catalog, None, NOW, fail)["instruments"]["MSFT"]["fetch_status"], "unavailable")

    def test_reviewed_messages_are_tied_to_the_exact_dated_report(self):
        event = earnings.parse_marketbeat(sample(), "MSFT", URL, NOW)[1]
        feed = {"company_symbol": "MSFT", "events": [event]}
        highlights = {"reports": {"MSFT:2026-07-29": {"source_url": event["report_url"], "messages": ["Demande de services en progression."]}}}
        result = earnings.apply_reviewed_messages(feed, highlights)
        self.assertEqual(result["events"][0]["messages"][0]["language"], "fr")
        wrong = {"reports": {"MSFT:2026-07-29": {"source_url": "https://example.com/another-quarter", "messages": ["Wrong quarter"]}}}
        result = earnings.apply_reviewed_messages(result, wrong)
        self.assertEqual(result["events"][0]["messages"][0]["text"], "Demande de services en progression.")


if __name__ == "__main__":
    unittest.main()
