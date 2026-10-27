"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const publish = require("../scripts/publish_intraday_quotes.cjs");
const now = Date.parse("2026-10-27T18:20:00Z");
const payload = () => ({schema_version: 1, kind: "intraday_quotes", generated_at: new Date(now).toISOString(), quotes: [{
  id: "SPX", quote_symbol: "^GSPC", currency: "USD", price: 7000, timestamp: new Date(now - 10000).toISOString(),
  fetched_at: new Date(now).toISOString(), exchange_timezone: "America/New_York", session_date: "2026-10-27",
  market_state: "regular", fetch_status: "fresh"
}]});
function fixture(old = null) {
  const calls = [], messages = [], action = name => async args => {calls.push([name, args]); return {data: {sha: name + "-sha"}};};
  return {calls, messages, args: {payload: payload(), now, context: {repo: {owner: "example", repo: "site"}, runId: 55},
    core: {info: s => messages.push(s), warning: s => messages.push(s)},
    github: {rest: {git: {
      getRef: async () => {if (!old) throw Object.assign(Error("No feed yet"), {status: 404}); return {data: {object: {sha: "previous-commit"}}};},
      getCommit: async () => ({data: {tree: {sha: "previous-tree"}}}),
      createTree: action("createTree"), createCommit: action("createCommit"), createRef: action("createRef"), updateRef: action("updateRef")
    }, repos: {getContent: async () => ({data: {content: Buffer.from(JSON.stringify(old)).toString("base64")}})}}}}};
}
test("the first independent publication contains only public quotes and never creates a Pages/main commit", async () => {
  const f = fixture(); assert.equal(await publish(f.args), "published");
  const tree = f.calls.find(([name]) => name === "createTree")[1];
  assert.deepEqual(tree.tree.map(row => row.path), ["intraday-quotes.json"]);
  const data = JSON.parse(tree.tree[0].content);
  assert.equal(data.delivery.channel, "independent"); assert.equal(data.delivery.workflow_run_id, 55);
  assert.equal(data.quotes[0].timestamp, payload().quotes[0].timestamp);
  assert.deepEqual(f.calls.find(([name]) => name === "createCommit")[1].parents, []);
  assert.equal(f.calls.at(-1)[1].ref, "refs/heads/savy-live-quotes");
});
test("subsequent publications are fast-forwards on the data branch and preserve other branch files", async () => {
  const f = fixture({...payload(), generated_at: new Date(now - 300000).toISOString()});
  assert.equal(await publish(f.args), "published");
  assert.equal(f.calls.find(([name]) => name === "createTree")[1].base_tree, "previous-tree");
  assert.deepEqual(f.calls.find(([name]) => name === "createCommit")[1].parents, ["previous-commit"]);
  assert.equal(f.calls.at(-1)[1].ref, "heads/savy-live-quotes"); assert.equal(f.calls.at(-1)[1].force, false);
});
test("an older or duplicate run cannot roll the live feed back", async () => {
  for (const ahead of [0, 300000]) {
    const f = fixture({...payload(), generated_at: new Date(now + ahead).toISOString()});
    assert.equal(await publish(f.args), "newer_exists"); assert.deepEqual(f.calls, []);
  }
});
test("invalid, empty and expired collections fail before any publication", async () => {
  for (const change of [p => p.quotes = [], p => p.quotes.push({...p.quotes[0]}),
    p => p.quotes[0].price = -1, p => p.generated_at = new Date(now - 11 * 60000).toISOString()]) {
    const f = fixture(); change(f.args.payload);
    await assert.rejects(publish(f.args), /invalid|empty|expired/); assert.deepEqual(f.calls, []);
  }
});
test("a GitHub error cannot recreate the branch or overwrite its last working snapshot", async () => {
  const f = fixture(); f.args.github.rest.git.getRef = async () => {throw Object.assign(Error("API unavailable"), {status: 503});};
  await assert.rejects(publish(f.args), /API unavailable/); assert.deepEqual(f.calls, []);
});
