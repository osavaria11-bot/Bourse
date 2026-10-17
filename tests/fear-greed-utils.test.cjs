"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const F = require("../js/fear-greed-utils.js");
const NOW = Date.parse("2026-10-17T13:36:00Z");
const sample = () => ({schema_version: 1, kind: "cnn_fear_and_greed", provider: "cnn", generated_at: "2026-10-17T13:30:00Z",
  score: 17.94, rating: "extreme fear", timestamp: "2026-10-16T23:59:49Z", previous_close: 31.54,
  fetch_status: "fresh", last_successful_fetch: "2026-10-17T13:30:00Z"});

test("CNN scores retain both endpoints, the published rating, and the original publication time", () => {
  for (const score of [0, 18.125, 100]) {
    const point = F.normalize({...sample(), score, source_url: "javascript:bad"}, NOW);
    assert.equal(point.score, score);
    assert.equal(point.timestamp, "2026-10-16T23:59:49Z");
    assert.equal(point.source_url, "https://www.cnn.com/markets/fear-and-greed");
    assert.equal(F.RATINGS[point.rating], "Peur extrême");
  }
});
test("invalid scores, future publications, unknown ratings and a different provider are rejected", () => {
  const invalid = [null, {...sample(), provider: "crypto"}, {...sample(), rating: "__proto__"},
    {...sample(), timestamp: "2026-10-18T00:00:00Z"}, {...sample(), timestamp: "2026-10-16"},
    {...sample(), fetch_status: "unavailable"},
    ...[true, null, -1, 101, "18", NaN, Infinity].map(score => ({...sample(), score}))];
  for (const value of invalid) assert.throws(() => F.normalize(value, NOW));
});
test("outages remain unavailable, while a cached publication keeps its dated value", () => {
  const missing = F.normalize({...sample(), fetch_status: "unavailable", score: null}, NOW);
  assert.equal(missing.score, null); assert.equal(missing.timestamp, null); assert.equal(missing.rating, null);
  const cached = F.normalize({...sample(), fetch_status: "cached"}, NOW);
  assert.equal(cached.timestamp, sample().timestamp); assert.equal(cached.last_successful_fetch, sample().last_successful_fetch);
});
test("the change is expressed in index points against CNN's previous close", () => {
  assert.equal(F.changeLabel(sample()), "−13,6 pts depuis la clôture précédente");
  assert.equal(F.changeLabel({...sample(), score: 32, previous_close: 0}), "+32,0 pts depuis la clôture précédente");
  assert.equal(F.changeLabel({...sample(), score: 0, previous_close: 0}), "Stable depuis la clôture précédente");
  assert.equal(F.changeLabel({...sample(), previous_close: null}), "");
});
