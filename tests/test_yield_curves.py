"""Synthetic yield data only: exact source contracts and one-date snapshots."""
import copy
import csv
import io
import json
import unittest
from datetime import date, datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse
from scripts import collect_yield_curves as curves

NOW = datetime(2026, 10, 15, 18, tzinfo=timezone.utc)
def csv_text(year=2026, bad=None):
    output = io.StringIO(); writer = csv.writer(output)
    writer.writerow(["Date", *[row[3] for row in curves.US_TENORS]])
    first = date(year, 1, 5)
    while first.weekday() >= 5: first += timedelta(days=1)
    writer.writerow([first.strftime("%m/%d/%Y"), *[bad if i == 0 and bad is not None else 2 + i / 10 for i in range(11)]])
    if year == 2026: writer.writerow(["10/14/2026", *[4 + i / 10 for i in range(11)]])
    return output.getvalue()
def ca_text():
    ids = [item[3] for item in curves.CA_TENORS]
    return json.dumps({"seriesDetail": {sid: {"label": sid} for sid in ids}, "observations": [{"d": "2026-10-14", **{sid: {"v": str(2 + i / 10)} for i, sid in enumerate(ids)}}]})
def fetch(url):
    return ca_text() if "bankofcanada" in url else csv_text(int(urlparse(url).path.split("/")[-2]))

class YieldCurveTests(unittest.TestCase):
    def test_us_exact_treasury_columns_sorted_dates_and_nulls(self):
        rows = curves.parse_us(csv_text(bad="N/A"), 2026, NOW.date())
        self.assertEqual(rows[0][0], "2026-01-05"); self.assertIsNone(rows[0][1]); self.assertEqual(len(rows[-1]), 12)
        with self.assertRaises(curves.macro.SourceError): curves.parse_us(csv_text().replace("30 Yr", "30 Yr TIPS"), 2026, NOW.date())

    def test_ca_uses_daily_ids_not_weekly_or_monthly_and_does_not_fill_gaps(self):
        payload = json.loads(ca_text()); sid = curves.CA_TENORS[4][3]; del payload["observations"][0][sid]
        row = curves.parse_ca(json.dumps(payload), NOW.date())[0]; self.assertIsNone(row[5]); self.assertEqual(row[-1], 2.9)
        del payload["seriesDetail"][sid]
        with self.assertRaises(curves.macro.SourceError): curves.parse_ca(json.dumps(payload), NOW.date())

    def test_negative_rates_valid_nonfinite_boolean_and_bad_strings_rejected(self):
        self.assertEqual(curves.number("-0.5"), -.5)
        for value in (True, float("nan"), float("inf"), "bad", 101):
            with self.subTest(value=value), self.assertRaises(curves.macro.SourceError): curves.number(value)

    def test_future_and_weekend_rows_do_not_become_published_observations(self):
        for value in ("2026-10-16", "2026-10-11", "2026-02-30", "2015-12-31"):
            self.assertIsNone(curves.observation_day(value, NOW.date()))

    def test_country_outage_preserves_history_and_original_success_time(self):
        previous = curves.collect(now=NOW, fetcher=fetch)
        result = curves.collect(previous, NOW, fetcher=lambda url: (_ for _ in ()).throw(OSError("offline")))
        self.assertEqual(result["coverage"], {"fresh": 0, "cached": 2, "unavailable": 0})
        for old, new in zip(previous["countries"], result["countries"]):
            self.assertEqual(new["history"], old["history"]); self.assertEqual(new["last_successful_fetch"], old["last_successful_fetch"])

    def test_independent_source_failure_does_not_remove_other_country(self):
        def mixed(url):
            if "bankofcanada" in url: raise OSError("offline")
            return fetch(url)
        result = curves.collect(now=NOW, fetcher=mixed)
        self.assertEqual(result["coverage"], {"fresh": 1, "cached": 0, "unavailable": 1}); self.assertEqual(result["countries"][1]["history"], [])

    def test_recent_history_only_reloads_current_treasury_year_and_uses_keyless_official_sources(self):
        previous = curves.collect(now=NOW, fetcher=fetch); urls = []
        def tracking(url): urls.append(url); return fetch(url)
        result = curves.collect(previous, NOW, fetcher=tracking)
        us = [url for url in urls if "treasury.gov" in url]
        self.assertEqual(len(us), 1); self.assertIn("/2026/all?", us[0]); self.assertEqual(result["countries"][0]["history"], previous["countries"][0]["history"])
        ca = next(url for url in urls if "bankofcanada" in url)
        self.assertIn("TB.CDN.90D.MID", ca); self.assertNotIn("V122", ca)
        self.assertEqual(parse_qs(urlparse(ca).query)["start_date"], ["2016-01-01"])

    def test_invalid_cached_series_and_regressing_provider_are_not_relabelled_fresh(self):
        previous = curves.collect(now=NOW, fetcher=fetch); old = copy.deepcopy(previous["countries"][1]); old["tenors"][4]["series_id"] = "V122538"
        self.assertFalse(curves.valid_cached(old, "CA", NOW.date()))
        def regressing(url):
            if "bankofcanada" in url:
                payload = json.loads(ca_text()); payload["observations"][0]["d"] = "2026-10-13"; return json.dumps(payload)
            return fetch(url)
        result = curves.collect(previous, NOW, fetcher=regressing)
        self.assertEqual(result["countries"][1]["fetch_status"], "cached"); self.assertEqual(result["countries"][1]["history"][-1][0], "2026-10-14")

if __name__ == "__main__": unittest.main()
