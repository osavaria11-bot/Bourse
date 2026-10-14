const test = require("node:test"), assert = require("node:assert/strict");
const I = require("../js/intraday-utils.js"), U = require("../js/macro-utils.js");
const P = require("../js/portfolio-utils.js"), F = require("../js/portfolio-analytics-utils.js");
const now = Date.parse("2026-10-12T14:00:00Z");
function q(id = "AAPL", price = 110, currency = "USD") {return {id, price, currency, quote_symbol: id,
  timestamp: "2026-10-12T13:59:00Z", fetched_at: "2026-10-12T14:00:00Z", session_date: "2026-10-12",
  exchange_timezone: "America/New_York", market_state: "regular", fetch_status: "fresh",
  session_end: "2026-10-12T20:00:00Z", previous_close: 100};}
function data(quotes) {return {schema_version: 1, kind: "intraday_quotes", generated_at: "2026-10-12T14:00:00Z", quotes};}
function point(id, value, currency = "USD") {return {id, quote_symbol: id, currency, date: "2026-10-09", value,
  history: [["2025-12-31", value * .8], ["2026-10-07", value], ["2026-10-08", value], ["2026-10-09", value]]};}
test("quote normalization validates the exchange-local date and fixes attribution", () => {
  const result = I.normalize(data([{...q(), source_url: "https://evil.example/", source_label: "Invented"}]), now);
  assert.equal(result.quotes[0].source_url, "https://finance.yahoo.com/quote/AAPL/");
  assert.equal(result.quotes[0].source_label, "Yahoo Finance");
  assert.equal(I.normalize(data([{...q(), session_date: "2026-10-11"}, {...q("SHOP"), price: 0}]), now).quotes.length, 0);
  assert.equal(I.choose(result, "AAPL", {...point("AAPL", 100), currency: "CAD"}, now), null);
});
test("a validated last trade survives a missing or empty candle history without changing its timestamp", () => {
  for (const history of [undefined, [], [["2026-10-12T14:05:00Z", 120], ["2026-10-12T13:30:00Z", null]]]) {
    const row = {...q(), intraday_history: history};
    const normalized = I.normalize(data([row]), now).quotes[0];
    assert.deepEqual(normalized.intraday_history, [["2026-10-12T13:59:00.000Z", 110]]);
    assert.equal(normalized.timestamp, row.timestamp);
    assert.equal(I.marketSession(point("AAPL", 100), data([normalized]), now).available, false,
      "One observed trade alone is not a standalone instrument curve");
  }
});
test("one-session return includes the current trade and preserves the immutable close history", () => {
  const base = point("AAPL", 100), before = structuredClone(base);
  const live = I.marketPoint(base, I.normalize(data([q()]), now), now), result = U.marketPeriod(live, "1D");
  assert.equal(result.start, "2026-10-09"); assert.equal(result.end, "2026-10-12");
  assert.ok(Math.abs(result.percent - 10) < 1e-10);
  assert.deepEqual(base, before);
});
test("closed Canadian session does not gain an extra trading day from a live FX quote", () => {
  const base = {series: [point("SHOP", 100, "CAD"), point("USDCAD", 1.3, "CAD")]};
  const closed = {...q("SHOP", 101, "CAD"), session_date: "2026-10-09", timestamp: "2026-10-09T19:59:00Z", market_state: "closed"};
  const view = I.portfolioView(base, [{ticker: "SHOP", currency: "CAD", quantity: 2}], data([closed]),
    {rate: 1.4, timestamp: "2026-10-12T14:00:00Z"}, now);
  assert.equal(view.series[0].date, "2026-10-09");
  assert.deepEqual(view.series[1], base.series[1]);
  assert.equal(P.historyFor([{ticker: "SHOP", currency: "CAD", quantity: 2}], view).at(-1)[0], "2026-10-09");
});
test("live CAD valuation, period return and contributions agree including current FX", () => {
  const base = {series: [point("AAPL", 100), point("SHOP", 50, "CAD"), point("USDCAD", 1.3, "CAD")]};
  const original = structuredClone(base), holdings = [{ticker: "AAPL", currency: "USD", quantity: 2}, {ticker: "SHOP", currency: "CAD", quantity: 1}];
  const view = I.portfolioView(base, holdings, data([q(), q("SHOP", 55, "CAD")]),
    {rate: 1.4, timestamp: "2026-10-12T14:00:00Z"}, now);
  const history = P.historyFor(holdings, view), selected = P.period(history, "3D"), attribution = F.contributionsFor(holdings, view, selected);
  assert.equal(history.at(-1)[1], 2 * 110 * 1.4 + 55);
  assert.ok(attribution.available); assert.ok(Math.abs(attribution.total - selected.percent) < 1e-10);
  assert.deepEqual(base, original);
  assert.equal(P.historyFor(holdings, base).at(-1)[0], "2026-10-09", "Daily risk inputs must remain closing prices");
});
test("older snapshots, mismatched listings and stale trades are described accurately", () => {
  const payload = data([q()]);
  assert.equal(I.choose(payload, "AAPL", {...point("AAPL", 100), date: "2026-10-13"}, now), null);
  assert.equal(I.choose(payload, "AAPL", {...point("AAPL", 100), quote_symbol: "AAPL.TO"}, now), null);
  const stale = I.choose(payload, "AAPL", null, now + 35 * 60000);
  assert.ok(stale.stale); assert.match(I.label(stale), /Cotation conservée/);
  const closed = I.choose(data([{...q(), market_state: "closed"}]), "AAPL", null, now);
  assert.match(I.label(closed), /Marché fermé/);
  assert.equal(I.choose(payload, "AAPL", null, now + 8 * 86400000), null);
});
test("current market numbers require a recent successful collection, including when the exchange is closed", () => {
  const fresh = I.choose(I.normalize(data([q()]), now), "AAPL", null, now);
  assert.equal(I.isCurrent(fresh, now), true);
  assert.equal(I.isCurrent({...fresh, fetch_status: "cached"}, now), false);
  assert.equal(I.isCurrent(fresh, now + 13 * 60000), false);
  const closed = {...fresh, active: false, timestamp: "2026-10-09T19:59:00Z"};
  assert.equal(I.isCurrent(closed, now), true);
  assert.equal(I.isCurrent(closed, now + 13 * 60000), false);
});
test("intraday charts keep only actual session points and use the previous close as their return base", () => {
  const quote = {...q(), intraday_history: [["2026-10-09T13:30:00Z", 100], ["2026-10-12T13:30:00Z", 105],
    ["2026-10-12T13:30:00Z", 106], ["2026-10-12T13:45:00Z", null], ["2026-10-12T14:05:00Z", 120]]};
  const payload = I.normalize(data([quote]), now), selected = I.marketSession(point("AAPL", 100), payload, now);
  assert.deepEqual(selected.history, [["2026-10-12T13:30:00.000Z", 106], ["2026-10-12T13:59:00.000Z", 110]]);
  assert.ok(Math.abs(selected.percent - 10) < 1e-10);
  const delayed = I.marketSession(point("AAPL", 100), payload, now + 35 * 60000);
  assert.equal(delayed.available, true); assert.equal(delayed.current, false);
  assert.deepEqual(delayed.history, selected.history);
  assert.match(I.label(delayed.quote), /Cotation conservée/);
  assert.equal(I.marketSession(point("AAPL", 100), payload, now + 8 * 86400000).available, false);
  assert.equal(I.clock(now), I.clock(new Date(now).toISOString()));
});
