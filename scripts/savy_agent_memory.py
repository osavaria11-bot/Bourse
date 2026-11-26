"""Validated run records and a recoverable coordination index for SAVY and CRE."""

from copy import deepcopy
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re

AGENTS = {
    "savy": frozenset({"briefing", "finviz", "comite", "mensuel"}),
    "cre": frozenset({"cre"}),
}
KINDS = frozenset({
    "signal", "finding", "recommendation", "decision", "assumption",
    "error", "experiment", "method", "evaluation",
})
RUN_STATUSES = frozenset({"validated", "partial", "blocked", "failed"})
CASE_STATUSES = frozenset({"open", "investigating", "blocked", "resolved"})
KEY = re.compile(r"[a-z0-9][a-z0-9_.-]*(?:/[a-z0-9][a-z0-9_.-]*)*")
HEX = re.compile(r"[0-9a-f]{64}")
UTC = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z")
SECRET_FIELDS = {
    "access_token", "account_export", "api_key", "authorization", "password",
    "private_key", "raw_positions", "refresh_token", "savy_access", "token",
}
SECRET_TEXT = re.compile(
    r"github_pat_|gh[pousr]_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----"
    r"|[?&#](?:access_token|api_key|savy_access|token|sig|key)=",
    re.IGNORECASE,
)


class LedgerError(ValueError):
    """Invalid or inconsistent coordination data."""


def require(condition, message):
    if not condition:
        raise LedgerError(message)


def fields(value, names, label):
    require(isinstance(value, dict) and set(value) == set(names.split()), f"Invalid {label} fields")


def slug(value):
    require(isinstance(value, str) and len(value) <= 120 and KEY.fullmatch(value), "Invalid identifier")
    return value


def instant(value):
    require(isinstance(value, str) and UTC.fullmatch(value), "Use UTC timestamps with whole seconds")
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise LedgerError("Invalid calendar timestamp") from error


def text(value, limit=1200):
    require(isinstance(value, str) and 0 < len(value.strip()) <= limit, "Invalid summary or reference")
    require(not SECRET_TEXT.search(value), "Credential-like value is forbidden")


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True, indent=2) + "\n").encode("utf-8")


def read_json(value):
    def unique(pairs):
        obj = dict(pairs)
        require(len(obj) == len(pairs), "Duplicate JSON keys")
        return obj

    def invalid_constant(_):
        raise LedgerError("Nonfinite JSON number")

    return json.loads(value, object_pairs_hook=unique, parse_constant=invalid_constant)


def digest(value):
    return hashlib.sha256(json_bytes(value)).hexdigest()


def is_hash(value):
    return isinstance(value, str) and HEX.fullmatch(value) is not None


def safe_json(value):
    if isinstance(value, dict):
        for key, item in value.items():
            require(isinstance(key, str) and key.lower() not in SECRET_FIELDS, "Restricted input field")
            safe_json(item)
    elif isinstance(value, list):
        for item in value:
            safe_json(item)
    elif isinstance(value, str):
        require(not SECRET_TEXT.search(value), "Credential-like value is forbidden")


def path_for(namespace):
    require(isinstance(namespace, str) and namespace in AGENTS, "Unknown namespace")
    return f"agent-memory/{namespace}"


def agent_in(namespace, agent):
    path_for(namespace)
    require(isinstance(agent, str) and agent in AGENTS[namespace], "Agent outside this namespace")


def run_path(run):
    agent_in(run["namespace"], run["agent"])
    slot = run["scheduled_for"]
    instant(slot)
    return f"{path_for(run['namespace'])}/runs/{slot[:7]}/{run['agent']}-{slot.replace(':', '')}.json"


def validate_run(run):
    fields(run, "schema_version namespace agent scheduled_for started_at completed_at status inputs "
           "gaps records cases checks", "run")
    require(type(run["schema_version"]) is int and run["schema_version"] == 1, "Unknown run schema")
    namespace, agent = run["namespace"], run["agent"]
    agent_in(namespace, agent)
    slot, start, end = (instant(run[k]) for k in ("scheduled_for", "started_at", "completed_at"))
    # Scheduled services can start a little early. Completion still has to follow the actual start.
    require(start <= end, "Run timestamps are out of order")
    require(abs((start - slot).total_seconds()) <= 86400, "Use the occurrence associated with this run")
    require(isinstance(run["status"], str) and run["status"] in RUN_STATUSES, "Unknown run status")

    safe_json(run)
    require(len(json_bytes(run)) <= 200_000, "Keep the run record compact and reference source files")
    require(isinstance(run["inputs"], dict) and len(run["inputs"]) <= 80, "Invalid input index")
    for key, item in run["inputs"].items():
        slug(key)
        fields(item, "source observed_at available_at expires_at fingerprint", "input")
        text(item["source"], 500)
        observed, available, expires = (instant(item[k]) for k in ("observed_at", "available_at", "expires_at"))
        require(observed <= available <= min(end, expires), "Input is future-dated or has an invalid lifetime")
        require(is_hash(item["fingerprint"]), "Input requires a SHA-256 fingerprint")

    require(isinstance(run["gaps"], dict) and len(run["gaps"]) <= 80, "Invalid data gaps")
    require(not (run["inputs"].keys() & run["gaps"].keys()), "An input cannot be verified and unavailable")
    for key, reason in run["gaps"].items():
        slug(key)
        text(reason)
    require(run["status"] != "validated" or not run["gaps"], "A run with required data gaps is partial")

    fields(run["checks"], "executed reused", "checks")
    for count in run["checks"].values():
        require(type(count) is int and count >= 0, "Check counts must be measured integers")

    def evidence(keys, use_current):
        require(isinstance(keys, list) and all(isinstance(k, str) and k in run["inputs"] for k in keys),
                "Unknown evidence reference")
        require(len(keys) == len(set(keys)), "Duplicate evidence reference")
        if use_current:
            require(keys and all(instant(run["inputs"][k]["expires_at"]) >= end for k in keys),
                    "Current claims require fresh evidence")

    require(isinstance(run["records"], list) and len(run["records"]) <= 50, "Invalid run records")
    seen = set()
    for record in run["records"]:
        fields(record, "kind key observed_at status audience summary inputs", "record")
        kind, key = record["kind"], slug(record["key"])
        require(isinstance(kind, str) and kind in KINDS, "Unknown record category")
        require((kind, key) not in seen, "Duplicate record in run")
        seen.add((kind, key))
        require(instant(record["observed_at"]) <= end, "Record is future-dated")
        require(record["status"] in ("current", "historical", "unverified"), "Unknown record status")
        require(record["status"] != "unverified" or kind in {"error", "assumption"},
                "Unverified claims belong in errors or assumptions")
        text(record["summary"])
        audience = record["audience"]
        require(isinstance(audience, list) and all(isinstance(a, str) and a in AGENTS[namespace] for a in audience),
                "Invalid audience")
        require(agent in audience and len(audience) == len(set(audience)), "Invalid audience")
        require(agent != "finviz" or "briefing" not in audience, "Finviz research bypasses the briefing")
        evidence(record["inputs"], record["status"] == "current")
        require(record["status"] != "historical" or record["inputs"], "Historical claims require evidence")

    require(isinstance(run["cases"], list) and len(run["cases"]) <= 24, "Invalid investigations")
    seen.clear()
    for case in run["cases"]:
        fields(case, "key owner prior status priority summary next due_at inputs", "investigation")
        key = slug(case["key"])
        require(key not in seen, "Duplicate investigation in run")
        seen.add(key)
        agent_in(namespace, case["owner"])
        require(case["prior"] is None or is_hash(case["prior"]), "Invalid investigation revision")
        require(isinstance(case["status"], str) and case["status"] in CASE_STATUSES, "Unknown investigation status")
        require(type(case["priority"]) is int and 1 <= case["priority"] <= 3, "Use priority 1, 2 or 3")
        text(case["summary"])
        if case["status"] == "resolved":
            require(case["next"] is None and case["due_at"] is None, "Closed cases cannot have a due date")
        else:
            text(case["next"])
            require(instant(case["due_at"]) >= start, "Set a due date for a future review")
        evidence(case["inputs"], case["status"] == "resolved")


def empty_state(namespace):
    path_for(namespace)
    return {
        "schema_version": 1, "namespace": namespace, "revision": 0, "last_digest": None,
        "as_of": None, "agents": {}, "cases": {}, "records": {},
    }


def validate_state(state, namespace):
    fields(state, "schema_version namespace revision last_digest as_of agents cases records", "state")
    path_for(namespace)
    require(type(state["schema_version"]) is int and state["schema_version"] == 1
            and state["namespace"] == namespace, "State schema or namespace mismatch")
    revision = state["revision"]
    require(type(revision) is int and revision >= 0, "Invalid state revision")
    require(all(isinstance(state[k], dict) for k in ("agents", "cases", "records")), "Invalid state indexes")
    if revision == 0:
        require(state == empty_state(namespace), "Nonempty initial state")
    else:
        instant(state["as_of"])
        require(is_hash(state["last_digest"]), "Invalid last run digest")


def prepare(run, state=None, existing=None):
    """Return the two files for one atomic commit. An identical retry is a no-op."""
    validate_run(run)
    namespace, agent = run["namespace"], run["agent"]
    path = run_path(run)
    state = empty_state(namespace) if state is None else state
    validate_state(state, namespace)
    if existing is not None:
        fields(existing, "revision parent run", "archived run")
        require(type(existing["revision"]) is int and 0 < existing["revision"] <= state["revision"],
                "Run exists without the corresponding state revision")
        require(existing["run"] == run, "This occurrence already exists with different content")
        return {}

    next_state = deepcopy(state)
    entry = {"revision": state["revision"] + 1, "parent": state["last_digest"], "run": run}
    entry_digest = digest(entry)
    when = run["completed_at"]
    current_run = {
        "source_run": path, "digest": entry_digest, "scheduled_for": run["scheduled_for"],
        "completed_at": when, "status": run["status"], "gaps": run["gaps"], "checks": run["checks"],
        "inputs": run["inputs"],
        "elapsed_seconds": int((instant(when) - instant(run["started_at"])).total_seconds()),
    }
    last = next_state["agents"].get(agent)
    require(not last or run["scheduled_for"] != last["scheduled_for"], "Latest run file is missing from state")
    if not last or run["scheduled_for"] > last["scheduled_for"]:
        next_state["agents"][agent] = current_run

    for record in run["records"]:
        key = "/".join((agent, record["kind"], record["key"]))
        last = next_state["records"].get(key)
        if not last or (record["observed_at"], run["scheduled_for"]) > (last["observed_at"], last["scheduled_for"]):
            expires = min((run["inputs"][k]["expires_at"] for k in record["inputs"]), default=None)
            next_state["records"][key] = {
                **record, "producer": agent, "source_run": path, "scheduled_for": run["scheduled_for"],
                "expires_at": expires, "evidence": {k: run["inputs"][k] for k in record["inputs"]},
            }

    for case in run["cases"]:
        key = case["key"]
        last = next_state["cases"].get(key)
        require(case["prior"] == (last["revision"] if last else None),
                f"Investigation changed since it was read: {key}")
        if last:
            require(agent == last["owner"] == case["owner"], "Only the assigned agent can update an investigation")
            require(when >= last["updated_at"], "An older investigation update cannot supersede a newer one")
            require(last["status"] != "resolved" or case["status"] == "open",
                    "Reopen a resolved investigation explicitly")
        else:
            require(case["status"] == "open", "A new investigation starts open")
        next_state["cases"][key] = {
            **case, "revision": entry_digest, "opened_at": last["opened_at"] if last else when,
            "opened_by": last["opened_by"] if last else agent,
            "updated_at": when, "source_run": path,
        }

    next_state["revision"] = entry["revision"]
    next_state["last_digest"] = entry_digest
    next_state["as_of"] = max(when, state["as_of"] or when)
    return {path: entry, f"{path_for(namespace)}/state.json": next_state}


def read_context(state, namespace, agent, cutoff, limit=24):
    agent_in(namespace, agent)
    instant(cutoff)
    state = empty_state(namespace) if state is None else state
    validate_state(state, namespace)
    require(type(limit) is int and 1 <= limit <= 100, "Invalid context limit")
    require(not state["as_of"] or state["as_of"] <= cutoff, "Read the head known at the requested cutoff")
    items = [entry for entry in state["records"].values() if agent in entry["audience"]]
    items.sort(key=lambda entry: (entry["observed_at"], entry["source_run"], entry["key"]), reverse=True)
    fresh, inactive = [], []
    for entry in items:
        usable = entry["status"] == "current" and entry["expires_at"] >= cutoff
        (fresh if usable else inactive).append(entry)
    visible = [case for case in state["cases"].values() if agent in (case["owner"], case["opened_by"])]
    cases = [case for case in visible if case["status"] != "resolved"]
    cases.sort(key=lambda case: (case["owner"] != agent, case["priority"], case["due_at"], case["key"]))
    recent_closed = sorted((case for case in visible if case["status"] == "resolved"),
                           key=lambda case: (case["updated_at"], case["key"]), reverse=True)
    return {
        "namespace": namespace, "agent": agent, "cutoff": cutoff, "revision": state["revision"],
        "last_run": state["agents"].get(agent), "current_records": fresh[:limit],
        "other_records": inactive[:limit],
        "investigations": [{**case, "due": case["due_at"] <= cutoff} for case in cases],
        "recently_resolved": recent_closed[:limit],
    }


def reusable_input(previous, candidate, cutoff):
    """Compare the exact validated input descriptor, including a versioned source/check ID."""
    instant(cutoff)
    return (
        previous is not None and previous == candidate
        and previous["available_at"] <= cutoff <= previous["expires_at"]
    )


def verify_archive(root, namespace):
    """Rebuild the small index from the immutable runs and check the full digest chain."""
    root = Path(root)
    prefix = path_for(namespace)
    paths = list((root / prefix / "runs").glob("*/*.json"))
    entries = []
    for path in paths:
        entry = read_json(path.read_bytes())
        fields(entry, "revision parent run", "archived run")
        require(type(entry["revision"]) is int and entry["revision"] > 0, "Invalid archive revision")
        require(path.relative_to(root).as_posix() == run_path(entry["run"]), "Unexpected run path")
        require(entry["run"]["namespace"] == namespace, "Cross-namespace run")
        entries.append(entry)
    state = empty_state(namespace)
    seen = set()
    for entry in sorted(entries, key=lambda item: item["revision"]):
        path = run_path(entry["run"])
        require(path not in seen, "Repeated occurrence in archive")
        seen.add(path)
        writes = prepare(entry["run"], state)
        require(writes[path] == entry, "Archive chain diverges")
        state = writes[f"{prefix}/state.json"]
    file = root / prefix / "state.json"
    published = read_json(file.read_bytes()) if file.is_file() else empty_state(namespace)
    require(state == published, "State cannot be reconstructed from the run archive")
    return state


def quality(runs, cutoff):
    """Measure the supplied recorded runs. A missing scheduler occurrence is unknown here."""
    instant(cutoff)
    groups, seen = {}, set()
    for run in runs:
        validate_run(run)
        path = run_path(run)
        require(path not in seen, "Run is present twice in the evaluation")
        seen.add(path)
        if run["completed_at"] > cutoff:
            continue
        group = groups.setdefault(run["agent"], {
            "recorded": 0, "statuses": {status: 0 for status in sorted(RUN_STATUSES)},
            "runs_with_gaps": 0, "checks_executed": 0, "checks_reused": 0, "elapsed_seconds_total": 0,
        })
        group["recorded"] += 1
        group["statuses"][run["status"]] += 1
        group["runs_with_gaps"] += bool(run["gaps"])
        group["checks_executed"] += run["checks"]["executed"]
        group["checks_reused"] += run["checks"]["reused"]
        group["elapsed_seconds_total"] += int(
            (instant(run["completed_at"]) - instant(run["started_at"])).total_seconds()
        )
    for stats in groups.values():
        stats["validated_share"] = stats["statuses"]["validated"] / stats["recorded"]
        total_checks = stats["checks_executed"] + stats["checks_reused"]
        stats["reuse_share"] = stats["checks_reused"] / total_checks if total_checks else None
    return {"as_of": cutoff, "scope": "recorded_occurrences_only", "agents": groups}
