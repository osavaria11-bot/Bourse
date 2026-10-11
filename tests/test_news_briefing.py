"""Verify a selective briefing stays dated and sourced without a forced word quota."""
import copy
import unittest
from datetime import datetime, timezone

from scripts.validate_news_briefing import validate

NOW = datetime(2026, 10, 11, 14, tzinfo=timezone.utc)

def edition():
    return {"schema_version": 4, "kind": "news_digest", "language": "fr",
            "timezone": "America/Toronto", "edition_date": "2026-10-11",
            "generated_at": NOW.isoformat(), "stories": [{
                "topic": "Inflation", "title": "Une publication à surveiller",
                "summary": "Les prévisions d’inflation concernent une publication encore à venir et ne représentent donc pas un résultat déjà observé.",
                "impact": "Une surprise pourrait modifier les anticipations de taux.",
                "source_label": "Financial Times", "source_url": "https://www.ft.com/content/example",
                "published_date": "2026-10-11"}],
            "fred_watch": [{"series_id": sid, "title": "Graphique " + sid,
                            "explanation": "Ce graphique mérite une attention particulière pour comprendre le cycle.",
                            "observation_date": "2026-09-01",
                            "source_url": "https://fred.stlouisfed.org/series/" + sid}
                           for sid in ("CPIAUCSL", "PAYEMS", "DGS10")]}

class NewsBriefingTests(unittest.TestCase):
    def test_short_verified_edition_has_no_forced_word_quota(self):
        self.assertEqual(validate(edition(), NOW), 26)

    def test_future_old_duplicate_and_unsafe_publications_are_rejected(self):
        invalid = []
        for field, value in [("published_date", "2026-10-12"), ("published_date", "2026-09-01"),
                             ("source_url", "javascript:alert(1)"), ("impact", "")]:
            payload = edition()
            payload["stories"][0][field] = value
            invalid.append(payload)
        duplicate = edition()
        duplicate["stories"].append(copy.deepcopy(duplicate["stories"][0]))
        invalid.append(duplicate)
        future = edition()
        future["generated_at"] = "2026-10-11T15:00:00+00:00"
        invalid.append(future)
        missing_watch = edition()
        missing_watch["fred_watch"] = []
        invalid.append(missing_watch)
        wrong_link = edition()
        wrong_link["fred_watch"][0]["source_url"] = "https://example.com/fred"
        invalid.append(wrong_link)
        for payload in invalid:
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                validate(payload, NOW)

if __name__ == "__main__":
    unittest.main()
