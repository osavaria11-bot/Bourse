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
  snapshot.quotes[0].currency = "USD";
  await live.refresh(); assert.equal(live.current("TSX"), null, "A provider's explicit currency violation must fall back to the daily close");
  tmxDown = false;
  await live.refresh(); assert.equal(live.current("TSX").currency, "CAD"); assert.equal(live.current("TSX").source_label, "TMX Money",
    "An independently verified Canadian listing can recover while the other provider still reports the wrong currency");
});

test("the independent feed updates SPX and stocks while Pages is frozen, and recovers after an outage", async () => {
  let clock = Date.parse("2026-10-27T18:00:00Z"), feedDown = false, pagesDown = false;
  const requests = [], snapshot = (stamp, price) => ({schema_version: 1, kind: "intraday_quotes", generated_at: new Date(stamp).toISOString(),
    quotes: [["SPX", "^GSPC"], ["AAPL", "AAPL"]].map(([id, quote_symbol]) => ({id, quote_symbol, currency: "USD", price,
      timestamp: new Date(stamp - 1000).toISOString(), fetched_at: new Date(stamp).toISOString(), session_date: "2026-10-27",
      exchange_timezone: "America/New_York", market_state: "regular", fetch_status: "fresh", session_end: "2026-10-27T20:00:00Z"}))});
  const frozen = snapshot(clock - 3600000, 100);
  const window = {IntradayUtils: {...I, normalize: p => I.normalize(p, clock), choose: (p, id, base) => I.choose(p, id, base, clock)}, addEventListener() {}};
  vm.runInNewContext(fs.readFileSync("js/live-quotes.js", "utf8"), {window,
    Date: class extends Date {static now() {return clock;}}, URLSearchParams, AbortController, Event, setTimeout, clearTimeout, setInterval() {},
    document: {visibilityState: "visible", dispatchEvent() {}, addEventListener() {}},
    localStorage: {getItem() {}, setItem() {}}, fetch: async url => {
      requests.push(url); const independent = url.startsWith("https://raw.githubusercontent.com/");
      if (independent ? feedDown : pagesDown) throw Error("Unavailable");
      // Make the stale Pages response arrive AFTER the fresh independent one.
      if (!independent) await new Promise(resolve => setTimeout(resolve, 5));
      return {ok: true, json: async () => independent ? snapshot(clock, 200) : structuredClone(frozen)};
    }});
  const live = window.SavyLiveQuotes; await live.refresh();
  assert.equal(live.current("SPX").price, 200); assert.equal(live.current("AAPL").price, 200);
  assert.equal(live.current("SPX").stale, false);
  assert.ok(requests.some(url => url.startsWith("https://raw.githubusercontent.com/osavaria11-bot/Bourse/savy-live-quotes/")));
  const received = live.current("SPX").fetched_at;
  clock += 20 * 60000; feedDown = true; await live.refresh();
  assert.equal(live.current("SPX").price, 200); assert.equal(live.current("SPX").fetched_at, received);
  assert.equal(live.current("SPX").stale, true, "An outage retains the genuine dated price and labels it stale");
  feedDown = false; pagesDown = true; await live.refresh();
  assert.equal(live.current("SPX").stale, false); assert.equal(live.current("AAPL").stale, false);
  assert.equal(live.current("SPX").timestamp, new Date(clock - 1000).toISOString());
});
