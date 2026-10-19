"use strict";
const {test} = require("node:test"), assert = require("node:assert/strict");
const ensure = require("../scripts/ensure_validated_source.cjs"), SHA = "a".repeat(40);
const run = overrides => ({id: 30, head_sha: SHA, head_branch: "main", status: "completed", conclusion: "failure", run_attempt: 1, ...overrides});
async function check(runs, head = SHA, fail = false) {
  const calls = [], messages = [], repo = {owner: "example", repo: "site"};
  const github = {rest: {actions: {listWorkflowRuns: async args => {assert.equal(args.head_sha, SHA); return {data: {workflow_runs: runs}};}},
    git: {getRef: async () => ({data: {object: {sha: head}}})}}, request: async (route, args) => {calls.push({route, ...args}); if (fail) throw new Error("Synthetic API outage");}};
  const ready = await ensure({github, context: {repo}, core: {info: s => messages.push(s), warning: s => messages.push(s)}, sourceSha: SHA});
  return {ready, calls, messages};
}
test("a validated exact current commit resumes quotes without retrying or weakening validation", async () => {
  const result = await check([run({conclusion: "success"})]); assert.equal(result.ready, true); assert.equal(result.calls.length, 0);
});
test("only failed current-main jobs get two bounded automatic retries", async () => {
  for (const run_attempt of [1, 2]) {
    const result = await check([run({run_attempt})]); assert.equal(result.ready, false); assert.equal(result.calls.length, 1);
    assert.match(result.calls[0].route, /rerun-failed-jobs$/); assert.equal(result.calls[0].run_id, 30);
  }
  assert.equal((await check([run({run_attempt: 3})])).calls.length, 0);
});
test("queued, running, cancelled, superseded and foreign runs cannot create retries", async () => {
  for (const runs of [[], [run({status: "queued", conclusion: null})], [run({status: "in_progress", conclusion: null}), run({id: 20})],
    [run({conclusion: "cancelled"})], [run({head_sha: "b".repeat(40)})], [run({head_branch: "feature"})]]) {
    const result = await check(runs); assert.equal(result.ready, false); assert.equal(result.calls.length, 0);
  }
  for (const conclusion of ["failure", "success"]) {
    const result = await check([run({conclusion})], "b".repeat(40)); assert.equal(result.ready, false); assert.equal(result.calls.length, 0);
  }
});
test("API retry failures preserve the published site and never authorize unvalidated quotes", async () => {
  const result = await check([run()], SHA, true); assert.equal(result.ready, false); assert.match(result.messages.join(" "), /Synthetic API outage/);
});
