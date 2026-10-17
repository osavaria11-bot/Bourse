"""Synthetic contracts for read-only Gamma event discovery and dated fallback."""
import json
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse
from scripts import collect_polymarket as poly

NOW = datetime(2026, 10, 17, 17, tzinfo=timezone.utc)
END = "2027-01-01T00:00:00Z"


def market(mid="100", label="Scenario A", probability=.65, **extra):
    return {"id": mid, "question": "Will scenario A occur?", "groupItemTitle": label, "active": True, "closed": False,
            "archived": False, "acceptingOrders": True, "endDate": END, "updatedAt": poly.iso(NOW),
            "outcomes": '["Yes","No"]', "outcomePrices": json.dumps([str(probability), str(1-probability)]), **extra}


def event(eid="1", volume=100, daily=10, **extra):
    return {"id": eid, "slug": "synthetic-event-" + str(eid), "title": "Synthetic event " + str(eid), "volume": volume,
            "volume24hr": daily, "active": True, "closed": False, "archived": False, "endDate": END,
            "markets": [market()], "tags": [], **extra}


def fetcher(kind, now, excluded):
    return [poly.parse_event(event(str(i)), now) for i in (range(1, 4) if kind == "finance" else range(4, 9))]


class PolymarketTests(unittest.TestCase):
    def test_yes_no_order_is_preserved_and_zero_and_one_are_valid(self):
        row = event(markets=[market(outcomes='["No","Yes"]', outcomePrices='["0.8","0.2"]')])
        parsed = poly.parse_event(row, NOW)
        self.assertEqual([(p["label"], p["probability"]) for p in parsed["outcomes"]], [("No", .8), ("Yes", .2)])
        parsed = poly.parse_event(event(markets=[market(probability=0)]), NOW)
        self.assertEqual([p["probability"] for p in parsed["outcomes"]], [1, 0])

    def test_multiple_markets_use_named_yes_prices_without_rescaling_or_summing(self):
        row = event(markets=[market("100", "Company A", .8), market("101", "Company B", .7),
                             market("102", "Resolved company", 1, closed=True)])
        result = poly.parse_event(row, NOW)
        self.assertEqual([(p["label"], p["probability"]) for p in result["outcomes"]], [("Company A", .8), ("Company B", .7)])
        # If the group label is absent, display the full question rather than generic Yes.
        row["markets"][0]["groupItemTitle"] = ""
        self.assertEqual(poly.parse_event(row, NOW)["outcomes"][0]["label"], "Will scenario A occur?")

    def test_closed_expired_resolved_or_non_trading_markets_are_skipped(self):
        for extra in ({"closed": True}, {"active": False}, {"archived": True}, {"acceptingOrders": False},
                      {"endDate": poly.iso(NOW)}, {"umaResolutionStatus": "resolved"}, {"umaResolutionStatus": "proposed"},
                      {"updatedAt": poly.iso(NOW + timedelta(hours=1))}):
            with self.subTest(extra=extra):
                self.assertIsNone(poly.parse_event(event(markets=[market(**extra)]), NOW))
        for extra in ({"closed": True}, {"active": False}, {"archived": True}, {"endDate": "2026-10-01T00:00:00Z"}):
            self.assertIsNone(poly.parse_event(event(**extra), NOW))

    def test_invalid_prices_and_unsafe_links_do_not_create_fake_zeroes(self):
        for prices in ('[null,"1"]', '[true,"0"]', '["NaN","0"]', '["1.1","0"]', '[".2",".2"]', '[]', 'bad'):
            self.assertIsNone(poly.parse_event(event(markets=[market(outcomePrices=prices)]), NOW))
        for extra in ({"slug": "../bad"}, {"slug": "javascript:bad"}, {"volume": True}, {"title": ""}):
            self.assertIsNone(poly.parse_event(event(**extra), NOW))

    def test_api_category_sorting_distinct_events_and_finance_crosslisting(self):
        def response(url):
            if "/tags/slug/" in url:
                slug = url.rsplit("/", 1)[1]
                return {"slug": slug, "id": "120" if slug == "finance" else "2"}
            query = parse_qs(urlparse(url).query)
            self.assertEqual(query["active"], ["true"])
            self.assertEqual(query["closed"], ["false"])
            self.assertEqual(query["ascending"], ["false"])
            if query["tag_id"] == ["120"]:
                self.assertEqual(query["order"], ["volume"])
                self.assertEqual(query["related_tags"], ["true"])
                return [event("1", 500, 1), event("1", 500, 1), event("2", 400, 999), event("3", 300, 1000)]
            self.assertEqual(query["order"], ["volume24hr"])
            self.assertEqual(query["related_tags"], ["false"])
            return [event("1", daily=900), event("9", daily=800, tags=[{"slug":"finance"}]),
                    event("4", daily=500), event("5", daily=600), event("6", daily=400), event("7", daily=300), event("8", daily=200)]
        with patch.object(poly, "fetch_json", side_effect=response):
            data = poly.collect(None, NOW)
        self.assertEqual([e["id"] for e in data["groups"]["finance"]["events"]], ["1", "2", "3"])
        self.assertEqual([e["id"] for e in data["groups"]["popular"]["events"]], ["5", "4", "6", "7", "8"])

    def test_old_two_event_snapshot_survives_an_outage_after_increasing_to_five(self):
        old = poly.collect(None, NOW, fetcher)
        old["groups"]["popular"]["events"] = old["groups"]["popular"]["events"][:2]
        failed = lambda *args: (_ for _ in ()).throw(poly.macro.SourceError("offline"))
        data = poly.collect(old, NOW + timedelta(minutes=5), failed)
        self.assertEqual(data["groups"]["popular"]["fetch_status"], "cached")
        self.assertEqual(data["groups"]["popular"]["fetched_at"], poly.iso(NOW))
        self.assertEqual(len(data["groups"]["popular"]["events"]), 2)

    def test_pagination_after_expired_or_invalid_leading_events(self):
        def response(url):
            if "/tags/slug/" in url:
                return {"slug":"finance", "id":"120"}
            offset = parse_qs(urlparse(url).query)["offset"]
            return [event(str(i), closed=True) for i in range(20)] if offset == ["0"] else [event(str(i)) for i in (21,22,23)]
        with patch.object(poly, "fetch_json", side_effect=response) as request:
            rows = poly.fetch_group("finance", NOW)
        self.assertEqual(len(rows), 3)
        self.assertEqual(request.call_count, 3)

    def test_independent_group_outage_retains_original_fetch_date_and_never_invents_bets(self):
        old = poly.collect(None, NOW, fetcher)
        def partial(kind, now, excluded):
            if kind == "popular":
                raise poly.macro.SourceError("Synthetic outage")
            return fetcher(kind, now, excluded)
        later = NOW + timedelta(hours=1)
        data = poly.collect(old, later, partial)
        self.assertEqual(data["groups"]["finance"]["fetch_status"], "fresh")
        self.assertEqual(data["groups"]["popular"]["fetch_status"], "cached")
        self.assertEqual(data["groups"]["popular"]["fetched_at"], poly.iso(NOW))
        empty = poly.collect(None, later, lambda *args: (_ for _ in ()).throw(poly.macro.SourceError("offline")))
        self.assertTrue(all(g["events"] == [] and g["fetched_at"] is None for g in empty["groups"].values()))

    def test_expired_and_tampered_cache_are_not_republished(self):
        old = poly.collect(None, NOW, fetcher)
        old["groups"]["finance"]["events"][0]["url"] = "javascript:bad"
        failed = lambda *args: (_ for _ in ()).throw(poly.macro.SourceError("offline"))
        data = poly.collect(old, NOW, failed)
        self.assertEqual(data["groups"]["finance"]["events"], [])
        data = poly.collect(old, datetime(2027, 2, 1, tzinfo=timezone.utc), failed)
        self.assertTrue(all(g["events"] == [] for g in data["groups"].values()))


if __name__ == "__main__":
    unittest.main()
