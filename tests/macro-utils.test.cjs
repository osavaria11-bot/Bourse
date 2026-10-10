"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const U = require("../js/macro-utils.js");
const sample = () => ({
  id: "TEST", title: "Épargne", category: "Activité", description: "Ménages",
  value: -0.4, date: "2026-10-09", previous_date: "2026-10-08", previous_value: -0.3,
  change: -0.1, unit: "%", change_unit: "pt", decimals: 2, frequency: "daily", fetch_status: "fresh",
  source_url: "https://fred.stlouisfed.org/series/TEST",
  history: [["2026-09-01", -0.3], ["2026-09-30", null], ["2026-10-09", -0.4]],
});
test("Invalid calendar dates and non-ISO dates are rejected", () => {
  assert.equal(U.isDate("2026-02-30"), false);
  assert.equal(U.isDate("10/09/2026"), false);
  assert.equal(U.isDate("2024-02-29"), true);
});
test("Month and year ranges clamp leap days without spilling into March", () => {
  assert.equal(U.rangeStart("2024-03-31", "1M"), "2024-02-29");
  assert.equal(U.rangeStart("2024-02-29", "1Y"), "2023-02-28");
});
test("Ranges are anchored to the observation date and retain missing observations", () => {
  assert.deepEqual(U.visibleHistory(sample(), "1M"), [["2026-09-30", null], ["2026-10-09", -0.4]]);
});
test("Quarterly period labels do not claim daily observation dates", () => {
  assert.equal(U.observationLabel("2026-04-01", "quarterly"), "T2 2026");
});
test("Accent-insensitive search combines category and favorite constraints", () => {
  const other = { ...sample(), id: "OTHER", title: "Chômage", category: "Emploi" };
  assert.equal(U.filterSeries([sample(), other], { search: "epargne" })[0].id, "TEST");
  assert.equal(U.filterSeries([sample(), other], { favoritesOnly: true, favorites: new Set(["OTHER"]) })[0].id, "OTHER");
  assert.equal(U.filterSeries([sample(), other], { search: "epargne", category: "Emploi" }).length, 0);
});
test("Sorting does not reorder the original dataset", () => {
  const input = [{ ...sample(), title: "Z" }, { ...sample(), id: "A", title: "A" }];
  assert.equal(U.filterSeries(input, { sort: "name" })[0].title, "A");
  assert.equal(input[0].title, "Z");
});
test("Nonfinite and future observations never become displayed values", () => {
  const normalized = U.normalizeDataset({ schema_version: 2, generated_at: "2026-10-10T16:00:00Z",
    series: [{ ...sample(), value: NaN }, { ...sample(), id: "FUTURE", date: "2026-10-11" }] }, "2026-10-10");
  assert.equal(normalized.series[0].value, null);
  assert.equal(normalized.series[0].fetch_status, "unavailable");
  assert.equal(normalized.series[1].date, null);
  assert.throws(() => U.normalizeDataset({ schema_version: 1, series: [] }));
});
test("History is ordered, deduplicated and rejects strings masquerading as numbers", () => {
  const normalized = U.normalizeDataset({ schema_version: 2, generated_at: "2026-10-10T16:00:00Z",
    series: [{ ...sample(), history: [["2026-10-09", 1], ["2026-10-08", 0], ["2026-10-09", 2], ["2026-10-07", "NaN"]] }] }, "2026-10-10");
  assert.deepEqual(normalized.series[0].history, [["2026-10-08", 0], ["2026-10-09", 2]]);
});
test("Flat and negative chart values get finite, non-zero axis ranges", () => {
  const [low, high] = U.niceExtent([["2026-10-09", 0], ["2026-10-10", null]]);
  assert.ok(low < 0 && high > 0);
  const extent = U.niceExtent(sample().history);
  assert.ok(extent[0] < -0.4 && extent[1] > -0.3);
});
test("Nearest point skips missing data and handles both edges", () => {
  assert.deepEqual(U.nearestPoint(sample().history, Date.parse("2026-09-30")), ["2026-10-09", -0.4]);
  assert.deepEqual(U.nearestPoint(sample().history, 0), ["2026-09-01", -0.3]);
  assert.equal(U.nearestPoint([["2026-10-09", null]], Date.now()), null);
});
test("Changes use percentage points and require a genuine previous observation date", () => {
  assert.match(U.changeLabel(sample()).text, /pt$/);
  assert.equal(U.changeLabel({ ...sample(), previous_date: null }).direction, "flat");
  assert.equal(U.changeLabel({ ...sample(), change: 0.00001 }).text, "→ Stable");
});
test("CSV escapes quotes, blocks text formulas and preserves negative numeric values", () => {
  assert.equal(U.csvCell('=HYPERLINK("x")'), "\"'=HYPERLINK(\"\"x\"\")\"");
  assert.equal(U.csvCell(-0.4), '"-0.4"');
  assert.equal(U.csvCell("a;b"), '"a;b"');
  assert.ok(U.snapshotCSV([sample()]).startsWith("\ufeff"));
  assert.match(U.historyCSV(sample(), "1M"), /2026-10-09/);
  assert.doesNotMatch(U.historyCSV(sample(), "1M"), /2026-09-01/);
});
test("Bank of Canada policy rate keeps its official source across normalization and CSV exports", () => {
  const input = {schema_version: 2, generated_at: "2026-10-10T16:00:00Z", series: [
    {...sample(), id: "V39079", provider: "bank_of_canada", source_url: "javascript:bad"},
    {...sample(), source_url: "https://example.test/false-source"},
  ]};
  const [bank, fred] = U.normalizeDataset(input, "2026-10-10").series;
  assert.equal(bank.source_label, "Banque du Canada");
  assert.equal(bank.source_url, "https://www.bankofcanada.ca/core-functions/monetary-policy/key-interest-rate/");
  assert.equal(fred.source_url, "https://fred.stlouisfed.org/series/TEST");
  assert.match(U.snapshotCSV([bank]), /Code de série.*Source/);
  assert.match(U.historyCSV(bank, "1M"), /bankofcanada\.ca/);
  assert.doesNotMatch(U.historyCSV(bank, "1M"), /Série FRED|javascript:bad/);
});
