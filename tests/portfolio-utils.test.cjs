"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const P = require("../js/portfolio-utils.js");
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
