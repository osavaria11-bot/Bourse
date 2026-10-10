"""Numerical and outage regression tests. All observations here are synthetic."""
import io
import json
import tempfile
import unittest
from datetime import date, datetime, timezone
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

from scripts import generate_daily_briefing as generator

NOW = datetime(2026, 10, 10, 16, 0, tzinfo=timezone.utc)

def definition(series_id="TEST", transform="none"):
    return {"id": series_id, "title": "Test", "category": "Test", "unit": "%",
            "decimals": 2, "transform": transform, "frequency": "monthly", "max_age_days": 60}

def point(series_id="TEST"):
    return generator.summarize(definition(series_id), [["2026-08-01", 3.1], ["2026-09-01", 3.2]], NOW)

class CSVTests(unittest.TestCase):
    def test_bom_quoted_csv_and_missing_values(self):
        text = '\ufeffobservation_date,TEST\n2026-08-01,"2.5"\n2026-08-02,.\n2026-08-03,NaN\n2026-08-04,inf\n2026-08-05,-1.25\n'
        self.assertEqual(generator.parse_observations(text, "TEST", NOW.date()),
                         [["2026-08-01", 2.5], ["2026-08-02", None], ["2026-08-05", -1.25]])

    def test_order_duplicates_and_future_dates(self):
        text = "DATE,TEST\n2026-09-01,1\n2026-08-01,2\n2026-09-01,3\n2026-10-11,100\nbad,10\n"
        self.assertEqual(generator.parse_observations(text, "TEST", NOW.date()),
                         [["2026-08-01", 2.0], ["2026-09-01", 3.0]])

    def test_html_response_is_rejected(self):
        with self.assertRaises(generator.SourceError):
            generator.parse_observations("<html>rate limited</html>", "TEST", NOW.date())

    def test_no_valid_numeric_observations_is_rejected(self):
        with self.assertRaises(generator.SourceError):
            generator.parse_observations("DATE,TEST\n2026-09-01,.\n", "TEST", NOW.date())

class TransformationTests(unittest.TestCase):
    def test_year_over_year_uses_calendar_not_row_offset(self):
        rows = [["2025-08-01", 100], ["2026-07-01", 108], ["2026-08-01", 110]]
        self.assertEqual(generator.transform_observations(rows, "yoy"),
                         [["2025-08-01", None], ["2026-07-01", None], ["2026-08-01", 10.0]])

    def test_quarterly_gdp_is_annualized(self):
        rows = [["2026-01-01", 100], ["2026-04-01", 101]]
        actual = generator.transform_observations(rows, "qoq_annualized")[-1][1]
        self.assertAlmostEqual(actual, 4.060401, places=6)

    def test_missing_quarter_is_not_treated_as_previous_quarter(self):
        rows = [["2026-01-01", 100], ["2026-07-01", 101]]
        self.assertIsNone(generator.transform_observations(rows, "qoq_annualized")[-1][1])

    def test_payrolls_report_net_change_in_thousands(self):
        rows = [["2026-08-01", 150000], ["2026-09-01", 150125]]
        self.assertEqual(generator.transform_observations(rows, "mom_change")[-1], ["2026-09-01", 125])

    def test_zero_denominator_and_missing_values_are_gaps(self):
        rows = [["2025-08-01", 0], ["2025-09-01", 100], ["2026-08-01", 110], ["2026-09-01", None]]
        self.assertIsNone(generator.transform_observations(rows, "yoy")[-2][1])
        self.assertIsNone(generator.transform_observations(rows, "yoy")[-1][1])

    def test_last_valid_date_and_actual_previous_date(self):
        result = generator.summarize(definition(), [["2026-09-01", 3], ["2026-09-04", 4], ["2026-09-05", None]], NOW)
        self.assertEqual((result["date"], result["previous_date"], result["change"]), ("2026-09-04", "2026-09-01", 1))

class ResilienceTests(unittest.TestCase):
    def test_macro_refresh_never_overwrites_the_news_edition(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "data").mkdir()
            (root / "data/series.json").write_text(json.dumps({"series": [definition()]}))
            news = root / "data/daily-briefing.json"
            news.write_text('{"edition": "verified news, independent of macro collection"}\n')
            original = news.read_bytes()
            with patch.object(generator, "ROOT", root), patch("sys.argv", ["collector"]), patch.object(generator, "fetch_series", return_value=point()):
                generator.main()
            self.assertEqual(news.read_bytes(), original)
            self.assertTrue((root / "data/macro-data.json").is_file())
            self.assertTrue((root / "data/macro-briefing.json").is_file())

    def test_partial_failure_keeps_independent_successes_and_cached_dates(self):
        old = point("B")
        old["last_successful_fetch"] = "2026-10-08T12:00:00+00:00"
        previous = {"series": [old], "last_successful_update": "2026-10-08T12:00:00+00:00"}
        def fetch(item, now):
            if item["id"] == "A": return point("A")
            raise generator.SourceError("synthetic outage")
        with patch.object(generator, "fetch_series", side_effect=fetch):
            result = generator.collect_sources([definition("A"), definition("B"), definition("C")], previous, NOW)
        self.assertEqual(result["coverage"], {"total": 3, "fresh": 1, "cached": 1, "unavailable": 1})
        self.assertEqual([p["fetch_status"] for p in result["series"]], ["fresh", "cached", "unavailable"])
        self.assertEqual(result["series"][1]["last_successful_fetch"], old["last_successful_fetch"])
        self.assertEqual(result["last_successful_update"], previous["last_successful_update"])

    def test_failed_sources_do_not_mix_old_transform_with_new_transform(self):
        previous = {"series": [point()], "last_successful_update": "old"}
        with patch.object(generator, "fetch_series", side_effect=generator.SourceError("outage")):
            with self.assertRaises(generator.SourceError):
                generator.collect_sources([definition(transform="yoy")], previous, NOW)

    def test_all_failed_with_no_cache_raises(self):
        with patch.object(generator, "fetch_series", side_effect=generator.SourceError("outage")):
            with self.assertRaises(generator.SourceError):
                generator.collect_sources([definition()], None, NOW)

    def test_atomic_replace_failure_preserves_previous_json_and_cleans_temp(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "data.json"
            output.write_text('{"original": true}\n')
            with patch.object(generator.os, "replace", side_effect=OSError("synthetic failure")):
                with self.assertRaises(OSError):
                    generator.atomic_write_json(output, {"new": 1})
            self.assertEqual(json.loads(output.read_text()), {"original": True})
            self.assertEqual(len(list(Path(directory).iterdir())), 1)

    def test_nonfinite_json_never_replaces_valid_file(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "data.json"
            output.write_text('{"original": true}\n')
            with self.assertRaises(ValueError):
                generator.atomic_write_json(output, {"value": float("nan")})
            self.assertEqual(json.loads(output.read_text()), {"original": True})

    def test_http_429_is_retried_but_404_is_not(self):
        rate_limit = HTTPError("https://example.test", 429, "Rate limit", {}, None)
        with patch.object(generator, "urlopen", side_effect=[rate_limit, io.BytesIO(b"ok")]) as request, patch.object(generator.time, "sleep"):
            self.assertEqual(generator.fetch_text("https://example.test"), "ok")
            self.assertEqual(request.call_count, 2)
        missing = HTTPError("https://example.test", 404, "Not found", {}, None)
        with patch.object(generator, "urlopen", side_effect=missing) as request, patch.object(generator.time, "sleep"):
            with self.assertRaises(generator.SourceError):
                generator.fetch_text("https://example.test")
            self.assertEqual(request.call_count, 1)

    def test_migration_keeps_authentic_snapshot_and_does_not_invent_previous_date(self):
        legacy = {"last_successful_update": "2026-10-08T12:00:00Z", "series_snapshot": [
            {"id": "TEST", "date": "2026-09-01", "value": 2.5, "previous_value": 2.4},
            {"id": "CPIAUCSL", "date": "2026-09-01", "value": 300},
        ]}
        migrated = generator.migrate_previous([definition(), definition("CPIAUCSL", "yoy")], legacy)
        self.assertEqual(len(migrated["series"]), 1)
        self.assertEqual(migrated["series"][0]["history"], [["2026-09-01", 2.5]])
        self.assertIsNone(migrated["series"][0]["change"])
        self.assertNotIn("previous_date", migrated["series"][0])

    def test_briefing_uses_correct_currency_unit_and_observation_date(self):
        fx = point("DEXCAUS")
        fx.update(title="USD/CAD", unit="$ CA/$ US", value=1.4253, decimals=4)
        result = generator.build_paragraph({"DEXCAUS": fx})
        self.assertIn("1,4253 $ CA/$ US", result)
        self.assertIn("2026-09-01", result)

class ConfigurationTests(unittest.TestCase):
    def test_unique_complete_indicator_definitions(self):
        config = generator.read_json(generator.ROOT / "data/series.json")
        ids = [item["id"] for item in config["series"]]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(len(ids), 33)
        for item in config["series"]:
            self.assertIn(item["frequency"], ("daily", "weekly", "monthly", "quarterly"))
            self.assertIn(item["transform"], ("none", "yoy", "mom_change", "qoq_annualized"))
            self.assertGreater(item["max_age_days"], 0)
            self.assertTrue(item["description"])

if __name__ == "__main__":
    unittest.main()
