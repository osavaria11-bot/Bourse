from datetime import datetime, timezone
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("valuation_history", ROOT / "scripts/collect_valuation_history.py")
H = importlib.util.module_from_spec(spec)
spec.loader.exec_module(H)
NOW = datetime(2026, 10, 28, 22, tzinfo=timezone.utc)


def stamp(day):
    return datetime.fromisoformat(day + "T20:00:00+00:00").timestamp() * 1000


def source():
    days = ["2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29"]
    return {"error": False, "data": [{"P/E (Estimate)": [[stamp(d), 20 + i] for i, d in enumerate(days)],
        "P/E (Released)": [[stamp("2025-12-31"), 3]],
        "Synthetic stock": [[stamp(d), 100] for d in days if d not in ["2026-10-24", "2026-10-25"]]}, ["marketscreener.com", "x", "USD"]]}


class ProviderHistoryTests(unittest.TestCase):
    def test_only_source_price_sessions_without_weekends_or_future_projection(self):
        metric = H.normalize(source(), "pe", NOW)
        self.assertEqual([d for d, _ in metric["points"]], ["2026-10-23", "2026-10-26", "2026-10-27", "2026-10-28"])
        self.assertEqual(metric["points"][-1][1], 25)
        self.assertIsNone(metric["horizon_months"])
        self.assertFalse(metric["point_in_time_verified"])

    def test_missing_estimate_is_a_gap_and_realized_values_are_never_substituted(self):
        data = source()
        data["data"][0]["P/E (Estimate)"] = data["data"][0]["P/E (Estimate)"][:4]
        metric = H.normalize(data, "pe", NOW)
        self.assertEqual(metric["points"][-1], ["2026-10-28", None])
        self.assertEqual(metric["as_of"], "2026-10-28")

    def test_wrong_metric_and_ambiguous_company_are_refused(self):
        with self.assertRaises(ValueError): H.normalize(source(), "ev_ebitda", NOW)
        data = source();data["data"][0]["Other company"] = [[stamp("2026-10-28"), 22]]
        with self.assertRaises(ValueError): H.normalize(data, "pe", NOW)

    def test_incomplete_session_is_excluded(self):
        now = datetime(2026, 10, 28, 18, tzinfo=timezone.utc)
        metric = H.normalize(source(), "pe", now)
        self.assertEqual(metric["as_of"], "2026-10-27")


if __name__ == "__main__": unittest.main()
