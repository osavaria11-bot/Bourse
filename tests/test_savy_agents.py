from base64 import b64decode, b64encode
from copy import deepcopy
from datetime import date, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from scripts import savy_agent_memory as memory
from scripts import savy_agent_research as research
from scripts.savy_agents import GitHubError, GitHubMemory


WED = "2026-11-25T10:00:00Z"
FINVIZ = "2026-11-26T03:00:00Z"
COMMITTEE = "2026-11-26T08:00:00Z"
CRE = "2026-11-30T07:00:00Z"
MONTH = "2026-12-02T03:00:00Z"
EXPIRY = "2026-11-30T23:59:59Z"
FP = "f" * 64
STATE = "agent-memory/savy/state.json"


def fixture(agent, timestamp, **overrides):
    namespace = "cre" if agent == "cre" else "savy"
    return {
        "schema_version": 1, "namespace": namespace, "agent": agent, "scheduled_for": timestamp,
        "started_at": timestamp, "completed_at": timestamp[:14] + "15:00Z", "status": "validated",
        "inputs": {}, "gaps": {}, "records": [], "cases": [], "checks": {"executed": 2, "reused": 1},
        **overrides,
    }


def source(expires=EXPIRY):
    return {
        "source": "fixture/verified-v1", "observed_at": WED, "available_at": WED,
        "expires_at": expires, "fingerprint": FP,
    }


def record(observed_at, audience, key="test", kind="finding"):
    return {
        "kind": kind, "key": key, "observed_at": observed_at, "status": "current",
        "audience": audience, "summary": "Synthetic validated observation", "inputs": ["sample"],
    }


def investigation(owner="comite", prior=None, status="open"):
    closed = status == "resolved"
    return {
        "key": "active/jmc/5d", "owner": owner, "prior": prior, "status": status, "priority": 1,
        "summary": "Synthetic attribution to investigate", "next": None if closed else "Check matched closes and exposures",
        "due_at": None if closed else "2026-12-03T08:00:00Z", "inputs": ["sample"],
    }


class FakeGitHub(GitHubMemory):
    """A synthetic private repository with actual expected-head conflict semantics."""

    def __init__(self, private=True):
        super().__init__("synthetic/memory", "main", "fake-test-credential")
        self.private = private
        self.oid = "0" * 40
        self.commits = {self.oid: {}}
        self.posts = 0
        self.concurrent = None
        self.lose_response = False

    def request(self, path, payload=None):
        if path == self.base:
            return {"full_name": self.repository, "private": self.private,
                    "visibility": "private" if self.private else "public", "permissions": {"push": True}}
        if path.startswith(f"{self.base}/git/ref/heads/"):
            return {"object": {"sha": self.oid}}
        if path.startswith(f"{self.base}/contents/"):
            name, sha = path.removeprefix(f"{self.base}/contents/").split("?ref=")
            files = self.commits[sha]
            if name in files:
                return {"type": "file", "path": name, "encoding": "base64",
                        "content": b64encode(memory.json_bytes(files[name])).decode("ascii")}
            if any(key.startswith(name + "/") for key in files):
                return [{"type": "dir"}]
            raise GitHubError(404)
        if path != "/graphql":
            raise AssertionError("Unexpected endpoint")
        self.posts += 1
        args = payload["variables"]["input"]
        if self.concurrent:
            self.advance(self.concurrent)
            self.concurrent = None
        if args["expectedHeadOid"] != self.oid:
            return {"errors": [{"message": "stale head"}]}
        assert args["branch"] == {"repositoryNameWithOwner": self.repository, "branchName": self.branch}
        changes = {file["path"]: memory.read_json(b64decode(file["contents"]))
                   for file in args["fileChanges"]["additions"]}
        self.advance(changes)
        if self.lose_response:
            self.lose_response = False
            raise GitHubError("network")
        return {"data": {"createCommitOnBranch": {"commit": {"oid": self.oid}}}}

    def advance(self, changes):
        files = {**self.commits[self.oid], **changes}
        self.oid = f"{len(self.commits):040x}"
        self.commits[self.oid] = files


class CoordinationTests(unittest.TestCase):
    def test_scheduled_coordination_and_namespace_isolation(self):
        api = FakeGitHub()
        daily = fixture("briefing", WED, inputs={"sample": source()}, cases=[investigation()])
        finviz = fixture("finviz", FINVIZ, inputs={"sample": source()},
                         records=[record(FINVIZ, ["finviz", "comite", "mensuel"], "issuer-a", "signal")])
        self.assertEqual(api.publish(daily)["status"], "recorded")
        self.assertEqual(api.publish(finviz)["status"], "recorded")
        committee_start = api.brief("savy", "comite", COMMITTEE, 24)
        self.assertEqual([event["key"] for event in committee_start["current_records"]], ["issuer-a"])
        self.assertEqual([case["key"] for case in committee_start["investigations"]], ["active/jmc/5d"])
        daily_context = api.brief("savy", "briefing", COMMITTEE, 24)
        self.assertEqual(daily_context["current_records"], [])
        self.assertEqual([case["owner"] for case in daily_context["investigations"]], ["comite"])
        prior = committee_start["investigations"][0]["revision"]
        committee = fixture("comite", COMMITTEE, inputs={"sample": source()},
                            cases=[investigation(prior=prior, status="resolved")],
                            records=[record(COMMITTEE, ["comite", "mensuel"], "jmc-review", "decision")])
        api.publish(committee)
        api.publish(fixture("cre", CRE, inputs={"sample": source()},
                            records=[record(CRE, ["cre"], "regional-prices")]))
        monthly = api.brief("savy", "mensuel", MONTH, 24)
        self.assertEqual(monthly["revision"], 3)
        self.assertEqual(monthly["current_records"], [])
        self.assertEqual({event["key"] for event in monthly["other_records"]}, {"issuer-a", "jmc-review"})
        self.assertEqual(monthly["investigations"], [])
        monthly_source = {**source("2026-12-10T00:00:00Z"), "observed_at": MONTH, "available_at": MONTH}
        api.publish(fixture("mensuel", MONTH, inputs={"sample": monthly_source},
                            records=[record(MONTH, ["mensuel", "comite"], "holdout-review", "evaluation")]))
        real_estate = api.brief("cre", "cre", CRE[:14] + "16:00Z", 24)
        self.assertEqual(real_estate["revision"], 1)
        self.assertEqual([event["key"] for event in real_estate["current_records"]], ["regional-prices"])
        self.assertEqual(api.publish(daily)["status"], "already_recorded")
        with self.assertRaises(memory.LedgerError):
            api.publish({**daily, "status": "partial"})
        self.check_archive(api, "savy", 4)
        self.check_archive(api, "cre", 1)

    def check_archive(self, api, namespace, expected):
        with TemporaryDirectory() as folder:
            root = Path(folder)
            for name, value in api.commits[api.oid].items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(memory.json_bytes(value))
            self.assertEqual(memory.verify_archive(root, namespace)["revision"], expected)
            run = next((root / memory.path_for(namespace) / "runs").glob("*/*.json"))
            value = memory.read_json(run.read_bytes())
            value["run"]["checks"]["executed"] += 1
            run.write_bytes(memory.json_bytes(value))
            with self.assertRaises(memory.LedgerError):
                memory.verify_archive(root, namespace)

    def test_racing_agents_rebase_without_losing_an_observation(self):
        api = FakeGitHub()
        first = fixture("briefing", WED)
        second = fixture("finviz", FINVIZ)
        api.concurrent = memory.prepare(first)
        result = api.publish(second)
        self.assertEqual(api.posts, 2)
        self.assertEqual(result["status"], "recorded")
        state = api.commits[api.oid][STATE]
        self.assertEqual(set(state["agents"]), {"briefing", "finviz"})
        self.check_archive(api, "savy", 2)

    def test_overlapping_case_updates_fail_instead_of_overwriting(self):
        api = FakeGitHub()
        first = fixture("briefing", WED, inputs={"sample": source()}, cases=[investigation()])
        api.publish(first)
        initial = api.commits[api.oid][STATE]
        prior = initial["cases"]["active/jmc/5d"]["revision"]
        edit = fixture("comite", COMMITTEE, inputs={"sample": source()},
                       cases=[investigation(prior=prior, status="investigating")])
        other = fixture("comite", "2026-11-27T08:00:00Z", inputs={"sample": source()},
                        cases=[investigation(prior=prior, status="blocked")])
        api.concurrent = memory.prepare(edit, initial)
        with self.assertRaisesRegex(memory.LedgerError, "changed"):
            api.publish(other)
        self.assertEqual(api.commits[api.oid][STATE]["cases"]["active/jmc/5d"]["status"], "investigating")
        self.assertNotIn(memory.run_path(other), api.commits[api.oid])

    def test_lost_response_does_not_duplicate_the_run(self):
        api = FakeGitHub()
        api.lose_response = True
        result = api.publish(fixture("briefing", WED))
        self.assertEqual(result["status"], "already_recorded")
        self.assertEqual(api.posts, 1)
        self.assertEqual(api.commits[api.oid][STATE]["revision"], 1)

    def test_public_destination_is_refused_before_writing(self):
        api = FakeGitHub(private=False)
        with self.assertRaisesRegex(memory.LedgerError, "private"):
            api.publish(fixture("briefing", WED))
        self.assertEqual(api.posts, 0)

    def test_missing_index_with_history_is_not_reinitialized(self):
        api = FakeGitHub()
        api.publish(fixture("briefing", WED))
        del api.commits[api.oid][STATE]
        with self.assertRaisesRegex(memory.LedgerError, "Historical runs"):
            api.publish(fixture("finviz", FINVIZ))

    def test_expired_and_unverified_inputs_are_not_current(self):
        finviz = fixture("finviz", FINVIZ, inputs={"sample": source(WED)},
                         records=[record(FINVIZ, ["finviz", "comite"])])
        with self.assertRaisesRegex(memory.LedgerError, "fresh evidence"):
            memory.prepare(finviz)
        finviz["records"][0]["status"] = "historical"
        state = memory.prepare(finviz)[STATE]
        self.assertFalse(memory.read_context(state, "savy", "comite", COMMITTEE)["current_records"])
        with self.assertRaisesRegex(memory.LedgerError, "head known"):
            memory.read_context(state, "savy", "comite", WED)
        self.assertFalse(memory.reusable_input(source(WED), source(WED), FINVIZ))
        self.assertTrue(memory.reusable_input(source(), source(), FINVIZ))
        self.assertFalse(memory.reusable_input(source(), {**source(), "fingerprint": "a" * 64}, FINVIZ))

    def test_run_validation_rejects_links_to_secrets_and_forbidden_recipients(self):
        finviz = fixture("finviz", FINVIZ, inputs={"sample": source()},
                         records=[record(FINVIZ, ["finviz", "briefing"])])
        with self.assertRaisesRegex(memory.LedgerError, "bypasses the briefing"):
            memory.prepare(finviz)
        finviz["inputs"]["sample"]["source"] = "https://example.invalid/#savy_access=synthetic"
        with self.assertRaisesRegex(memory.LedgerError, "Credential"):
            memory.prepare(finviz)
        with self.assertRaisesRegex(memory.LedgerError, "namespace"):
            memory.read_context(None, "cre", "comite", COMMITTEE)

    def test_evaluation_counts_actual_runs_and_reuse_only(self):
        first = fixture("briefing", WED)
        second = fixture("briefing", COMMITTEE, status="partial", gaps={"sample": "Not yet published"})
        score = memory.quality([first, second], CRE)["agents"]["briefing"]
        self.assertEqual(score["recorded"], 2)
        self.assertEqual(score["validated_share"], 0.5)
        self.assertEqual(score["elapsed_seconds_total"], 1800)
        self.assertAlmostEqual(score["reuse_share"], 1 / 3)


class ResearchTests(unittest.TestCase):
    def test_alert_excludes_current_window_from_threshold(self):
        sessions = [(date(2026, 9, 1) + timedelta(days=i)).isoformat() for i in range(40)]
        rows = [{"session": session, "portfolio_return": (i % 5 - 2) / 2000, "benchmark_return": 0.0}
                for i, session in enumerate(sessions)]
        rows[-1]["portfolio_return"] = -0.04
        opts = {"horizon": 2, "min_history": 8, "dispersion_multiple": 3, "floor_bps": 20}
        signal = research.relative(rows, sessions, **opts)
        self.assertEqual(signal["status"], "alert")
        self.assertEqual(signal["historical_windows"], 19)
        self.assertLess(signal["active_bps"], -350)
        self.assertEqual(research.relative(rows[:-1], sessions, **opts)["status"], "unavailable")
        self.assertEqual(research.relative(rows[:3], sessions[:3], **opts)["status"], "insufficient_history")
        rows[-1]["portfolio_return"] = 0.04
        self.assertEqual(research.relative(rows, sessions, direction="both", **opts)["status"], "alert")

    def test_event_queue_uses_latest_verified_material_state(self):
        base = {"key": "feed", "kind": "system_failure", "available_at": WED, "expires_at": EXPIRY,
                "priority": 1, "evidence": FP, "material": True}
        cleared = {**base, "available_at": FINVIZ, "material": False}
        self.assertEqual(research.event_queue([base, cleared], COMMITTEE), [])
        self.assertEqual(research.event_queue([base, base], COMMITTEE), [base])
        with self.assertRaisesRegex(memory.LedgerError, "Conflicting"):
            research.event_queue([base, {**base, "priority": 2}], COMMITTEE)

    def test_chronological_holdout_purges_boundary_and_applies_costs(self):
        def stamp(day):
            return f"2026-11-{day:02d}T10:00:00Z"

        def row(start, close):
            return {
                "formed_at": stamp(start), "data_available_at": stamp(start), "entered_at": stamp(start + 1),
                "exited_at": stamp(close), "outcome_available_at": stamp(close),
                "universe_fingerprint": FP, "candidate_return": 0.02, "baseline_return": 0.01,
                "candidate_turnover": 1, "baseline_turnover": 0, "cost_bps": 100,
            }

        spec = {"method_fingerprint": FP, "frozen_at": stamp(10), "evaluated_at": stamp(27),
                "min_oos": 2, "currency": "USD", "return_basis": "price_return"}
        rows = [row(1, 6), row(8, 13), row(15, 19), row(21, 25), row(26, 30)]
        result = research.backtest(spec, rows)
        self.assertEqual(result["status"], "scored")
        self.assertEqual(result["calibration"]["periods"], 1)
        self.assertEqual(result["holdout"]["periods"], 2)
        self.assertEqual(result["purged_periods"], 1)
        self.assertEqual(result["pending_periods"], 1)
        self.assertLess(result["holdout"]["active_bps"], 0)
        invalid = deepcopy(rows)
        invalid[0]["data_available_at"] = stamp(2)
        with self.assertRaisesRegex(memory.LedgerError, "Look-ahead"):
            research.backtest(spec, invalid)

    def test_forecast_results_are_scored_after_maturity_and_by_provenance(self):
        f = {"key": "a", "provenance": "observed", "horizon": "1w", "issued_at": WED,
             "due_at": FINVIZ, "resolved_at": FINVIZ, "probability": 0.8, "outcome": True}
        fake = {**f, "key": "b", "provenance": "hypothetical", "outcome": False}
        pending = {**f, "key": "c", "resolved_at": None, "outcome": None}
        score = research.score_forecasts([f, fake, pending], COMMITTEE)
        self.assertEqual(score["pending"], 1)
        self.assertEqual(research.score_forecasts([f], WED)["pending"], 1)
        groups = {group["provenance"]: group for group in score["groups"]}
        self.assertAlmostEqual(groups["observed"]["brier"], 0.04)
        self.assertAlmostEqual(groups["hypothetical"]["brier"], 0.64)

    def test_rank_evaluation_counts_missing_cohorts_instead_of_dropping_tickers(self):
        cohort = {"formation": WED, "data_available": WED, "execution": FINVIZ, "outcome_available": COMMITTEE,
                  "universe_fingerprint": FP, "expected_count": 3,
                  "ranks": {symbol: {"score": value, "realized_return": value / 100}
                            for symbol, value in (("a", 3), ("b", 1), ("c", 2))}}
        self.assertEqual(research.rank_predictiveness([cohort], MONTH)["mean_spearman"], 1)
        self.assertEqual(research.rank_predictiveness([cohort], FINVIZ)["immature"], 1)
        self.assertEqual(research.rank_predictiveness([{**cohort, "expected_count": 4}], MONTH)["incomplete"], 1)


if __name__ == "__main__":
    unittest.main()
