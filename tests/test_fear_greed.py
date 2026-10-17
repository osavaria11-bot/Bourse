"""CNN sentiment contracts and outage handling; all test values are synthetic."""
import json
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from scripts import collect_fear_greed as cnn

NOW = datetime(2026, 10, 17, 13, 36, tzinfo=timezone.utc)


def point(score=18):
    return {"score": score, "rating": "extreme fear", "timestamp": "2026-10-16T23:59:49+00:00", "previous_close": 32}


class FearGreedTests(unittest.TestCase):
    def test_zero_and_one_hundred_are_real_scores_and_publication_time_is_preserved(self):
        for score in (0, 18.125, 100):
            with self.subTest(score=score):
                result = cnn.parse_index(point(score), NOW)
                self.assertEqual(result["score"], score)
                self.assertEqual(result["timestamp"], "2026-10-16T23:59:49Z")

    def test_invalid_score_rating_or_publication_is_rejected(self):
        bad = [None, {}, *[point(v) for v in (True, None, -1, 101, "18", float("nan"), float("inf"))],
               {**point(), "rating": "unknown"}, {**point(), "timestamp": "2026-10-16"},
               {**point(), "timestamp": "bad"}, {**point(), "timestamp": (NOW + timedelta(hours=1)).isoformat()}]
        for value in bad:
            with self.subTest(value=value), self.assertRaises(cnn.macro.SourceError):
                cnn.parse_index(value, NOW)

    def test_official_composite_is_used_without_substituting_a_component(self):
        raw = json.dumps({"fear_and_greed": point(), "market_volatility_vix": {"score": 99}})
        with patch.object(cnn.macro, "fetch_text", return_value=raw) as fetch:
            result = cnn.collect(None, NOW)
        self.assertEqual(result["score"], 18)
        self.assertEqual(result["provider"], "cnn")
        self.assertEqual(result["source_url"], cnn.SOURCE_URL)
        self.assertEqual(result["fetch_status"], "fresh")
        fetch.assert_called_once_with(cnn.DATA_URL, headers={"Referer": cnn.SOURCE_URL})

    def test_outage_preserves_the_exact_score_and_original_dates_including_zero(self):
        old = cnn.collect(None, NOW - timedelta(hours=1), fetcher=lambda now: point(0))
        def outage(now):
            raise cnn.macro.SourceError("synthetic outage")
        result = cnn.collect(old, NOW, fetcher=outage)
        self.assertEqual(result["score"], 0)
        self.assertEqual(result["fetch_status"], "cached")
        self.assertEqual(result["timestamp"], old["timestamp"])
        self.assertEqual(result["last_successful_fetch"], old["last_successful_fetch"])
        self.assertEqual(result["generated_at"], NOW.isoformat().replace("+00:00", "Z"))

    def test_first_failure_or_other_provider_never_creates_a_zero_or_a_cnn_rating(self):
        old = cnn.collect(None, NOW, fetcher=lambda now: point())
        for previous in (None, {**old, "provider": "crypto"}, {**old, "source_url": "https://example.test/"}):
            with self.subTest(previous=previous), patch.object(cnn.macro, "fetch_text", return_value="<html>outage</html>"):
                result = cnn.collect(previous, NOW)
                self.assertEqual(result["fetch_status"], "unavailable")
                self.assertIsNone(result["score"])
                self.assertIsNone(result["rating"])
                self.assertIsNone(result["timestamp"])


if __name__ == "__main__":
    unittest.main()
