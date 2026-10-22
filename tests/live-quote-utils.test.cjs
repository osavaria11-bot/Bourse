const test = require("node:test"), assert = require("node:assert/strict"), vm = require("node:vm"), fs = require("node:fs");
const I = require("../js/intraday-utils.js"), J = require("../js/index-quote-utils.js");
test("direct indices recover without Pages, survive a provider outage and never regress to an older published price", async () => {
  let clock = Date.parse("2026-10-22T15:02:00Z"), publishedDown = true, tmxDown = false, snapshot;
  const data = {};
  for (const d of J.definitions) {
    data["q" + d.id] = {symbol: d.symbol, currency: d.currency, datatype: d.type, prevClose: 100};
    data["c" + d.id] = [{dateTime: "2026-10-22T10:50:00-04:00", close: 101}, {dateTime: "2026-10-22T10:55:00-04:00", close: 102}];
  }
  const window = {IndexQuoteUtils: J, IntradayUtils: {...I, normalize: p => I.normalize(p, clock),
    choose: (p, id, base) => I.choose(p, id, base, clock), collectionIsCurrent: q => I.collectionIsCurrent(q, clock)}, addEventListener() {}};
  const store = new Map();
  vm.runInNewContext(fs.readFileSync("js/live-quotes.js", "utf8"), {window,
    Date: class extends Date {static now() {return clock;}}, URLSearchParams, AbortController, Event, setTimeout, clearTimeout, setInterval() {},
    document: {visibilityState: "visible", dispatchEvent() {}, addEventListener() {}},
    localStorage: {getItem: k => store.get(k), setItem: (k, v) => store.set(k, v)},
    fetch: async url => {
      const direct = url.startsWith("https://app-money.tmx.com/graphql?");
      if (direct ? tmxDown : publishedDown) throw new Error("Provider unavailable");
      return {ok: true, json: async () => structuredClone(direct ? {data} : snapshot)};
    }});
  const live = window.SavyLiveQuotes; await live.refresh();
  const original = live.current("TSX");
  assert.equal(original.price, 102); assert.equal(original.source_label, "TMX Money");
  assert.equal(original.timestamp, "2026-10-22T15:00:00.000Z");
  clock += 20 * 60000; tmxDown = true; await live.refresh();
  assert.equal(live.current("TSX").fetched_at, original.fetched_at);
  assert.equal(live.current("TSX").stale, true);
  publishedDown = false;
  snapshot = {schema_version: 1, kind: "intraday_quotes", generated_at: new Date(clock).toISOString(), quotes: [
    {...original, source_provider: "yahoo", price: 99, timestamp: "2026-10-22T14:45:00Z", fetched_at: new Date(clock).toISOString()}]};
  await live.refresh(); assert.equal(live.current("TSX").price, 102); assert.equal(live.current("TSX").source_label, "TMX Money");
  snapshot.quotes[0].timestamp = new Date(clock - 60000).toISOString(); snapshot.quotes[0].price = 110;
  await live.refresh(); assert.equal(live.current("TSX").price, 110); assert.equal(live.current("TSX").source_label, "Yahoo Finance");
  assert.equal(live.current("TSX").stale, false);
});
