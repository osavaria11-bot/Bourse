"use strict";
const {test} = require("node:test"), assert = require("node:assert/strict");
const E = require("../js/portfolio-exposure-utils.js"), P = require("../js/portfolio-utils.js");
function fixture() {
  return {schema_version: 1, kind: "portfolio_exposures", generated_at: new Date().toISOString(), benchmark: "FEQT",
    labels: {sectors: {technology: "Technologie", financials: "Finance", unclassified: "Non classé"},
      geography: {canada: "Canada", united_states: "États-Unis", taiwan: "Taïwan", other_countries: "Autres pays", unclassified: "Non classé"}},
    instruments: [
      {id: "FEQT", as_of: "2026-09-30", source_url: "https://www.fidelity.ca/en/products/etfs/feqt/",
        sectors: [{id: "technology", weight: 20}, {id: "financials", weight: 80}],
        geography: [{id: "canada", weight: 25}, {id: "united_states", weight: 70}, {id: "other_countries", weight: 5}]},
      {id: "CADSTOCK", as_of: "2026-09-30", source_url: "https://issuer.example/canada",
        sectors: [{id: "financials", weight: 100}], geography: [{id: "canada", weight: 100}]},
      {id: "ADR", as_of: "2026-09-30", source_url: "https://issuer.example/taiwan",
        sectors: [{id: "technology", weight: 100}], geography: [{id: "taiwan", weight: 100}]},
    ]};
}
test("weights use CAD market values, not shares, listing currency or acquisition cost", () => {
  const data = E.normalize(fixture());
  const valuation = {complete: true, total: 400, rows: [{ticker: "CADSTOCK", value_cad: 100, quantity: 1000}, {ticker: "ADR", value_cad: 300, quantity: 1}]};
  const sectors = E.compare(valuation, data, "sectors");
  assert.equal(sectors.rows.find(row => row.id === "technology").portfolio, 75);
  assert.equal(sectors.rows.find(row => row.id === "technology").difference, 55);
  const geo = E.compare(valuation, data, "geography");
  assert.equal(geo.rows.find(row => row.id === "taiwan").portfolio, 75);
  assert.equal(geo.rows.find(row => row.id === "canada").difference, 0);
  assert.equal(geo.rows.reduce((sum, row) => sum + row.portfolio, 0), 100);
});
test("ETF look-through and a portfolio entirely in FEQT reproduce the reference", () => {
  const data = E.normalize(fixture()), value = {complete: true, total: 1234, rows: [{ticker: "FEQT", value_cad: 1234}]};
  for (const axis of ["sectors", "geography"]) {
    const result = E.compare(value, data, axis);
    assert.equal(result.coverage, 100);
    for (const row of result.rows) {assert.equal(row.portfolio, row.benchmark); if (row.difference !== null) assert.equal(row.difference, 0);}
  }
  const mixed = E.compare({complete: true, total: 100, rows: [{ticker: "FEQT", value_cad: 50}, {ticker: "CADSTOCK", value_cad: 50}]}, data, "sectors");
  assert.equal(mixed.rows.find(row => row.id === "technology").portfolio, 10);
});
test("undisclosed FEQT countries do not become false zero weights or fabricated differences", () => {
  const result = E.compare({complete: true, total: 100, rows: [{ticker: "ADR", value_cad: 100}]}, E.normalize(fixture()), "geography");
  const taiwan = result.rows.find(row => row.id === "taiwan");
  assert.equal(taiwan.benchmark, null); assert.equal(taiwan.difference, null); assert.equal(taiwan.benchmark_undisclosed, true);
});
test("unknown classifications stay in the denominator and incomplete valuations suppress comparisons", () => {
  const data = E.normalize(fixture());
  const result = E.compare({complete: true, total: 100, rows: [{ticker: "ADR", value_cad: 60}, {ticker: "MISSING", value_cad: 40}]}, data, "sectors");
  assert.equal(result.coverage, 60); assert.equal(result.rows.find(row => row.id === "unclassified").portfolio, 40);
  assert.equal(result.rows.find(row => row.id === "technology").portfolio, 60);
  assert.equal(result.rows.find(row => row.id === "technology").difference, null);
  assert.deepEqual(result.missing, ["MISSING"]);
  assert.equal(E.compare({complete: false, total: 60, rows: []}, data, "sectors").available, false);
});
test("invalid weights, duplicate categories and inconsistent totals are rejected", () => {
  for (const change of [f => f.instruments[0].sectors[0].weight = -10, f => f.instruments[0].sectors[0].weight = "20",
    f => f.instruments[0].sectors[0].weight = 90, f => f.instruments.push(f.instruments[0]),
    f => f.instruments[0].sectors.push({id: "financials", weight: 0}), f => f.instruments[0].source_url = "javascript:alert(1)"]) {
    const input = fixture(); change(input); assert.throws(() => E.normalize(input));
  }
});
test("benchmark uses identical CAD dates and raw close returns, including the previous session at a holiday", () => {
  const history = [["2025-12-31", 100], ["2026-01-02", 110], ["2026-01-05", 120]];
  const selected = P.period(history, "YTD");
  const security = {id: "FEQT", currency: "CAD", quote_symbol: "FEQT.NE", history: [["2025-12-30", 10], ["2026-01-02", 10.5], ["2026-01-05", 11]]};
  const result = P.benchmarkFor(selected, security);
  assert.equal(result.available, true); assert.equal(result.benchmark_start, "2025-12-30");
  assert.equal(result.points[0].portfolio, 0); assert.equal(result.points[0].benchmark, 0);
  assert.ok(Math.abs(result.benchmark_percent - 10) < 1e-10); assert.ok(Math.abs(result.difference - 10) < 1e-10);
  const self = P.benchmarkFor(P.period(security.history, "YTD"), security);
  assert.ok(Math.abs(self.difference) < 1e-10);
});
test("benchmark missing baselines, future quotes and wrong instruments cannot silently shorten the comparison", () => {
  const selected = P.period([["2025-12-31", 100], ["2026-01-05", 120]], "YTD");
  const security = {id: "FEQT", currency: "CAD", quote_symbol: "FEQT.NE", history: [["2026-01-02", 10], ["2026-01-05", 11]]};
  for (const point of [security, {...security, currency: "USD"}, {...security, id: "VFV"}, {...security, history: [["2025-12-01", 10], ["2026-01-05", 11]]}]) {
    const result = P.benchmarkFor(selected, point); assert.equal(result.available, false); assert.equal(result.benchmark_percent, null); assert.equal(result.difference, null);
  }
  assert.equal(P.benchmarkFor({...selected, incomplete: true}, {...security, history: [["2025-12-31", 10], ["2026-01-05", 11]]}).available, false);
});
