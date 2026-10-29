import copy
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
    def test_cdr_results_use_the_underlying_us_company_and_new_funds_have_no_eps(self):
        def fetch(url):
            if 'calendar' in url:
                return yahoo()
            if 'reports' in url:
                return '<h3>No transcript</h3>'
            return sample()
        definitions = [{'id': 'MSFT', 'quote_symbol': 'MSFT'}, {'id': 'MSFTCDR', 'quote_symbol': 'MSFT.TO'}]
        definitions += [{'id': ticker, 'quote_symbol': ticker, 'source_url': URL} for ticker in ['FBAL', 'SPYM', 'CASH', 'ZUH']]
        data = earnings.collect({'series': definitions}, None, NOW, fetch)
        cdr = data['instruments']['MSFTCDR']
        self.assertEqual(cdr['company_symbol'], 'MSFT')
        self.assertIsNotNone(cdr['listing_note'])
        self.assertEqual(cdr['events'], data['instruments']['MSFT']['events'])
        self.assertEqual(cdr['events'][1]['eps']['currency'], 'USD')
        self.assertEqual(data['coverage']['not_applicable'], 4)
        self.assertEqual(earnings.source_for({'id': 'DIS', 'quote_symbol': 'DIS'})[1], 'https://www.marketbeat.com/stocks/NYSE/DIS/earnings/')

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

    def test_duplicate_yahoo_calendar_and_report_keep_the_published_pair_in_both_orders(self):
        pending = '<tr><td>MSFT</td><td>July 29, 2026 at 5 PM EDT</td><td>-0.40</td><td>-</td></tr>'
        reported = '<tr><td>MSFT</td><td>July 29, 2026 at 4 PM EDT</td><td>-0.50</td><td>-0.20</td></tr>'
        for rows in [pending + reported, reported + pending]:
            body = '<table><tr><th>Symbol</th><th>Earnings Date</th><th>EPS Estimate</th><th>Reported EPS</th></tr>' + rows + '</table>'
            def fetch(url):
                if "calendar" in url:
                    return body
                raise earnings.SourceError("Provider unavailable")
            feed = earnings.collect_company({"id": "MSFT", "quote_symbol": "MSFT"}, NOW, NOW.date().replace(month=7, day=1), NOW.date().replace(month=12, day=1), fetch)
            self.assertEqual(len(feed["events"]), 1)
            event = feed["events"][0]
            self.assertEqual(event["date_status"], "reported")
            self.assertEqual(event["eps"]["actual"], -.2)
            self.assertEqual(event["eps"]["estimate"], -.5)
            self.assertEqual(event["report_at"], "2026-07-29T20:00:00+00:00")
            self.assertEqual(len(event["sources"]), 1)

    def test_reviewed_messages_are_tied_to_the_exact_dated_report(self):
        event = earnings.parse_marketbeat(sample(), "MSFT", URL, NOW)[1]
        feed = {"company_symbol": "MSFT", "events": [event]}
        points = ["Demande de services en progression.", "La direction relève ses perspectives annuelles.", "Le coût des investissements reste à surveiller.", "Les flux de trésorerie financent les nouvelles capacités."]
        highlights = {"reports": {"MSFT:2026-07-29": {"source_url": event["report_url"], "messages": points}}}
        result = earnings.apply_reviewed_messages(feed, highlights)
        self.assertEqual(len(result["events"][0]["messages"]), 4)
        self.assertEqual(result["events"][0]["messages"][0]["language"], "fr")
        wrong = {"reports": {"MSFT:2026-07-29": {"source_url": "https://example.com/another-quarter", "messages": ["Wrong quarter"]}}}
        result = earnings.apply_reviewed_messages(result, wrong)
        self.assertEqual(result["events"][0]["messages"][0]["text"], "Demande de services en progression.")

    def test_reviewed_contract_rejects_one_line_fillers_duplicates_and_unsafe_sources(self):
        payload = {"schema_version": 1, "kind": "reviewed_earnings_highlights", "reviewed_at": NOW.isoformat(),
                   "reports": {"MSFT:2026-07-29": {"source_url": URL,
                       "messages": ["La demande des clients se renforce.", "Les perspectives sont relevées.", "Les investissements pèsent sur la trésorerie."]}}}
        self.assertEqual(earnings.validate_reviewed_highlights(payload), 1)
        for messages in [["BPA battu."], ["Même point."] * 3, ["Point distinct " + str(i) for i in range(5)]]:
            invalid = copy.deepcopy(payload); invalid["reports"]["MSFT:2026-07-29"]["messages"] = messages
            with self.assertRaises(earnings.SourceError):
                earnings.validate_reviewed_highlights(invalid)
        invalid = copy.deepcopy(payload); invalid["reports"]["MSFT:2026-07-29"]["source_url"] = "javascript:alert(1)"
        with self.assertRaises(earnings.SourceError):
            earnings.validate_reviewed_highlights(invalid)

    def test_primary_sources_can_support_a_review_bound_to_the_calendar_report(self):
        event = earnings.parse_marketbeat(sample(), "MSFT", URL, NOW)[1]
        primary = "https://example.com/issuer/2026-q4-results"
        review = {"source_url": primary, "report_url": event["report_url"],
                  "messages": ["La demande accélère.", "Les perspectives sont relevées.", "Les marges restent sous pression."]}
        feed = earnings.apply_reviewed_messages({"company_symbol": "MSFT", "events": [event]}, {"reports": {"MSFT:2026-07-29": review}})
        self.assertEqual(len(feed["events"][0]["messages"]), 3)
        self.assertEqual(feed["events"][0]["messages"][0]["source_url"], primary)
        self.assertTrue(any(source["url"] == primary for source in feed["events"][0]["sources"]))

    def test_verified_currency_and_basis_preserve_the_original_consensus(self):
        event = earnings.parse_marketbeat(sample(), "MSFT", URL, NOW)[1]
        original = copy.deepcopy(event)
        correction = {"source_url": "https://example.com/issuer/2026-q4-results", "report_url": event["report_url"],
                      "verified_actuals": {"currency": "CAD", "provider_currency": "USD", "eps": 1.28,
                          "eps_basis": {"actual": "adjusted", "estimate": "adjusted"},
                          "verified_at": NOW.isoformat(), "reason": "Issuer reports CAD; provider consensus remains USD."}}
        highlights = {"reports": {"MSFT:2026-07-29": correction}}
        feed = {"company_symbol": "MSFT", "events": [event]}
        earnings.apply_verified_actuals(feed, highlights)
        self.assertEqual((event["eps"]["actual"], event["eps"]["currency"]), (1.28, "CAD"))
        self.assertEqual(event["eps"]["estimate"], original["eps"]["estimate"])
        self.assertEqual(event["eps"]["estimate_currency"], "USD")
        self.assertEqual(event["eps"]["verified_correction"]["provider_currency"], "USD")
        self.assertEqual(event["revenue"], original["revenue"])
        once = copy.deepcopy(feed)
        self.assertEqual(earnings.apply_verified_actuals(feed, highlights), once)
        # A correction can qualify a previously ambiguous basis without changing
        # the already correct GAAP actual, its source date or its estimate.
        correction["verified_actuals"] = {"currency": "USD", "eps": original["eps"]["actual"],
            "eps_basis": {"actual": "gaap", "estimate": "adjusted"},
            "verified_at": NOW.isoformat(), "reason": "GAAP actual and adjusted consensus."}
        event = copy.deepcopy(original)
        earnings.apply_verified_actuals({"company_symbol": "MSFT", "events": [event]}, highlights)
        self.assertEqual(event["eps"]["actual"], original["eps"]["actual"])
        self.assertEqual(event["eps"]["actual_basis"], "gaap")
        for field, value in [("provider_currency", "XYZ"), ("source_url", "javascript:alert(1)"), ("eps_basis", {"actual":"gaap"}),
                             ("eps_basis", {"actual":"gaap", "estimate":"unknown"})]:
            invalid = copy.deepcopy(correction); invalid["verified_actuals"][field] = value
            self.assertFalse(earnings.valid_actuals(invalid))

    def test_verified_provider_actuals_are_traced_and_notes_only_preserves_figures(self):
        event = earnings.parse_marketbeat(sample(), "MSFT", URL, NOW)[1]
        original = copy.deepcopy(event)
        review = {"source_url": "https://example.com/issuer/2026-q4-results", "report_url": event["report_url"],
                  "messages": ["La demande accélère.", "Les perspectives sont relevées.", "Les marges restent sous pression."],
                  "verified_actuals": {"currency": "USD", "revenue": 2.3e9, "verified_at": NOW.isoformat(),
                                       "reason": "Revenus du communiqué officiel; erreur du fournisseur."}}
        highlights = {"schema_version": 1, "kind": "reviewed_earnings_highlights", "reviewed_at": NOW.isoformat(),
                      "reports": {"MSFT:2026-07-29": review}}
        self.assertEqual(earnings.validate_reviewed_highlights(highlights), 1)
        feed = {"company_symbol": "MSFT", "events": [event], "fetched_at": NOW.isoformat()}
        earnings.apply_reviewed_messages(feed, highlights)
        self.assertEqual(event["revenue"], original["revenue"])
        earnings.apply_verified_actuals(feed, highlights)
        self.assertEqual(event["revenue"]["actual"], 2.3e9)
        self.assertEqual(event["revenue"]["estimate"], original["revenue"]["estimate"])
        self.assertEqual(event["eps"], original["eps"])
        self.assertEqual(event["report_at"], original["report_at"])
        self.assertEqual(feed["fetched_at"], NOW.isoformat())
        trace = event["revenue"]["verified_correction"]
        self.assertEqual(trace["provider_actual"], original["revenue"]["actual"])
        self.assertEqual(trace["provider_source_url"], original["revenue"]["source_url"])
        self.assertEqual(event["revenue"]["source_url"], review["source_url"])
        once = copy.deepcopy(feed)
        self.assertEqual(earnings.apply_verified_actuals(feed, highlights), once)
        for change in ({"report_date": "2026-07-30"}, {"report_url": None}, {"date_status": "estimated"}):
            other = copy.deepcopy(original); other.update(change)
            earnings.apply_verified_actuals({"company_symbol": "MSFT", "events": [other]}, highlights)
            self.assertEqual(other["revenue"], original["revenue"])
        other = copy.deepcopy(original); other["revenue"]["currency"] = "CAD"
        earnings.apply_verified_actuals({"company_symbol": "MSFT", "events": [other]}, highlights)
        self.assertEqual(other["revenue"]["actual"], original["revenue"]["actual"])
        for value in (float("nan"), float("inf"), -1, True):
            invalid = copy.deepcopy(highlights)
            invalid["reports"]["MSFT:2026-07-29"]["verified_actuals"]["revenue"] = value
            with self.assertRaises(earnings.SourceError):
                earnings.validate_reviewed_highlights(invalid)


if __name__ == "__main__":
    unittest.main()
