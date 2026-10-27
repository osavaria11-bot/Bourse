const test = require("node:test"), assert = require("node:assert/strict");
const queue = require("../scripts/queue_intraday_refresh.cjs");
const time = Date.parse("2026-10-12T18:20:00Z");
function fixture(runs = [], head = "validated-source") {
  const delays = [], dispatches = [];
  return {delays, dispatches, args: {sourceSha: "validated-source", collectedAt: "2026-10-12T18:20:00Z",
    now: () => time, wait: async ms => delays.push(ms), core: {info() {}}, context: {runId: 7, repo: {owner: "owner", repo: "repo"}},
    github: {rest: {repos: {getBranch: async () => ({data: {commit: {sha: head}}})}, actions: {
      listWorkflowRuns: async () => ({data: {workflow_runs: runs}}),
      createWorkflowDispatch: async args => dispatches.push(args)}}}}};
}
test("a validated quote refresh queues its successor independently of calendar scheduling", async () => {
  const f = fixture([{id: 7, head_branch: "main", status: "in_progress"}]);
  assert.equal(await queue(f.args), "queued");
  assert.deepEqual(f.delays, [300000]);
  assert.deepEqual(f.dispatches, [{owner: "owner", repo: "repo", workflow_id: "intraday-quotes.yml", ref: "main"}]);
});
test("deployment time counts toward the interval and a failed attempt can retry without changing the old quote time", async () => {
  const f = fixture(); f.args.now = () => time + 2 * 60000;
  await queue(f.args); assert.deepEqual(f.delays, [180000]);
  const delayed = fixture(); delayed.args.now = () => time + 7 * 60000;
  await queue(delayed.args); assert.deepEqual(delayed.delays, [0]);
});
test("overlapping manual, scheduled and deployment refreshes cannot multiply the chain", async () => {
  for (const status of ["queued", "pending", "waiting", "requested", "in_progress"]) {
    const f = fixture([{id: 8, head_branch: "main", status}]);
    assert.equal(await queue(f.args), "already_queued"); assert.equal(f.dispatches.length, 0);
  }
  const done = fixture([{id: 8, head_branch: "main", status: "completed"}]);
  assert.equal(await queue(done.args), "queued");
});
test("a main change cannot stop the independent feed while full-site validation is pending", async () => {
  const f = fixture([], "new-source");
  f.args.github.rest.repos.getBranch = async () => {throw Error("Pages/main validation must not be consulted");};
  assert.equal(await queue(f.args), "queued"); assert.equal(f.dispatches.length, 1);
  assert.deepEqual(f.delays, [300000]);
});
test("a source change during the interval still dispatches the latest main", async () => {
  const f = fixture();
  f.args.wait = async ms => {f.delays.push(ms); f.args.sourceSha = "changed-source";};
  assert.equal(await queue(f.args), "queued"); assert.deepEqual(f.delays, [300000]); assert.equal(f.dispatches[0].ref, "main");
});
test("weekends do not create an endless closed-market refresh chain", async () => {
  const f = fixture(); f.args.now = () => Date.parse("2026-10-17T18:20:00Z");
  assert.equal(await queue(f.args), "weekend"); assert.equal(f.dispatches.length, 0);
});
test("invalid or future timing cannot start a runaway dispatcher", async () => {
  for (const collectedAt of ["bad", "2026-10-13T18:20:00Z"]) {
    const f = fixture(); f.args.collectedAt = collectedAt;
    await assert.rejects(queue(f.args), /Invalid collection time/);
    assert.equal(f.dispatches.length, 0); assert.deepEqual(f.delays, []);
  }
});
