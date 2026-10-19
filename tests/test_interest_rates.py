"""Synthetic dated-publication tests: never manufacture a same-day yield."""
from copy import deepcopy
from datetime import date, datetime, timezone
import unittest

from scripts import refresh_interest_rates as rates

NOW = datetime(2026, 10, 19, 23, 0, tzinfo=timezone.utc)
NOMINAL = "Date,3 Mo,2 Yr,10 Yr\n10/16/2026,3.7,4.2,4.5\n10/19/2026,3.8,4.3,4.7\n"
REAL = "Date,5 YR,10 YR,30 YR\n10/16/2026,1.5,2,2.5\n10/19/2026,1.6,2.1,2.6\n"
POLICY = "<h1>Policy interest rate</h1><table><tr><td>September 2, 2026</td><td>2.25</td><td>---</td></tr></table>"


def fixture():
    values = {"DGS10": 4.5, "DFII10": 2, "T10Y2Y": .3, "T10Y3M": .8, "V39079": 2.25, "OTHER": 17}
    return {"schema_version": 2, "generated_at": NOW.isoformat(), "data_provider": "FRED / Banque du Canada", "series": [
        {"id": sid, "date": "2026-10-16", "value": value, "history": [["2026-10-15", value - .1], ["2026-10-16", value]],
         "fetch_status": "fresh", "last_successful_fetch": NOW.isoformat()} for sid, value in values.items()]}


def fetch(url):
    return POLICY if url == rates.POLICY_URL else REAL if "real_yield" in url else NOMINAL


class InterestRateTests(unittest.TestCase):
    def test_latest_primary_yields_and_same_day_spreads_preserve_accepted_history(self):
        before = fixture(); data = rates.enrich(before, NOW, fetch)
        self.assertEqual(before, fixture(), "Input snapshots must stay untouched")
        points = {p["id"]: p for p in data["series"]}
        for sid, expected in {"DGS10": 4.7, "DFII10": 2.1, "T10Y2Y": .4, "T10Y3M": .9}.items():
            p = points[sid]
            self.assertEqual((p["date"], p["value"]), ("2026-10-19", expected))
            self.assertEqual(p["history"][:-1], next(p for p in before["series"] if p["id"] == sid)["history"])
            self.assertEqual(p["previous_date"], "2026-10-16")
            self.assertEqual(p["observation_source"]["date"], p["date"])
        self.assertEqual(points["OTHER"], before["series"][-1])
        self.assertEqual(data["interest_rate_check"]["awaiting_publication"], [])

    def test_observation_date_is_never_relabelled_as_collection_date(self):
        def delayed(url): return fetch(url).split("10/19/2026")[0]
        data = rates.enrich(fixture(), NOW, delayed)
        self.assertTrue(all(p["date"] == "2026-10-16" for p in data["series"]))
        self.assertEqual(len(data["interest_rate_check"]["awaiting_publication"]), 4)
        policy = next(p for p in data["series"] if p["id"] == "V39079")
        self.assertEqual(policy["current_policy"]["value"], 2.25)
        self.assertEqual(policy["current_policy"]["verified_at"], NOW.isoformat())

    def test_source_outage_preserves_values_and_dates(self):
        def outage(url): raise OSError("Synthetic outage")
        before = fixture(); after = rates.enrich(before, NOW, outage)
        self.assertEqual(after["series"], before["series"])
        self.assertEqual(set(after["interest_rate_check"]["errors"]), {"nominal", "real", "policy"})

    def test_lagging_fred_cannot_erase_newer_primary_even_during_outage(self):
        previous = rates.enrich(fixture(), NOW, fetch)
        def outage(url): raise OSError("Synthetic outage")
        updated = rates.enrich(fixture(), NOW, outage, previous)
        for p in updated["series"]:
            if p["id"] in rates.POINTS:
                self.assertEqual(p["date"], "2026-10-19")
                self.assertEqual(p["fetch_status"], "cached")
                self.assertEqual(p["history"], next(old for old in previous["series"] if old["id"] == p["id"])["history"])

    def test_older_primary_does_not_replace_a_newer_observation(self):
        before = fixture()
        p = before["series"][0]; p.update(date="2026-10-19", value=4.8); p["history"].append([p["date"], p["value"]])
        def delayed(url): return fetch(url).split("10/19/2026")[0]
        after = rates.enrich(before, NOW, delayed)
        self.assertEqual(after["series"][0], before["series"][0])

    def test_previous_publication_requires_the_exact_source_date_and_valid_history(self):
        previous = rates.enrich(fixture(), NOW, fetch); point = previous["series"][0]
        self.assertTrue(rates.accepted_primary(point, NOW))
        for field, value in [("source_url", "https://example.com"), ("date", "2026-10-20"), ("checked_at", "2026-10-20T23:00:00Z")]:
            p = deepcopy(point); p["observation_source"][field] = value
            self.assertFalse(rates.accepted_primary(p, NOW))
        p = deepcopy(point); p["history"][-1][1] = 100
        self.assertFalse(rates.accepted_primary(p, NOW))

    def test_mismatched_same_date_source_does_not_rewrite_history(self):
        before = fixture(); before["series"][0]["history"][-1][1] = 4.6
        def delayed(url): return fetch(url).split("10/19/2026")[0]
        after = rates.enrich(before, NOW, delayed)
        self.assertEqual(after["series"][0], before["series"][0])
        self.assertIn("DGS10", after["interest_rate_check"]["errors"])

    def test_csv_contract_rejects_undated_wrong_invalid_and_conflicting_data(self):
        for text in ["<html>unavailable</html>", NOMINAL.replace("10 Yr", "wrong"), NOMINAL.replace("4.7", "NaN"),
                     NOMINAL + "10/19/2026,3.8,4.3,4.8\n"]:
            with self.subTest(text=text), self.assertRaises(ValueError): rates.treasury_rows(text, "nominal", NOW.date())
        rows = rates.treasury_rows(NOMINAL + "10/20/2026,3,4,5\n10/18/2026,3,4,5\n", "nominal", NOW.date())
        self.assertEqual(sorted(rows), ["2026-10-16", "2026-10-19"])

    def test_incomplete_tenors_never_mix_dates_to_calculate_spreads(self):
        data = rates.enrich(fixture(), NOW, lambda url: fetch(url).replace("3.8,4.3,4.7", "3.8,N/A,4.7"))
        points = {p["id"]: p for p in data["series"]}
        self.assertEqual(points["DGS10"]["date"], "2026-10-19")
        self.assertEqual(points["T10Y2Y"]["date"], "2026-10-16")
        self.assertEqual(points["T10Y3M"]["value"], .9)

    def test_policy_changes_only_take_effect_the_day_after_the_announcement(self):
        html = POLICY.replace("</table>", "<tr><td>October 19, 2026</td><td>2.00%</td><td>−0.25%</td></tr></table>")
        self.assertEqual(rates.policy_value(html, date(2026, 10, 19))["value"], 2.25)
        self.assertEqual(rates.policy_value(html, date(2026, 10, 20))["value"], 2)
        self.assertEqual(rates.policy_value(html, date(2026, 10, 20))["effective_date"], "2026-10-20")

    def test_policy_disagreement_never_claims_an_old_value_is_current(self):
        after = rates.enrich(fixture(), NOW, lambda url: POLICY.replace("2.25", "2.50") if url == rates.POLICY_URL else fetch(url))
        self.assertNotIn("current_policy", after["series"][-2])
        self.assertIn("policy", after["interest_rate_check"]["errors"])


if __name__ == "__main__": unittest.main()
