"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const P = require("../js/portfolio-utils.js");
test("the price badge compares the native session price to its previous close independently of FX and selected chart period", () => {
  const security = {id: "MSFT", quote_symbol: "MSFT", currency: "USD", history: [["2026-10-08", 536], ["2026-10-09", 537.91]]};
  const quote = {id: "MSFT", quote_symbol: "MSFT", currency: "USD", price: 541.03, previous_close: 537.91, session_date: "2026-10-12"};
  const change = P.sessionChange(security, 541.03, "2026-10-12", quote);
  assert.equal(change.percent.toFixed(2), "0.58"); assert.equal(change.session_date, "2026-10-12");
  assert.equal(P.sessionChange(security, 541.03, "2026-10-12", {...quote, currency: "CAD"}), null);
  assert.equal(P.sessionChange(security, 541.03, "2026-10-12", {...quote, quote_symbol: "MSFT.TO"}), null);
  assert.equal(P.sessionChange(security, 537.91, "2026-10-09", quote), null, "A newer quote cannot label an older displayed price");
});
test("closed-market and historical price badges use the shown session, with missing previous closes left blank", () => {
  const security = {id: "SHOP", quote_symbol: "SHOP.TO", currency: "CAD", history: [["2026-10-08", 100], ["2026-10-09", 98]]};
  const historical = P.sessionChange(security, 98, "2026-10-09");
  assert.ok(Math.abs(historical.percent + 2) < 1e-10); assert.equal(historical.session_date, "2026-10-09");
  const closed = {id: "SHOP", quote_symbol: "SHOP.TO", currency: "CAD", price: 98, previous_close: null, session_date: "2026-10-09", market_state: "closed"};
  assert.deepEqual(P.sessionChange(security, 98, "2026-10-09", closed), historical);
  assert.equal(P.sessionChange({...security, history: [["2026-10-09", 98]]}, 98, "2026-10-09"), null);
  assert.equal(P.sessionChange(security, 110, "2026-10-12"), null, "An unexplained price cannot be assigned a daily return");
});
test("relative performance follows each CAD benchmark's shared return base and preserves missing paired observations", () => {
  for (const benchmark of ["FEQT", "VBAL", "VGRO"]) {
    const selected = {incomplete: false, history: [["2026-10-08", 100], ["2026-10-09", null], ["2026-10-12", 125]]};
    const reference = {id: benchmark, quote_symbol: P.BENCHMARKS[benchmark], currency: "CAD", history: [["2026-10-08", 10], ["2026-10-12", 12]]};
    const comparison = P.benchmarkFor(selected, reference, benchmark), before = structuredClone(comparison);
    const relative = P.relativePerformance(comparison);
    assert.equal(relative.available, true); assert.equal(relative.points[0].difference, 0);
    assert.equal(relative.points[1].difference, null);
    assert.ok(Math.abs(relative.difference - 5) < 1e-10);
    assert.deepEqual(comparison, before);
    assert.equal(P.relativePerformance({...comparison, available: false}).available, false);
    assert.equal(P.relativePerformance({...comparison, normalized: false}).available, false);
  }
});
const catalog = {schema_version: 1, series: [
  {id: "SHOP", title: "Shopify", currency: "CAD", quote_symbol: "SHOP.TO"},
  {id: "CLS", title: "Celestica", currency: "USD", quote_symbol: "CLS"},
]};
function dataset() {
  const history = [["2025-12-31", 100], ["2026-04-09", 110], ["2026-07-09", 120],
    ["2026-09-09", 130], ["2026-10-02", 140], ["2026-10-05", 150], ["2026-10-06", 160],
    ["2026-10-07", 170], ["2026-10-08", 180], ["2026-10-09", 200]];
  return {schema_version: 2, kind: "security_prices", generated_at: new Date().toISOString(),
    series: [...catalog.series, {id: "USDCAD", title: "USD/CAD", currency: "CAD", quote_symbol: "CAD=X"}].map((d, i) => {
      const values = history.map(([day, value]) => [day, i === 2 ? (day === "2025-12-31" ? 1.25 : 1.5) : value]);
      return {...d, date: values.at(-1)[0], value: values.at(-1)[1], history: values, fetch_status: "fresh"};
    })};
}
test("Canadian Shopify and US Celestica retain their exact listings; decimal commas and fractional shares survive", () => {
  const positions = P.normalizePositions([["shop", "2,5", "CAD"], ["CLS", 1.5, "USD"]], catalog);
  assert.deepEqual(positions, [{ticker: "SHOP", quantity: 2.5, currency: "CAD"}, {ticker: "CLS", quantity: 1.5, currency: "USD"}]);
  const prices = P.normalizePrices(dataset(), catalog);
  assert.match(prices.series[0].source_url, /SHOP\.TO/);
  assert.equal(prices.series[1].quote_symbol, "CLS");
  assert.throws(() => P.normalizePositions([["SHOP", 2, "USD"]], catalog), /Devise/);
  for (const quantity of [0, -1, true, Infinity, "bad"]) assert.throws(() => P.normalizePositions([["SHOP", quantity]], catalog));
  assert.throws(() => P.normalizePositions([["SHOP", 1], ["SHOP", 2]], catalog), /deux fois/);
});
test("price source identity and currency mismatches are rejected", () => {
  const wrongSymbol = dataset(); wrongSymbol.series[0].quote_symbol = "SHOP";
  assert.throws(() => P.normalizePrices(wrongSymbol, catalog), /Symbole/);
  const wrongCurrency = dataset(); wrongCurrency.series[1].currency = "CAD";
  assert.throws(() => P.normalizePrices(wrongCurrency, catalog), /devise/);
  const badClose = dataset(); badClose.series[0].value = 999;
  assert.throws(() => P.normalizePrices(badClose, catalog), /Clôture/);
});
test("Microsoft CDR uses its CAD listing independently of the USD Microsoft stock", () => {
  const listings = {schema_version: 1, series: [
    {id: "MSFTCDR", title: "Microsoft CDR", currency: "CAD", quote_symbol: "MSFT.TO"},
    {id: "MSFT", title: "Microsoft", currency: "USD", quote_symbol: "MSFT"},
  ]};
  const data = {schema_version: 2, kind: "security_prices", generated_at: new Date().toISOString(), series:
    [...listings.series, {id: "USDCAD", currency: "CAD", quote_symbol: "CAD=X"}].map((row, i) =>
      ({...row, date: "2026-10-09", value: [37, 500, 1.4][i], history: [["2026-10-08", [37, 500, 1.4][i]], ["2026-10-09", [37, 500, 1.4][i]]], fetch_status: "fresh"}))};
  const positions = P.normalizePositions([["MSFTCDR", 2, "CAD", 25], ["MSFT", 1, "USD", 400]], listings);
  const current = P.valuationAt(positions, P.normalizePrices(data, listings), "2026-10-09");
  assert.equal(current.total, 74 + 700);
  assert.equal(current.unrealized_cad, 24 + 140);
  assert.throws(() => P.normalizePositions([["MSFTCDR", 2, "USD"]], listings), /Devise/);
});
test("historical USD/CAD is applied on each valuation date, with no future quotes", () => {
  const prices = P.normalizePrices(dataset(), catalog);
  const positions = P.normalizePositions([["SHOP", 2], ["CLS", 3]], catalog);
  const baseline = P.valuationAt(positions, prices, "2025-12-31");
  const current = P.valuationAt(positions, prices, "2026-10-09");
  assert.equal(baseline.total, 200 + 300 * 1.25);
  assert.equal(current.total, 400 + 600 * 1.5);
  assert.equal(current.complete, true);
  assert.equal(P.observationAt(prices.series[0].history, "2025-12-30"), null);
  assert.equal(P.observationAt(prices.series[0].history, "2026-10-20"), null);
  assert.deepEqual(P.observationAt(prices.series[0].history, "2026-10-04"), ["2026-10-02", 140]);
});
test("live FX updates current CAD valuations and gains while preserving historical returns", () => {
  const prices = P.normalizePrices(dataset(), catalog);
  const positions = P.normalizePositions([["SHOP", 2, "CAD", 100], ["CLS", 3, "USD", 100]], catalog);
  const history = P.historyFor(positions, prices);
  const live = {rate: 1.4, timestamp: new Date().toISOString(), closed: false};
  const current = P.valuationAt(positions, prices, "2026-10-09", live);
  assert.equal(current.total, 1240);
  assert.equal(current.unrealized_cad, 620);
  assert.equal(current.fx_timestamp, live.timestamp);
  assert.deepEqual(P.historyFor(positions, prices), history);
  assert.equal(P.period(history, "YTD").change, 725);
  for (const invalid of [{...live, rate: 100}, {...live, timestamp: "invalid"},
    {...live, timestamp: new Date(Date.now() + 3600000).toISOString()},
    {...live, timestamp: new Date(Date.now() - 86400000).toISOString()}]) {
    const fallback = P.valuationAt(positions, prices, "2026-10-09", invalid);
    assert.equal(fallback.total, 1300);
    assert.equal(fallback.fx_timestamp, null);
  }
  const weekend = {...live, closed: true, timestamp: new Date(Date.now() - 2 * 86400000).toISOString()};
  assert.equal(P.valuationAt(positions, prices, "2026-10-09", weekend).total, 1240);
});
test("YTD compares against the prior year close; all requested periods have accurate baselines", () => {
  const prices = P.normalizePrices(dataset(), catalog);
  const history = P.historyFor(P.normalizePositions([["SHOP", 2], ["CLS", 3]], catalog), prices);
  const ytd = P.period(history, "YTD");
  assert.equal(ytd.start, "2025-12-31"); assert.equal(ytd.change, 725);
  assert.ok(Math.abs(ytd.percent - 725 / 575 * 100) < 1e-10);
  assert.equal(P.period(history, "6M").start, "2026-04-09");
  assert.equal(P.period(history, "3M").start, "2026-07-09");
  assert.equal(P.period(history, "1M").start, "2026-09-09");
  assert.equal(P.period(history, "1W").start, "2026-10-02");
  assert.equal(P.period(history, "3D").start, "2026-10-06");
});
test("missing exchange rates expose a partial total and suppress full portfolio returns", () => {
  const prices = P.normalizePrices(dataset(), catalog);
  prices.series.find(p => p.id === "USDCAD").history = [];
  const positions = P.normalizePositions([["SHOP", 2], ["CLS", 3]], catalog);
  const current = P.valuationAt(positions, prices, "2026-10-09");
  assert.equal(current.complete, false); assert.equal(current.total, 400);
  assert.deepEqual(current.missing, ["CLS"]);
  const selected = P.period(P.historyFor(positions, prices), "YTD");
  assert.equal(selected.change, null); assert.equal(selected.percent, null);
});
test("a recent listed security cannot fabricate performance before its first observation", () => {
  const prices = P.normalizePrices(dataset(), catalog);
  prices.series[1].history = prices.series[1].history.filter(row => row[0] >= "2026-07-09");
  const history = P.historyFor(P.normalizePositions([["SHOP", 2], ["CLS", 3]], catalog), prices);
  assert.equal(P.period(history, "YTD").percent, null);
  assert.equal(P.period(history, "6M").percent, null);
  assert.equal(P.period(history, "3M").incomplete, false);
  assert.equal(P.period(history.slice(-3), "3D").percent, null);
});
test("FX-only dates do not count as equity sessions and missing quotes remain visible", () => {
  const prices = P.normalizePrices(dataset(), catalog);
  prices.series.at(-1).history.push(["2026-10-10", 1.6]);
  const history = P.historyFor(P.normalizePositions([["SHOP", 2], ["CLS", 3]], catalog), prices);
  assert.equal(history.at(-1)[0], "2026-10-09");
  const gap = [["2026-10-01", 100], ["2026-10-02", null], ["2026-10-05", 102], ["2026-10-06", 103]];
  assert.deepEqual(P.period(gap, "3D").history, gap);
  assert.equal(P.period(gap, "3D").change, 3);
});
test("average acquisition prices preserve fractional shares and calculate native gains with an explicit current-FX conversion", () => {
  const positions = P.normalizePositions([["SHOP", 2, "CAD", "80,50"], ["CLS", 1.5, "USD", 100]], catalog);
  assert.equal(positions[0].average_cost, 80.5);
  assert.equal(P.normalizePositions({positions}, catalog)[1].average_cost, 100);
  const value = P.valuationAt(positions, P.normalizePrices(dataset(), catalog), "2026-10-09");
  assert.equal(value.rows[0].unrealized_native, 239);
  assert.equal(value.rows[1].unrealized_native, 150);
  assert.equal(value.rows[1].unrealized_percent, 100);
  assert.equal(value.unrealized_cad, 239 + 150 * 1.5);
  assert.equal(value.cost_converted, 161 + 150 * 1.5);
  assert.throws(() => P.normalizePositions([["SHOP", 2, "CAD", -1]], catalog), /Prix moyen/);
  const absent = P.valuationAt(P.normalizePositions([["SHOP", 2], ["CLS", 1.5, "USD", 100]], catalog), P.normalizePrices(dataset(), catalog), "2026-10-09");
  assert.equal(absent.unrealized_cad, null); assert.equal(absent.costs_available, 1);
});
test("monthly rankings use percentages rather than position size, include FX and pick the prior close at a month-end weekend", () => {
  const data = {series: [
    {id: "SHOP", title: "Shopify", history: [["2026-02-27", 100], ["2026-03-02", 900], ["2026-03-31", 110]]},
    {id: "CLS", title: "Celestica", history: [["2026-02-27", 100], ["2026-03-02", 900], ["2026-03-31", 105]]},
    {id: "USDCAD", history: [["2026-02-27", 1.25], ["2026-03-31", 1.5]]},
  ]};
  const positions = P.normalizePositions([["SHOP", 1000], ["CLS", 0.5]], catalog);
  const month = P.monthlyPerformance(positions, data, "2026-03-31");
  assert.equal(month.start, "2026-02-28");
  assert.deepEqual(month.rows.map(row => row.ticker), ["CLS", "SHOP"]);
  assert.equal(month.rows[0].start_price_date, "2026-02-27");
  assert.ok(Math.abs(month.rows[0].percent - 26) < 1e-10);
  assert.ok(Math.abs(month.rows[1].percent - 10) < 1e-10);
  assert.ok(month.rows[0].change_cad < month.rows[1].change_cad);
  const differentSize = P.monthlyPerformance(P.normalizePositions([["SHOP", 1], ["CLS", 500]], catalog), data, "2026-03-31");
  assert.deepEqual(differentSize.rows.map(row => row.percent), month.rows.map(row => row.percent));
  assert.deepEqual(month.missing, []);
});
test("monthly rankings exclude missing baselines, stale observations and unavailable FX rather than inventing returns", () => {
  const positions = P.normalizePositions([["SHOP", 2], ["CLS", 3]], catalog);
  const prices = P.normalizePrices(dataset(), catalog);
  prices.series.find(row => row.id === "CLS").history = [["2026-10-09", 200]];
  const partial = P.monthlyPerformance(positions, prices, "2026-10-09");
  assert.deepEqual(partial.rows.map(row => row.ticker), ["SHOP"]);
  assert.deepEqual(partial.missing, ["CLS"]);
  prices.series.find(row => row.id === "SHOP").history = [["2026-08-01", 100], ["2026-10-09", 200]];
  assert.equal(P.monthlyPerformance(positions, prices, "2026-10-09").rows.length, 0);
  const withoutFX = P.normalizePrices(dataset(), catalog);
  withoutFX.series.find(row => row.id === "USDCAD").history = [];
  assert.deepEqual(P.monthlyPerformance(positions, withoutFX, "2026-10-09").missing, ["CLS"]);
  assert.equal(P.monthlyPerformance(positions, prices, "invalid-date").rows.length, 0);
});
test("gain sorts compare numeric percentages and CAD dollars in both directions, keeping unavailable values last", () => {
  const rows = [
    {ticker: "A", unrealized_percent: 5, unrealized_cad: 100},
    {ticker: "B", unrealized_percent: -10, unrealized_cad: -200},
    {ticker: "C", unrealized_percent: 50, unrealized_cad: 10},
    {ticker: "D", unrealized_percent: null, unrealized_cad: null},
  ];
  assert.deepEqual(P.sortRows(rows, "unrealized_percent").map(row => row.ticker), ["C", "A", "B", "D"]);
  assert.deepEqual(P.sortRows(rows, "unrealized_percent", false).map(row => row.ticker), ["B", "A", "C", "D"]);
  assert.deepEqual(P.sortRows(rows, "unrealized_cad").map(row => row.ticker), ["A", "C", "B", "D"]);
  assert.deepEqual(P.sortRows(rows, "unrealized_cad", false).map(row => row.ticker), ["B", "C", "A", "D"]);
  assert.deepEqual(rows.map(row => row.ticker), ["A", "B", "C", "D"]);
});
test("position rankings use each selected period's baseline and historical FX, without requiring every holding to have that baseline", () => {
  const prices = P.normalizePrices(dataset(), catalog), positions = P.normalizePositions([["SHOP", 2], ["CLS", 3]], catalog);
  const baselines = [["YTD", "2025-12-31", 100, 1.25], ["6M", "2026-04-09", 110, 1.5],
    ["3M", "2026-07-09", 120, 1.5], ["1M", "2026-09-09", 130, 1.5],
    ["1W", "2026-10-02", 140, 1.5], ["3D", "2026-10-06", 160, 1.5]];
  for (const [range, start, price, fx] of baselines) {
    const ranked = P.performanceFor(positions, prices, "2026-10-09", range);
    assert.equal(ranked.start, start, range);
    assert.equal(ranked.rows.length, 2, range);
    assert.ok(Math.abs(ranked.rows.find(p => p.ticker === "SHOP").percent - (200 / price - 1) * 100) < 1e-10, range);
    assert.ok(Math.abs(ranked.rows.find(p => p.ticker === "CLS").percent - (200 * 1.5 / (price * fx) - 1) * 100) < 1e-10, range);
  }
  prices.series.find(p => p.id === "CLS").history = prices.series.find(p => p.id === "CLS").history.filter(row => row[0] >= "2026-07-09");
  assert.deepEqual(P.performanceFor(positions, prices, "2026-10-09", "YTD").missing, ["CLS"]);
  assert.deepEqual(P.performanceFor(positions, prices, "2026-10-09", "YTD").rows.map(p => p.ticker), ["SHOP"]);
  assert.equal(P.performanceFor(positions, prices, "2026-10-09", "3M").rows.length, 2);
});
test("short-period rankings count held equity sessions, ignore FX-only and future dates, and reject insufficient history", () => {
  const prices = P.normalizePrices(dataset(), catalog), positions = P.normalizePositions([["SHOP", 2]], catalog);
  prices.series.find(p => p.id === "USDCAD").history.push(["2026-10-03", 1.7], ["2026-10-10", 1.6]);
  prices.series.find(p => p.id === "USDCAD").history.sort((a, b) => a[0].localeCompare(b[0]));
  prices.series.push({id: "UNHELD", history: [["2026-10-03", 100], ["2026-10-04", 100]]});
  prices.series.find(p => p.id === "SHOP").history.push(["2026-10-12", 900]);
  assert.equal(P.performanceFor(positions, prices, "2026-10-09", "1W").start, "2026-10-02");
  const short = P.performanceFor(positions, prices, "2026-10-09", "3D");
  assert.equal(short.start, "2026-10-06"); assert.equal(short.rows[0].percent, 25);
  prices.series.find(p => p.id === "SHOP").history = [["2026-10-07", 170], ["2026-10-08", 180], ["2026-10-09", 200]];
  for (const range of ["3D", "1W", "invalid-range"]) {
    const unavailable = P.performanceFor(positions, prices, "2026-10-09", range);
    assert.equal(unavailable.start, null); assert.equal(unavailable.rows.length, 0); assert.deepEqual(unavailable.missing, ["SHOP"]);
  }
});
