"""Check dated swap-implied odds never turn into unsourced current probabilities."""
import unittest
from datetime import date, datetime, timezone

from scripts import collect_rate_odds as odds

NOW = datetime(2026, 10, 11, 14, tzinfo=timezone.utc)
HTML = """<html><script>Hike 99% Hold 1% Cut 0%</script><h1>Forecast</h1>
Current overnight rate 2.25% Next meeting: <b>28 Oct 2026</b>
Market-implied move +7 bp <span>Hike <b>28%</b> Hold <b>72%</b> Cut <b>0%</b></span>
As of <b>09 Oct 2026</b> , overnight index swap pricing implies a 72% probability of holding.</html>"""

class RateOddsTests(unittest.TestCase):
    def test_reads_visible_source_odds_and_real_date(self):
        row = odds.parse_page(HTML, "canada", NOW.date())
        self.assertEqual((row["hike"], row["hold"], row["cut"]), (28, 72, 0))
        self.assertEqual((row["as_of"], row["meeting_date"]), ("2026-10-09", "2026-10-28"))

    def test_rejects_stale_page_past_meeting_and_bad_total(self):
        for text, day in [(HTML, date(2026, 10, 20)), (HTML, date(2026, 10, 29)),
                          (HTML.replace("72%", "50%"), NOW.date())]:
            with self.subTest(day=day), self.assertRaises(odds.macro.SourceError):
                odds.parse_page(text, "canada", day)

    def test_independent_outage_retains_observation_date(self):
        previous = {"decisions": [odds.parse_page(HTML, "canada", NOW.date())]}
        result = odds.collect(previous, NOW, fetcher=lambda url: (_ for _ in ()).throw(ValueError("offline")))
        self.assertEqual([row["status"] for row in result["decisions"]], ["unavailable", "cached"])
        self.assertEqual(result["decisions"][1]["as_of"], "2026-10-09")

if __name__ == "__main__":
    unittest.main()
