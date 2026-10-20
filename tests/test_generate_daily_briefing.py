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

class NumercoTests(unittest.TestCase):
    def item(self):
        return {**definition("URANIUMSPOT"), "provider": "numerco", "frequency": "daily", "unit": "$ US/livre"}

    def test_spot_field_and_observation_dates_are_independent_of_fund_price_and_upload_date(self):
        payload = {"result": [
            {"Date": "9-Oct-26", "SpotPrice": 84.125, "ImpliedPrice": 61, "createdAt": "2026-10-10T10:00:00Z"},
            {"Date": "8-Oct-26", "SpotPrice": "83.75", "ImpliedPrice": 60},
            {"Date": "11-Oct-26", "SpotPrice": 999},
        ]}
        self.assertEqual(generator.parse_numerco_observations(json.dumps(payload), NOW.date()),
                         [["2026-10-08", 83.75], ["2026-10-09", 84.125]])

    def test_invalid_or_implied_only_prices_never_become_spot_observations(self):
        rows = [{"Date": "8-Oct-26", "ImpliedPrice": 67},
                {"Date": "31-Sep-26", "SpotPrice": 80},
                *[{"Date": "9-Oct-26", "SpotPrice": value} for value in (None, True, 0, -1, "NaN", "inf", "bad")], None]
        for payload in ("<html>outage</html>", "[]", '{"results": []}', json.dumps({"result": rows})):
            with self.subTest(payload=payload), self.assertRaises(generator.SourceError):
                generator.parse_numerco_observations(payload, NOW.date())

    def test_public_history_download_collects_and_attributes_the_registered_series(self):
        page = 'Parse.serverURL = "' + generator.NUMERCO_API_BASE + '"; Parse.initialize("public-app", "public-js");'
        payload = json.dumps({"result": [{"Date": "9-Oct-26", "SpotPrice": 84.125}]})
        with patch.object(generator, "fetch_text", side_effect=[page, payload]) as fetch:
            result = generator.fetch_series(self.item(), NOW)
        self.assertEqual((result["date"], result["value"], result["source_label"]), ("2026-10-09", 84.125, "Numerco"))
        self.assertEqual(result["source_url"], "https://numerco.com/UHistory/")
        self.assertEqual(fetch.call_args_list[0].args, (generator.NUMERCO_URANIUM_URL,))
        self.assertEqual(json.loads(fetch.call_args.kwargs["data"]), {"object_type": "UHistory", "only_objectId": False})
        self.assertEqual(fetch.call_args.kwargs["headers"]["X-Parse-Javascript-Key"], "public-js")
        with patch.object(generator, "fetch_text", return_value='<html>download unavailable</html>'), self.assertRaises(generator.SourceError):
            generator.fetch_series(self.item(), NOW)

    def test_outage_keeps_only_same_provider_history_and_original_dates(self):
        item = self.item()
        cached = generator.summarize(item, [["2026-10-08", 83.75], ["2026-10-09", 84.125]], NOW)
        def fetch(item, now):
            if item["id"] == "TEST": return point()
            raise generator.SourceError("synthetic outage")
        for provider, expected in (("numerco", "cached"), ("fred", "unavailable")):
            with self.subTest(provider=provider):
                previous = {"series": [{**cached, "provider": provider}]}
                result = generator.collect_sources([definition(), item], previous, NOW, fetcher=fetch)
                uranium = result["series"][1]
                self.assertEqual(uranium["fetch_status"], expected)
                self.assertEqual(uranium["date"], cached["date"] if provider == "numerco" else None)
                self.assertEqual(uranium["history"], cached["history"] if provider == "numerco" else [])
                self.assertEqual(uranium["source_label"], "Numerco")
                self.assertIn("Numerco", result["data_provider"])

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

class BankOfCanadaTests(unittest.TestCase):
    def setUp(self):
        self.definition = {**definition("V39079"), "provider": "bank_of_canada", "frequency": "daily"}
        self.payload = {"seriesDetail": {"V39079": {"label": "Target for the overnight rate"}}, "observations": [
            {"d": "2026-10-09", "V39079": {"v": "2.50"}},
            {"d": "2026-10-08", "V39079": {"v": "2.50"}},
            {"d": "2026-10-09", "V39079": {"v": "2.25"}},
            {"d": "2026-10-10", "V39079": {"v": "NA"}},
            {"d": "2026-10-11", "V39079": {"v": "99"}},
            {"d": "2026-10-07", "V39079": {"v": "NaN"}},
            {"d": "2026-10-06", "V39079": {"v": True}},
            {"d": "bad", "V39079": {"v": "3"}},
        ]}

    def test_official_json_orders_effective_dates_and_rejects_invalid_values(self):
        self.assertEqual(generator.parse_bank_observations(json.dumps(self.payload), "V39079", NOW.date()),
                         [["2026-10-08", 2.5], ["2026-10-09", 2.25], ["2026-10-10", None]])

    def test_wrong_series_and_invalid_json_are_rejected(self):
        for payload in ("<html>unavailable</html>", "[]", json.dumps({**self.payload, "seriesDetail": {"WRONG": {}}})):
            with self.subTest(payload=payload), self.assertRaises(generator.SourceError):
                generator.parse_bank_observations(payload, "V39079", NOW.date())

    def test_fetch_uses_valet_and_preserves_the_official_source(self):
        with patch.object(generator, "fetch_text", return_value=json.dumps(self.payload)) as fetch:
            result = generator.fetch_series(self.definition, NOW)
        self.assertIn("bankofcanada.ca/valet/observations/V39079/json?start_date=2015-01-01&end_date=2026-10-10", fetch.call_args.args[0])
        self.assertEqual((result["date"], result["value"], result["change"]), ("2026-10-09", 2.25, -0.25))
        self.assertEqual(result["source_url"], generator.BANK_POLICY_URL)
        self.assertEqual(result["source_label"], "Banque du Canada")

    def test_outage_keeps_bank_dates_and_does_not_reuse_another_provider(self):
        cached = generator.summarize(self.definition, [["2026-10-08", 2.25]], NOW)
        with patch.object(generator, "fetch_series", side_effect=generator.SourceError("outage")):
            result = generator.collect_sources([self.definition], {"series": [cached]}, NOW)
        self.assertEqual(result["series"][0]["fetch_status"], "cached")
        self.assertEqual(result["series"][0]["date"], "2026-10-08")
        self.assertEqual(result["series"][0]["source_url"], generator.BANK_POLICY_URL)
        self.assertFalse(generator.usable_previous({**cached, "provider": "fred"}, self.definition, NOW.date()))

class CanadaLabourTests(unittest.TestCase):
    def setUp(self):
        self.definition = {**definition("V2062815"), "provider": "statistics_canada", "vector_id": 2062815}
        self.payload = [{"status": "SUCCESS", "object": {
            "responseStatusCode": 0, "productId": 14100287, "vectorId": 2062815,
            "vectorDataPoint": [self.row("2026-09-01", 6.5), self.row("2026-08-01", 6.4)]}}]

    @staticmethod
    def row(day, value, **changes):
        return {"refPer": day, "value": value, "frequencyCode": 6, "scalarFactorCode": 0,
                "securityLevelCode": 0, "releaseTime": "2026-10-09T08:30", **changes}

    def test_reference_month_is_not_replaced_by_release_date(self):
        rows = generator.parse_canada_labour_observations(json.dumps(self.payload), NOW.date())
        self.assertEqual(rows, [["2026-08-01", 6.4], ["2026-09-01", 6.5]])

    def test_invalid_future_nonmonthly_and_private_values_are_rejected(self):
        self.payload[0]["object"]["vectorDataPoint"] += [
            self.row("2026-11-01", 99), self.row("bad", 10), self.row("2026-07-01", True),
            self.row("2026-06-01", None), self.row("2026-05-01", float("nan")),
            self.row("2026-04-01", 1000), self.row("2026-03-01", -1),
            self.row("2026-02-01", 10, scalarFactorCode=3),
            self.row("2026-01-01", 10, frequencyCode=12),
            self.row("2025-12-01", 10, securityLevelCode=1),
        ]
        self.assertEqual(generator.parse_canada_labour_observations(json.dumps(self.payload), NOW.date()),
                         [["2026-08-01", 6.4], ["2026-09-01", 6.5]])

    def test_wrong_vector_failed_response_and_invalid_json_are_rejected(self):
        for payload in ("<html>outage</html>", "{}", "[]",
                        json.dumps([{**self.payload[0], "status": "FAILED"}]),
                        json.dumps([{"status": "SUCCESS", "object": {**self.payload[0]["object"], "vectorId": 999}}])):
            with self.subTest(payload=payload), self.assertRaises(generator.SourceError):
                generator.parse_canada_labour_observations(payload, NOW.date())

    def test_fetch_uses_direct_statcan_data_with_monthly_change_in_points(self):
        with patch.object(generator, "fetch_text", return_value=json.dumps(self.payload)) as fetch:
            result = generator.fetch_series(self.definition, NOW)
        self.assertIn("www150.statcan.gc.ca/t1/wds/rest/getDataFromVectorByReferencePeriodRange?vectorIds=2062815&startRefPeriod=2015-01-01&endReferencePeriod=2026-10-10", fetch.call_args.args[0])
        self.assertEqual((result["date"], result["value"], result["change"]), ("2026-09-01", 6.5, 0.1))
        self.assertEqual(result["source_url"], generator.CANADA_LABOUR_URL)
        self.assertEqual(result["source_label"], "Statistique Canada")
        with patch.object(generator, "fetch_series", side_effect=generator.SourceError("outage")):
            fallback = generator.collect_sources([self.definition], {"series": [result]}, NOW)
        self.assertEqual(fallback["series"][0]["fetch_status"], "cached")
        self.assertEqual(fallback["series"][0]["date"], "2026-09-01")
        self.assertEqual(fallback["series"][0]["history"], result["history"])

class CanadaInflationTests(unittest.TestCase):
    def payload(self, series_id, rows):
        spec = generator.STATCAN_SERIES[series_id]
        return json.dumps([{"status": "SUCCESS", "object": {
            "responseStatusCode": 0, "vectorId": spec["vector_id"], "productId": spec["product_id"],
            "vectorDataPoint": [CanadaLabourTests.row(day, value) for day, value in rows]}}])

    def test_cpi_index_above_100_is_transformed_once_to_annual_inflation(self):
        item = {**definition("V41690973", "yoy"), "provider": "statistics_canada", "vector_id": 41690973}
        payload = self.payload(item["id"], [["2025-08-01", 160], ["2025-09-01", 161],
                                           ["2026-08-01", 164], ["2026-09-01", 167]])
        with patch.object(generator, "fetch_text", return_value=payload):
            result = generator.fetch_series(item, NOW)
        self.assertAlmostEqual(result["value"], (167 / 161 - 1) * 100, places=6)
        self.assertEqual(result["previous_value"], 2.5)
        self.assertTrue(result["source_url"].endswith("pid=1810000401"))

    def test_core_inflation_remains_an_annual_rate_including_negative_values(self):
        for series_id in ("V108785715", "V108785714"):
            with self.subTest(series_id=series_id):
                item = {**definition(series_id), "provider": "statistics_canada",
                        "vector_id": generator.STATCAN_SERIES[series_id]["vector_id"]}
                payload = self.payload(series_id, [["2026-08-01", 0.1], ["2026-09-01", -0.2]])
                with patch.object(generator, "fetch_text", return_value=payload):
                    result = generator.fetch_series(item, NOW)
                self.assertEqual((result["value"], result["change"]), (-0.2, -0.3))
                self.assertTrue(result["source_url"].endswith("pid=1810025601"))

    def test_wrong_table_or_vector_never_replaces_a_valid_series(self):
        payload = json.loads(self.payload("V41690973", [["2026-09-01", 167]]))
        payload[0]["object"]["productId"] = 14100287
        with self.assertRaises(generator.SourceError):
            generator.parse_statcan_observations(json.dumps(payload), "V41690973", NOW.date())
        item = {**definition("V41690973", "yoy"), "provider": "statistics_canada", "vector_id": 41690973}
        cached = generator.summarize(item, [["2026-09-01", 2.0]], NOW)
        self.assertFalse(generator.usable_previous({**cached, "vector_id": 999}, item, NOW.date()))
        with patch.object(generator, "fetch_text") as fetch, self.assertRaises(generator.SourceError):
            generator.fetch_series({**item, "vector_id": 999}, NOW)
        fetch.assert_not_called()

class ConfigurationTests(unittest.TestCase):
    def test_unique_complete_indicator_definitions(self):
        config = generator.read_json(generator.ROOT / "data/series.json")
        ids = [item["id"] for item in config["series"]]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(len(ids), 42)
        self.assertEqual(config["series"][ids.index("NYFEDRECPROB")]["provider"], "new_york_fed")
        self.assertEqual(ids[ids.index("UNRATE") + 1], "V2062815")
        self.assertEqual(config["series"][ids.index("V2062815")]["provider"], "statistics_canada")
        self.assertIn("DFEDTARL", ids)
        self.assertIn("DFEDTARU", ids)
        self.assertNotIn("DFF", ids)
        self.assertEqual(config["series"][ids.index("V39079")]["provider"], "bank_of_canada")
        self.assertEqual(ids[ids.index("DEXCAUS") + 1], "V39079")
        by_id = {item["id"]: item for item in config["series"]}
        self.assertNotIn("PURANUSDM", by_id)
        self.assertEqual(by_id["URANIUMSPOT"]["provider"], "numerco")
        self.assertEqual(by_id["URANIUMSPOT"]["frequency"], "daily")
        self.assertEqual(by_id["V41690973"]["transform"], "yoy")
        for sid in ("V108785715", "V108785714", "ICSA", "IC4WSA", "DFII10"):
            self.assertEqual(by_id[sid]["transform"], "none")
        for sid in ("ICSA", "IC4WSA"):
            self.assertEqual(by_id[sid]["frequency"], "weekly")
        for item in config["series"]:
            self.assertIn(item["frequency"], ("daily", "weekly", "monthly", "quarterly"))
            self.assertIn(item["transform"], ("none", "yoy", "mom_change", "qoq_annualized"))
            self.assertGreater(item["max_age_days"], 0)
            self.assertTrue(item["description"])

if __name__ == "__main__":
    unittest.main()

