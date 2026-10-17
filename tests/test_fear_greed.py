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

    def test_composite_history_is_sorted_deduplicated_and_ends_at_the_actual_score(self):
        def row(stamp, score):
            return {"x": datetime.fromisoformat(stamp).timestamp() * 1000, "y": score}
        history = [row("2026-10-16T12:00:00+00:00", 23), row("2026-10-15T00:00:00+00:00", 32),
                   row("2026-10-16T00:00:00+00:00", 24), row("2026-10-14T00:00:00+00:00", 0),
                   row("2026-10-18T00:00:00+00:00", 19), {"x": True, "y": 20},
                   row("2026-10-13T00:00:00+00:00", 101), {"x": "bad", "y": 50}]
        raw = {"fear_and_greed": point(), "fear_and_greed_historical": {"data": history},
               "market_volatility_vix": {"data": [row("2026-10-15T00:00:00+00:00", 99)]}}
        with patch.object(cnn.macro, "fetch_text", return_value=json.dumps(raw)):
            result = cnn.collect(None, NOW)
        self.assertEqual(result["history"], [["2026-10-14", 0], ["2026-10-15", 32], ["2026-10-16", 18]])
        self.assertEqual(result["history_status"], "fresh")

    def test_history_uses_the_latest_observation_per_day_without_inventing_missing_days(self):
        def row(stamp, score):
            return {"x": datetime.fromisoformat(stamp).timestamp() * 1000, "y": score}
        raw = {"fear_and_greed_historical": {"data": [row("2026-10-12T18:00:00+00:00", 100),
               row("2026-10-12T00:00:00+00:00", 99), row("2026-10-14T00:00:00+00:00", 0)]}}
        history = cnn.cnn_history(raw, cnn.parse_index(point(), NOW), NOW)
        self.assertEqual(history, [["2026-10-12", 100], ["2026-10-14", 0], ["2026-10-16", 18]])

    def test_partial_history_failure_and_outage_keep_the_history_without_replacing_the_latest_score(self):
        old = cnn.collect(None, NOW - timedelta(hours=1), fetcher=lambda now: {
            **point(), "history": [["2026-10-14", 0], ["2026-10-15", 32]]})
        partial = cnn.collect(old, NOW, fetcher=lambda now: point(0))
        self.assertEqual(partial["fetch_status"], "fresh")
        self.assertEqual(partial["history_status"], "cached")
        self.assertEqual(partial["history"], [["2026-10-14", 0], ["2026-10-15", 32], ["2026-10-16", 0]])
        with patch.object(cnn.macro, "fetch_text", side_effect=cnn.macro.SourceError("outage")):
            outage = cnn.collect(partial, NOW)
        self.assertEqual(outage["history"], partial["history"])
        self.assertEqual(outage["history_status"], "cached")
        self.assertEqual(outage["last_successful_fetch"], partial["last_successful_fetch"])

    def test_invalid_or_absent_history_does_not_hide_a_valid_current_score(self):
        for history in (None, {}, [["2026-02-30", 20]], [["2026-10-18", 20]], [["2026-10-15", True]]):
            with self.subTest(history=history):
                result = cnn.collect(None, NOW, fetcher=lambda now: {**point(), "history": history})
                self.assertEqual(result["score"], 18)
                self.assertEqual(result["fetch_status"], "fresh")
                self.assertEqual(result["history"], [])
                self.assertEqual(result["history_status"], "unavailable")

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
