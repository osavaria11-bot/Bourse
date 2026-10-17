"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), P = require("../js/polymarket-utils.js"), fixture = require("./polymarket-fixture.cjs");
const NOW = Date.parse("2026-10-17T17:00:00Z");
test("eight distinct events preserve named scenario prices, including 0 and 100 percent", () => {
  const raw = fixture(NOW); raw.groups.finance.events[0].outcomes[0].probability = 0; raw.groups.finance.events[0].outcomes[1].probability = 1;
  const next = P.normalize(raw, NOW);
  assert.equal(next.groups.finance.events.length, 3); assert.equal(next.groups.popular.events.length, 5);
  assert.equal(P.percent(next.groups.finance.events[0].outcomes[0].probability), "0 %");
  assert.equal(P.percent(next.groups.finance.events[0].outcomes[1].probability), "100 %");
  assert.equal(P.label("Yes"), "Oui"); assert.equal(P.label("No"), "Non"); assert.equal(P.label("Company A"), "Company A");
});
test("unsafe links, duplicate events, invalid prices and future snapshots are rejected", () => {
  for (const mutate of [x=>x.groups.finance.events[0].url="javascript:bad", x=>x.groups.finance.events[0].slug="../bad",
    x=>x.groups.finance.events[0].outcomes[0].probability=null, x=>x.groups.finance.events[0].outcomes[0].probability=1.01,
    x=>x.groups.finance.events[0].outcomes[0].probability=true, x=>x.groups.popular.events[0]=x.groups.finance.events[0],
    x=>x.generated_at="2027-01-01T00:00:00Z", x=>x.groups.finance.fetched_at="2027-01-01T00:00:00Z",
    x=>x.groups.finance.ranking="fake", x=>x.provider="other"]) {
    const raw=fixture(NOW); mutate(raw); assert.throws(()=>P.normalize(raw,NOW));
  }
});
test("expired events and scenarios disappear without replacement or fabricated zeroes", () => {
  const raw=fixture(NOW); raw.groups.finance.events[0].ends_at=new Date(NOW).toISOString();
  raw.groups.finance.events[1].outcomes[0].ends_at=new Date(NOW).toISOString();
  const result=P.normalize(raw,NOW);
  assert.equal(result.groups.finance.events.length,2);
  assert.deepEqual(result.groups.finance.events[0].outcomes.map(x=>x.label),["Scenario B"]);
});
test("partial outages and older deployment files retain each group's latest fetch time", () => {
  const current=fixture(NOW), unavailable=fixture(NOW+60000);
  unavailable.groups.popular={ranking:"volume24hr", fetch_status:"unavailable", fetched_at:null, events:[]};
  const merged=P.merge(current,unavailable,NOW+60000);
  assert.equal(merged.groups.popular.fetch_status,"cached");
  assert.equal(merged.groups.popular.fetched_at,current.groups.popular.fetched_at);
  assert.equal(merged.groups.finance.fetched_at,unavailable.groups.finance.fetched_at);
  const older=P.merge(current,fixture(NOW-3600000),NOW);
  assert.equal(older.groups.finance.fetched_at,current.groups.finance.fetched_at);
  assert.equal(older.groups.popular.fetch_status,"cached");
  assert.doesNotThrow(()=>P.normalize(older,NOW));
});
