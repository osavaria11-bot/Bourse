const test = require("node:test"), assert = require("node:assert/strict");
const I = require("../js/intraday-utils.js"), T = require("../js/portfolio-intraday-utils.js"), F = require("../js/portfolio-analytics-utils.js");
const now = Date.parse("2026-10-12T14:00:00Z");
const positions = [{ticker: "AAPL", currency: "USD", quantity: 2}, {ticker: "SHOP", currency: "CAD", quantity: 1}];
function point(id, symbol, currency, value) {return {id, title: id, quote_symbol: symbol, currency, decimals: 2,
  history: [["2026-10-08", value], ["2026-10-09", value]], date: "2026-10-09", value};}
const prices = {series: [point("AAPL", "AAPL", "USD", 100), point("SHOP", "SHOP.TO", "CAD", 50),
  point("USDCAD", "CAD=X", "CAD", 1.3), ...[["FEQT", "FEQT.NE"], ["VBAL", "VBAL.TO"], ["VGRO", "VGRO.TO"]].map(([id, symbol]) => point(id, symbol, "CAD", 10))]};
function q(id, price, previous, first = price) {
  const source = prices.series.find(p => p.id === id);
  return {id, quote_symbol: source.quote_symbol, currency: source.currency, price, previous_close: previous,
    timestamp: "2026-10-12T13:59:00Z", fetched_at: "2026-10-12T14:00:00Z", session_date: "2026-10-12",
    exchange_timezone: "America/Toronto", market_state: "regular", fetch_status: "fresh", session_end: "2026-10-12T20:00:00Z",
    intraday_history: [["2026-10-12T13:30:00Z", first], ["2026-10-12T13:55:00Z", price]]};
}
function payload(rows) {return I.normalize({schema_version: 1, kind: "intraday_quotes", generated_at: "2026-10-12T14:00:00Z", quotes: rows}, now);}
test("intraday CAD valuation, currency movement, contributions and each benchmark share one previous-close base", () => {
  for (const benchmark of ["FEQT", "VBAL", "VGRO"]) {
    const before = structuredClone(prices), rows = [q("AAPL", 110, 100, 105), q("SHOP", 55, 50, 51), q("USDCAD", 1.4, 1.3, 1.32), q(benchmark, 11, 10, 10.5)];
    const view = T.session(positions, prices, payload(rows), benchmark, {rate: 1.41, timestamp: "2026-10-12T14:00:00Z", closed: false}, now);
    assert.equal(view.available, true);
    assert.equal(view.selected.history[0][1], 2 * 105 * 1.32 + 51);
    const total = 2 * 110 * 1.41 + 55, baseline = 2 * 100 * 1.3 + 50;
    assert.equal(view.selected.history.at(-1)[1], total);
    assert.ok(Math.abs(view.selected.percent - (total / baseline - 1) * 100) < 1e-10);
    assert.ok(Math.abs(view.comparison.benchmark_percent - 10) < 1e-10);
    const contributions = F.contributionsFor(positions, view.data, view.selected);
    assert.equal(contributions.available, true);
    assert.ok(Math.abs(contributions.total - view.selected.percent) < 1e-10);
    assert.equal(view.comparison.points[0].date, "2026-10-12T13:30:00.000Z", "The previous close is a return base, never a fabricated intraday tick");
    assert.deepEqual(prices, before);
  }
});
test("a closed Canadian holding stays at its last close while the US holding and FX trade", () => {
  const closed = {...q("SHOP", 50, 45), timestamp: "2026-10-09T19:59:00Z", session_date: "2026-10-09", market_state: "closed",
    intraday_history: [["2026-10-09T13:30:00Z", 48], ["2026-10-09T19:55:00Z", 50]]};
  const view = T.session(positions, prices, payload([q("AAPL", 110, 100, 105), closed, q("USDCAD", 1.4, 1.3, 1.32), q("FEQT", 11, 10)]), "FEQT", null, now);
  assert.equal(view.available, true); assert.equal(view.session_date, "2026-10-12");
  assert.equal(view.selected.history.at(-1)[1], 2 * 110 * 1.4 + 50);
});
test("a closed all-CAD portfolio shows Friday's actual curve and never creates Monday ticks", () => {
  const rows = [q("SHOP", 50, 45, 48), q("VBAL", 11, 10, 10.5)].map(row => ({...row, market_state: "closed", session_date: "2026-10-09",
    timestamp: "2026-10-09T19:59:00Z", intraday_history: [["2026-10-09T13:30:00Z", row.intraday_history[0][1]], ["2026-10-09T19:55:00Z", row.price]]}));
  const view = T.session([positions[1]], prices, payload(rows), "VBAL", null, now);
  assert.equal(view.available, true); assert.equal(view.session_date, "2026-10-09");
  assert.ok(view.selected.history.every(row => row[0].startsWith("2026-10-09T")));
  assert.ok(Math.abs(view.selected.percent - (50 / 45 - 1) * 100) < 1e-10);
});
test("sparse ETF trades do not block VBAL or VGRO portfolios and never leak future prices", () => {
  for (const benchmark of ["VBAL", "VGRO"]) {
    const holdings = [{ticker: "SHOP", currency: "CAD", quantity: 1}, {ticker: "FEQT", currency: "CAD", quantity: 2}];
    for (const sparseHistory of [[["2026-10-12T13:59:00Z", 12]], []]) {
      const sparse = {...q("FEQT", 12, 10), intraday_history: sparseHistory};
      const rows = [q("SHOP", 55, 50, 51), sparse, q(benchmark, 11, 10, 10.5)];
      const view = T.session(holdings, prices, payload(rows), benchmark, null, now);
      assert.equal(view.available, true);
      assert.equal(view.comparison.available, true);
      assert.equal(view.selected.history[0][1], 51 + 2 * 10, "Use previous close before the ETF's first actual trade");
      assert.equal(view.selected.history.at(-1)[1], 55 + 2 * 12);
      assert.ok(Math.abs(view.selected.percent - (79 / 70 - 1) * 100) < 1e-10);
      assert.ok(Math.abs(F.contributionsFor(holdings, view.data, view.selected).total - view.selected.percent) < 1e-10);
      assert.deepEqual(view.data.series.find(row => row.id === "FEQT").history,
        [["2026-10-09", 10], ["2026-10-12T13:59:00.000Z", 12]], "No invented ETF candles");
    }
    assert.deepEqual(T.session(holdings, prices, payload([q("SHOP", 55, 50), q(benchmark, 11, 10)]), benchmark, null, now).missing, ["FEQT"]);
  }
});
test("a portfolio with only one total observation still cannot produce an intraday curve", () => {
  const sparse = {...q("SHOP", 55, 50), intraday_history: []};
  assert.equal(T.session([positions[1]], prices, payload([sparse, q("VBAL", 11, 10)]), "VBAL", null, now).available, false);
});
test("intraday curves retain dated quotes but reject wrong listings and missing currency curves", () => {
  const rows = [q("AAPL", 110, 100), q("SHOP", 55, 50), q("USDCAD", 1.4, 1.3), q("FEQT", 11, 10)];
  const retained = T.session(positions, prices, payload(rows), "FEQT", null, now + 35 * 60000);
  assert.equal(retained.available, true); assert.equal(retained.current, false);
  assert.equal(retained.selected.end, "2026-10-12T13:59:00.000Z");
  assert.equal(T.session(positions, prices, payload(rows), "FEQT", null, now + 8 * 86400000).available, false);
  const wrong = structuredClone(rows); wrong[0].currency = "CAD";
  assert.deepEqual(T.session(positions, prices, payload(wrong), "FEQT", null, now).missing, ["AAPL"]);
  const noFx = structuredClone(rows); noFx[2].intraday_history = [];
  assert.deepEqual(T.session(positions, prices, payload(noFx), "FEQT", null, now).missing, ["USDCAD"]);
});
test("all three benchmarks survive collection delays without appending a newer FX tick to old equity quotes", () => {
  for (const benchmark of ["FEQT", "VBAL", "VGRO"]) {
    const rows = [q("AAPL", 110, 100, 105), q("SHOP", 55, 50, 51), q("USDCAD", 1.4, 1.3, 1.32), q(benchmark, 11, 10, 10.5)];
    const fresh = T.session(positions, prices, payload(rows), benchmark, null, now);
    rows[0].fetch_status = "cached";
    const retained = T.session(positions, prices, payload(rows), benchmark,
      {rate: 1.6, timestamp: "2026-10-12T14:35:00Z", closed: false}, now + 35 * 60000);
    assert.equal(retained.available, true); assert.equal(retained.current, false);
    assert.deepEqual(retained.selected.history, fresh.selected.history);
    assert.equal(retained.comparison.available, true);
    assert.equal(retained.fx.stale, true);
    assert.ok(Math.abs(F.contributionsFor(positions, retained.data, retained.selected).total - retained.selected.percent) < 1e-10);
  }
});
test("closed US holdings use the actual FX history of their session, not a newer forex day", () => {
  const rows = [q("AAPL", 110, 100, 105), q("SHOP", 55, 50, 51), q("FEQT", 11, 10, 10.5)].map(row => ({...row,
    market_state: "closed", session_date: "2026-10-09", timestamp: "2026-10-09T19:59:00Z",
    intraday_history: [["2026-10-09T13:30:00Z", row.intraday_history[0][1]], ["2026-10-09T19:55:00Z", row.price]]}));
  const fx = {...q("USDCAD", 1.6, 1.5), intraday_sessions: {"2026-10-09": [["2026-10-09T13:30:00Z", 1.32], ["2026-10-09T19:59:00Z", 1.4]]}};
  const view = T.session(positions, prices, payload([...rows, fx]), "FEQT", {rate: 1.6, timestamp: "2026-10-12T14:00:00Z", closed: false}, now);
  assert.equal(view.available, true); assert.equal(view.session_date, "2026-10-09");
  assert.equal(view.selected.history.at(-1)[1], 2 * 110 * 1.4 + 55);
  assert.ok(view.selected.history.every(row => row[0].startsWith("2026-10-09T")));
});
