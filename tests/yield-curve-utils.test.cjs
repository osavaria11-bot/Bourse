"use strict";
const {test} = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const C = require("../js/yield-curve-utils.js");
const NOW = Date.parse("2026-10-15T18:30:00Z");
function fixture() {
  return {schema_version: 1, kind: "sovereign_yield_curves", unit: "percent", timezone: "America/Toronto", history_start: C.START, generated_at: "2026-10-15T17:00:00Z",
    countries: Object.entries(C.CONTRACTS).map(([id, country], index) => ({...country, id, source_label: "Synthetic test source", methodology: "Synthetic fixture",
      tenors: country.tenors.map(([key, label, months, series_id]) => ({key, label, months, series_id})),
      fetch_status: "fresh", last_successful_fetch: "2026-10-15T17:00:00Z",
      history: ["2025-12-31", "2026-09-14", "2026-10-09", "2026-10-13", "2026-10-14"].map((day, i) => [day, ...country.tenors.map((_, t) => 2 + index + t / 10 + i / 10)])}))};
}
test("curve contracts bind the exact nominal daily series, source, currency and tenor order", () => {
  const normalized = C.normalize(fixture(), NOW);
  assert.equal(normalized.countries[0].tenors.at(-1).key, "30Y");
  assert.equal(normalized.countries[1].tenors.at(-1).key, "LONG");
  for (const mutate of [p => p.countries[1].currency = "USD", p => p.countries[1].tenors[4].series_id = "V122538", p => p.countries[1].tenors[9].key = "30Y",
    p => p.countries[0].source_url = "https://example.com", p => p.countries.push(p.countries[0]), p => p.countries[1].id = "US"]) {
    const payload = fixture(); mutate(payload); assert.throws(() => C.normalize(payload, NOW));
  }
});
test("weekends resolve to one actual curve date, with no per-tenor fill or look-ahead", () => {
  const country = C.normalize(fixture(), NOW).countries[0]; country.history.at(-1)[7] = null;
  const weekend = C.snapshot(country, "2026-10-11"); assert.equal(weekend.date, "2026-10-09"); assert.equal(weekend.adjusted, true);
  const current = C.snapshot(country, "2026-10-14"); assert.equal(current.values[6], null);
  assert.equal(C.snapshot(country, "2026-08-31"), null); assert.equal(C.snapshot(country, "2026-10-25"), null);
  assert.equal(C.snapshot(country, "2026-02-30"), null);
});
test("point changes and slopes are B minus A in basis points, including inverse date order and zero", () => {
  const country = C.normalize(fixture(), NOW).countries[0];
  const first = country.history.at(-2), last = country.history.at(-1);
  first[5] = 4; first[9] = 3.8; last[5] = 4.15; last[9] = 4.2;
  const comparison = C.comparison(country, first[0], last[0]);
  assert.ok(Math.abs(comparison.rows.find(row => row.key === "2Y").change_bp - 15) < 1e-9);
  assert.ok(Math.abs(comparison.slope_2_10.a + 20) < 1e-9); assert.ok(Math.abs(comparison.slope_2_10.b - 5) < 1e-9);
  assert.ok(Math.abs(comparison.slope_2_10.change_bp - 25) < 1e-9);
  assert.ok(Math.abs(C.comparison(country, last[0], first[0]).slope_2_10.change_bp + 25) < 1e-9);
  assert.equal(C.basisPoints(4.1, 4.1), 0); assert.equal(C.basisPoints(null, 4.1), null);
});
test("missing 2-year observation suppresses its spread, not the whole dated curve", () => {
  const country = C.normalize(fixture(), NOW).countries[1]; country.history.at(-1)[5] = null;
  const result = C.comparison(country, "2026-10-13", "2026-10-14");
  assert.equal(result.slope_2_10.b, null); assert.notEqual(result.slope_3m_10.b, null);
  assert.equal(result.rows[4].change_bp, null); assert.notEqual(result.rows[8].change_bp, null);
});
test("negative sovereign yields are valid; nonfinite, string and future rates/dates are rejected", () => {
  const payload = fixture(); payload.countries[0].history[0][1] = -.25;
  assert.equal(C.normalize(payload, NOW).countries[0].history[0][1], -.25);
  for (const value of [true, "4.5", Infinity, NaN, 101]) {
    const p = fixture(); p.countries[0].history[0][1] = value; assert.throws(() => C.normalize(p, NOW));
  }
  for (const day of ["2026-10-16", "2026-10-11", "2026-02-30"]) {const p = fixture(); p.countries[0].history.at(-1)[0] = day; assert.throws(() => C.normalize(p, NOW));}
  const duplicate = fixture(); duplicate.countries[0].history.push(duplicate.countries[0].history.at(-1)); assert.throws(() => C.normalize(duplicate, NOW));
});
test("unavailable and cached countries retain honest dates and freshness", () => {
  const payload = fixture(); Object.assign(payload.countries[0], {fetch_status: "unavailable", history: [], last_successful_fetch: null}); payload.countries[1].fetch_status = "cached";
  assert.equal(C.normalize(payload, NOW).countries[1].history.at(-1)[0], "2026-10-14");
  payload.countries[1].last_successful_fetch = "2026-10-16T10:00:00Z"; assert.throws(() => C.normalize(payload, NOW));
});
test("date defaults use published days and calendar-aware one-month/one-year/YTD bases", () => {
  const data = C.normalize(fixture(), NOW);
  const expected = {"1D": "2026-10-13", "1W": "2026-10-07", "1M": "2026-09-14", "3M": "2026-07-14", "6M": "2026-04-14", "1Y": "2025-10-14", "2Y": "2024-10-14", "5Y": "2021-10-14", "YTD": "2025-12-31"};
  assert.deepEqual(C.defaults(data), {a: expected["1M"], b: "2026-10-14"});
  for (const [preset, a] of Object.entries(expected)) assert.deepEqual(C.defaults(data, preset), {a, b: "2026-10-14"}, preset);
  assert.equal(C.localDay(Date.parse("2026-10-15T02:00:00Z")), "2026-10-14");
});
test("published yield curves validate with enough history and all nominal maturity definitions", () => {
  const data = C.normalize(JSON.parse(fs.readFileSync(path.join(__dirname, "../data/yield-curves.json"), "utf8")));
  for (const country of data.countries) {assert.ok(country.history.length > 2000); assert.ok(country.history[0][0].startsWith("2016")); assert.ok(country.history.at(-1).slice(1).every(Number.isFinite));}
});
test("one-day comparisons skip weekends and holidays without comparing the latest curve to itself", () => {
  const data = C.normalize(fixture(), NOW);
  for (const country of data.countries) country.history.pop();
  assert.deepEqual(C.defaults(data, "1D"), {a: "2026-10-09", b: "2026-10-13"});
  data.countries[1].history.pop();
  assert.deepEqual(C.defaults(data, "1D"), {a: "2026-10-09", b: "2026-10-13"});
});
test("two dated curves preserve per-tenor values and B minus A; removed dates are rejected", () => {
  const country = C.normalize(fixture(), NOW).countries[0], dates = {a: "2026-10-09", b: "2026-10-14"};
  const before = structuredClone(country), result = C.multiComparison(country, dates);
  assert.deepEqual(result.curves.map(curve => curve.label), ["A", "B"]);
  for (const row of result.rows) assert.ok(Math.abs(row.changes.a - (row.values.b - row.values.a) * 100) < 1e-9);
  assert.deepEqual(country, before);
  const swapped = C.multiComparison(country, {a: dates.b, b: dates.a});
  assert.ok(Math.abs(swapped.rows[0].changes.a + result.rows[0].changes.a) < 1e-9);
  for (const key of ["c", "d", "e"]) assert.throws(() => C.multiComparison(country, {...dates, [key]: "2026-10-13"}));
});

test("the newest country is not held back by another country's publication lag", () => {
  const data = C.normalize(fixture(), NOW);
  data.countries[1].history.pop();
  assert.equal(C.defaults(data).b, "2026-10-14");
  assert.equal(C.snapshot(data.countries[0], C.defaults(data).b).date, "2026-10-14");
  assert.equal(C.snapshot(data.countries[1], C.defaults(data).b).date, "2026-10-13");
});
test("publication warnings distinguish today's check from the last actual curve", () => {
  const country = C.normalize(fixture(), NOW).countries[1], before = structuredClone(country);
  const report = C.publication(country, NOW);
  assert.equal(report.waiting, true); assert.equal(report.today, "2026-10-15"); assert.equal(report.latest, "2026-10-14");
  assert.match(report.label, /2026-10-15 en attente.*2026-10-14/);
  assert.equal(C.publication(country, Date.parse("2026-10-14T23:00:00Z")).waiting, false);
  assert.equal(C.publication(country, Date.parse("2026-10-18T18:00:00Z")).waiting, false);
  assert.deepEqual(country, before);
});
