"""Command line for the SAVY agent memory and research tools."""

import argparse
from base64 import b64decode, b64encode
import os
from pathlib import Path
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener

from . import savy_agent_memory as memory
from . import savy_agent_research as research

GITHUB_API = "https://api.github.com"
REPOSITORY = re.compile(r"[A-Za-z0-9_-]+/[A-Za-z0-9_.-]+")
BRANCH = re.compile(r"[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*")
OID = re.compile(r"[0-9a-f]{40}")
COMMIT_MUTATION = """
mutation ($input: CreateCommitOnBranchInput!) {
  createCommitOnBranch(input: $input) {
    commit { oid }
  }
}
"""


class GitHubError(ValueError):
    def __init__(self, status):
        super().__init__(f"GitHub request failed ({status})")
        self.status = status


class RejectRedirect(HTTPRedirectHandler):
    # The configured credential is used only at the fixed GitHub API origin.
    def redirect_request(self, *args, **kwargs):
        return None


class GitHubMemory:
    def __init__(self, repository, branch, token):
        memory.require(REPOSITORY.fullmatch(repository), "Use a GitHub owner/repository")
        memory.require(BRANCH.fullmatch(branch), "Use a configured GitHub branch")
        memory.require(token and not any(char.isspace() for char in token), "Memory credential is unavailable")
        self.repository = repository
        self.branch = branch
        self.base = f"/repos/{repository}"
        self.headers = {
            "Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
            "User-Agent": "savy-agent-memory",
        }
        self.opener = build_opener(RejectRedirect())

    def request(self, path, payload=None):
        headers = self.headers if payload is None else {**self.headers, "Content-Type": "application/json"}
        req = Request(GITHUB_API + path, data=memory.json_bytes(payload) if payload is not None else None,
                      headers=headers)
        try:
            with self.opener.open(req, timeout=15) as response:
                body = response.read(6_000_001)
            memory.require(len(body) <= 6_000_000, "GitHub response too large")
            return memory.read_json(body)
        except HTTPError as error:
            raise GitHubError(error.code) from None
        except (URLError, TimeoutError):
            raise GitHubError("network") from None

    def check_repository(self, write=False):
        project = self.request(self.base)
        memory.require(project.get("full_name", "").lower() == self.repository.lower()
                       and project.get("private") is True and project.get("visibility") == "private",
                       "Coordination memory requires a verified private GitHub repository")
        if write:
            memory.require(not project.get("archived") and (project.get("permissions") or {}).get("push") is not False,
                           "Private repository has no write permission")

    def head(self):
        return self.checked_oid(self.request(f"{self.base}/git/ref/heads/{self.branch}")["object"]["sha"])

    @staticmethod
    def checked_oid(oid):
        memory.require(isinstance(oid, str) and OID.fullmatch(oid), "Invalid GitHub commit SHA")
        return oid

    def read_file(self, path, sha, optional=False):
        try:
            src = self.request(f"{self.base}/contents/{quote(path, safe='/')}?{urlencode({'ref': sha})}")
        except GitHubError as error:
            if optional and error.status == 404:
                return None
            raise
        memory.require(src.get("type") == "file" and src.get("path") == path, "Unexpected GitHub content path")
        if src.get("encoding") == "none":
            oid = self.checked_oid(src.get("sha"))
            src = self.request(f"{self.base}/git/blobs/{oid}")
        memory.require(src.get("encoding") == "base64", "GitHub did not return a base64 file")
        return memory.read_json(b64decode("".join(src["content"].split()), validate=True))

    def read_state(self, namespace, head):
        prefix = memory.path_for(namespace)
        state = self.read_file(f"{prefix}/state.json", head, optional=True)
        if state is None or (isinstance(state, dict) and state.get("revision") == 0):
            # A missing index can be initialized only before the first run.
            try:
                self.request(f"{self.base}/contents/{prefix}/runs?{urlencode({'ref': head})}")
            except GitHubError as error:
                if error.status != 404:
                    raise
            else:
                raise memory.LedgerError("Historical runs exist; the state needs to be reconciled")
        return state

    def brief(self, namespace, agent, cutoff, limit):
        self.check_repository()
        head = self.head()
        state = self.read_state(namespace, head)
        return {"head": head, **memory.read_context(state, namespace, agent, cutoff, limit)}

    def commit(self, sha, run, changes):
        self.check_repository(write=True)
        additions = [{"path": path, "contents": b64encode(memory.json_bytes(content)).decode("ascii")}
                     for path, content in changes.items()]
        args = {
            "branch": {"repositoryNameWithOwner": self.repository, "branchName": self.branch},
            "expectedHeadOid": sha,
            "message": {"headline": f"Record {run['namespace']} {run['agent']} occurrence"},
            "fileChanges": {"additions": additions},
        }
        result = self.request("/graphql", {"query": COMMIT_MUTATION, "variables": {"input": args}})
        commit = (result.get("data") or {}).get("createCommitOnBranch")
        if result.get("errors") or not commit:
            raise GitHubError("commit rejected")
        return self.checked_oid(commit["commit"]["oid"])

    def publish(self, run):
        memory.validate_run(run)
        self.check_repository(write=True)
        run_path = memory.run_path(run)
        for _ in range(3):
            head = self.head()
            state = self.read_state(run["namespace"], head)
            existing = self.read_file(run_path, head, optional=True)
            changes = memory.prepare(run, state, existing)
            if not changes:
                return {"status": "already_recorded", "head": head, "run_path": run_path}
            try:
                published = self.commit(head, run, changes)
            except GitHubError:
                if self.head() == head:
                    raise
                # Rebuild solely from the new head. The case revision still has to match.
                continue
            for path, payload in changes.items():
                memory.require(self.read_file(path, published) == payload, "Committed files failed verification")
            return {"status": "recorded", "head": published, "run_path": run_path}
        raise memory.LedgerError("Branch advanced repeatedly; retain the candidate for reconciliation")


def local_file(path):
    return memory.read_json(Path(path).read_bytes()) if path is not None else None


def connection(args):
    return GitHubMemory(args.repo, args.branch, os.environ.get("SAVY_MEMORY_GITHUB_TOKEN", ""))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("context", "github-context"):
        context = commands.add_parser(name, help="Resume verified state at an explicit UTC cutoff")
        context.add_argument("namespace", choices=sorted(memory.AGENTS))
        context.add_argument("agent")
        context.add_argument("cutoff")
        context.add_argument("--limit", type=int, default=24)
        if name == "context":
            context.add_argument("--state")
        else:
            context.add_argument("--repo", required=True)
            context.add_argument("--branch", required=True)

    plan = commands.add_parser("prepare", help="Produce an atomic file plan from locally staged inputs")
    plan.add_argument("run")
    plan.add_argument("--state")
    plan.add_argument("--existing")
    record = commands.add_parser("github-publish", help="Commit a validated run to a private GitHub branch")
    record.add_argument("run")
    record.add_argument("--repo", required=True)
    record.add_argument("--branch", required=True)
    path_cmd = commands.add_parser("run-path", help="Return the immutable location of a validated run")
    path_cmd.add_argument("run")
    verify = commands.add_parser("verify", help="Replay and check locally retained run files")
    verify.add_argument("root")
    verify.add_argument("namespace", choices=sorted(memory.AGENTS))
    for name in ("relative", "events", "backtest", "forecasts", "rank", "quality"):
        command = commands.add_parser(name, help="Evaluate a research JSON input")
        command.add_argument("input")
    args = parser.parse_args()

    try:
        if args.command == "context":
            result = memory.read_context(local_file(args.state), args.namespace, args.agent, args.cutoff, args.limit)
        elif args.command == "github-context":
            result = connection(args).brief(args.namespace, args.agent, args.cutoff, args.limit)
        elif args.command == "prepare":
            changes = memory.prepare(local_file(args.run), local_file(args.state), local_file(args.existing))
            result = {"status": "ready" if changes else "already_recorded", "files": changes}
        elif args.command == "github-publish":
            result = connection(args).publish(local_file(args.run))
        elif args.command == "run-path":
            run = local_file(args.run)
            memory.validate_run(run)
            result = {"path": memory.run_path(run)}
        elif args.command == "verify":
            index = memory.verify_archive(args.root, args.namespace)
            result = {"namespace": args.namespace, "verified_runs": index["revision"], "last_digest": index["last_digest"]}
        else:
            function = {"relative": research.relative, "events": research.event_queue,
                        "backtest": research.backtest, "forecasts": research.score_forecasts,
                        "rank": research.rank_predictiveness, "quality": memory.quality}[args.command]
            result = function(**local_file(args.input))
        sys.stdout.buffer.write(memory.json_bytes(result))
    except (OSError, ValueError, TypeError, KeyError) as error:
        parser.exit(2, f"SAVY rejected the operation: {error}\n")


if __name__ == "__main__":
    main()
