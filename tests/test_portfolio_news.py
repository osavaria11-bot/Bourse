import json
import unittest
from xml.sax.saxutils import escape
from datetime import datetime, timedelta, timezone
from scripts import collect_portfolio_news as news


class PortfolioNewsTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 10, 11, 20, tzinfo=timezone.utc)
        self.microsoft = {"id": "MSFT", "title": "Microsoft", "quote_symbol": "MSFT"}

    def rss(self, title="Microsoft raises revenue outlook", source="Reuters", domain="https://www.reuters.com/", date="Fri, 09 Oct 2026 16:30:00 GMT"):
        title = escape(title)
        return f'<rss><channel><item><title>{title} - {source}</title><link>https://news.google.com/rss/articles/synthetic</link><pubDate>{date}</pubDate><source url="{domain}">{source}</source><description>Do not republish this article body.</description></item></channel></rss>'

    def test_rss_keeps_publisher_and_actual_publication_time_without_copying_article_bodies(self):
        rows = news.parse_rss(self.rss(), self.microsoft, self.now)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["publisher"], "Reuters")
        self.assertEqual(rows[0]["published_at"], "2026-10-09T16:30:00+00:00")
        self.assertEqual(rows[0]["event"], "guidance")
        self.assertNotIn("description", rows[0])
        self.assertNotIn("Do not republish", json.dumps(rows))

    def test_old_future_wrong_company_unknown_publisher_and_static_quote_pages_are_excluded(self):
        variants = [self.rss(date="Fri, 02 Oct 2026 16:30:00 GMT"), self.rss(date="Mon, 12 Oct 2026 16:30:00 GMT"),
                    self.rss(title="Apple raises revenue outlook"), self.rss(domain="https://fake.reuters.com.evil.test/"),
                    self.rss(title="Microsoft Stock Price Today"), self.rss(title="Microsoft (MSFT) latest stock news and headlines"),
                    self.rss(title="Microsoft (MSFT) Options Chain"), self.rss(title="Is Microsoft stock undervalued?"),
                    self.rss(title="Microsoft Analyst Ratings, Estimates & Forecasts"), self.rss(title="Here's How Much a $1000 Investment in Microsoft Made 10 Years Ago Would Be Worth Today")]
        for text in variants:
            self.assertEqual(news.parse_rss(text, self.microsoft, self.now), [])

    def test_company_aliases_preserve_canadian_identity_and_short_symbols_never_match_arbitrary_words(self):
        cibc = {"id": "CM", "title": "Canadian Imperial Bank of Commerce", "quote_symbol": "CM.TO"}
        self.assertTrue(news.mentions("CIBC reports quarterly results", cibc))
        visa = {"id": "V", "title": "Visa", "quote_symbol": "V"}
        self.assertFalse(news.mentions("Microsoft visa suspension sparks debate", visa))
        self.assertTrue(news.mentions("Visa raises dividend on strong payments growth", visa))
        self.assertEqual(news.event_for("Microsoft announces quarterly earnings release date"), "earnings_calendar")
        self.assertEqual(news.event_for("Shopify to Announce Third-Quarter 2026 Financial Results"), "earnings_calendar")

    def test_provider_failures_keep_only_dated_unexpired_items_and_original_fetch_time(self):
        item = news.parse_rss(self.rss(), self.microsoft, self.now)[0]
        old = {"instruments": {"MSFT": {"fetched_at": "2026-10-09T18:00:00+00:00", "items": [item, {**item, "id": "old", "published_at": "2026-09-01T00:00:00+00:00"}]}}}
        def failure(definition, now):
            raise RuntimeError("provider unavailable")
        result = news.collect([self.microsoft], old, self.now, fetcher=failure)
        self.assertEqual(result["coverage"], {"total": 1, "fresh": 0, "cached": 1, "unavailable": 0})
        self.assertEqual(result["instruments"]["MSFT"]["items"], [item])
        self.assertEqual(result["instruments"]["MSFT"]["fetched_at"], "2026-10-09T18:00:00+00:00")

    def test_empty_fresh_feeds_are_distinct_from_unavailable_sources_and_fallback_is_authenticated_by_publisher(self):
        empty = news.fetch_instrument(self.microsoft, self.now, fetcher=lambda url: '<rss><channel/></rss>' if "news.google.com" in url else '{"news":[]}')
        self.assertEqual(empty["fetch_status"], "fresh"); self.assertEqual(empty["items"], [])
        payload = {"news": [{"type": "STORY", "title": "Microsoft reports quarterly earnings", "publisher": "Reuters", "link": "https://finance.yahoo.com/news/synthetic", "providerPublishTime": int((self.now - timedelta(hours=1)).timestamp())}]}
        self.assertEqual(len(news.parse_yahoo(json.dumps(payload), self.microsoft, self.now)), 1)
        payload["news"][0]["publisher"] = "Unknown Blog"
        self.assertEqual(news.parse_yahoo(json.dumps(payload), self.microsoft, self.now), [])


if __name__ == "__main__":
    unittest.main()
