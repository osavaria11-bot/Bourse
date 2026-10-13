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
const marketSample = () => ({date: "2026-10-09", value: 100, history: [
  ["2016-10-07", 10], ["2021-10-08", 20], ["2025-10-09", 40], ["2025-12-31", 50], ["2026-07-09", 50], ["2026-09-09", 80],
  ["2026-10-02", 90], ["2026-10-05", 92], ["2026-10-06", 94], ["2026-10-07", 96], ["2026-10-08", 98], ["2026-10-09", 100],
]});
test("Every index timeframe returns its full period, including the close before a weekend boundary", () => {
  const expected = [
    ["1D", "2026-10-08", 100 / 98 * 100 - 100],
    ["3D", "2026-10-06", 100 / 94 * 100 - 100], ["1W", "2026-10-02", 100 / 90 * 100 - 100],
    ["1M", "2026-09-09", 25], ["3M", "2026-07-09", 100], ["YTD", "2025-12-31", 100], ["1Y", "2025-10-09", 150],
    ["5Y", "2021-10-08", 400], ["10Y", "2016-10-07", 900],
  ];
  assert.deepEqual(U.MARKET_RANGES.map(item => item.key), expected.map(row => row[0]));
  for (const [range, start, percent] of expected) {
    const period = U.marketPeriod(marketSample(), range);
    assert.equal(period.incomplete, false, range);
    assert.equal(period.start, start, range);
    assert.equal(period.end, "2026-10-09", range);
    assert.ok(Math.abs(period.percent - percent) < 1e-10, range);
    assert.equal(period.history[0][0], start, range);
    assert.equal(period.history.at(-1)[0], period.end, range);
  }
});
test("Index returns preserve losses and use completed sessions instead of calendar days", () => {
  const point = {date: "2026-10-06", value: 180, history: [
    ["2026-10-01", 200], ["2026-10-02", 210], ["2026-10-05", 220], ["2026-10-06", 180],
  ]};
  const period = U.marketPeriod(point, "3D");
  assert.equal(period.start, "2026-10-01");
  assert.equal(period.change, -20);
  assert.ok(Math.abs(period.percent + 10) < 1e-10);
});
test("One-day and YTD returns cross the New Year holiday using the previous year's last close", () => {
  const point = {date: "2023-01-03", value: 105, history: [["2022-12-30", 100], ["2023-01-03", 105]]};
  for (const range of ["1D", "YTD"]) {
    const period = U.marketPeriod(point, range);
    assert.equal(period.start, "2022-12-30");
    assert.ok(Math.abs(period.percent - 5) < 1e-10);
  }
});
test("Missing index baselines do not silently shorten the selected return", () => {
  const short = {...marketSample(), history: marketSample().history.slice(-3)};
  for (const range of ["3D", "1W", "YTD", "10Y"]) {
    assert.equal(U.marketPeriod(short, range).percent, null);
  }
  for (const value of [null, 0, -10]) {
    const point = marketSample(); point.history.find(row => row[0] === "2026-10-06")[1] = value;
    const period = U.marketPeriod(point, "3D");
    assert.equal(period.start, "2026-10-06");
    assert.equal(period.percent, null);
    assert.equal(period.incomplete, true);
  }
  const stale = {date: "2026-10-09", value: 100, history: [["2026-08-30", 80], ["2026-10-09", 100]]};
  assert.equal(U.marketPeriod(stale, "1M").percent, null);
  assert.equal(U.marketPeriod(undefined, "1W").percent, null);
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

const oddsSample = () => ({schema_version: 1, kind: "rate_odds", generated_at: "2026-10-13T00:56:18Z", decisions: [
  {id: "fed", as_of: "2026-10-13", meeting_date: "2026-10-28", hike: 30, hold: 70, cut: 0, status: "fresh"},
  {id: "canada", as_of: "2026-10-12", meeting_date: "2026-10-28", hike: 28, hold: 72, cut: 0, status: "fresh"},
]});
test("Published UTC meeting odds remain available during the previous evening in Quebec", () => {
  const now = new Date("2026-10-13T02:19:17Z"), data = oddsSample(), before = structuredClone(data);
  const fed = U.rateOddsFor(data, "fed", now), canada = U.rateOddsFor(data, "canada", now);
  assert.equal(fed.row.as_of, "2026-10-13");
  assert.equal(fed.row.hold, 70);
  assert.equal(fed.sourceDayAhead, true);
  assert.equal(canada.sourceDayAhead, false);
  assert.equal(U.rateOddsFor(data, "fed", new Date("2026-10-13T04:01:00Z")).sourceDayAhead, false);
  assert.deepEqual(data, before, "The provider observation date must never be rewritten");
});
test("Odds still reject genuine future dates, uncollected observations, stale dates and invalid probabilities", () => {
  const now = new Date("2026-10-13T02:19:17Z");
  for (const overrides of [{as_of: "2026-10-14"}, {as_of: "2026-10-06"}, {as_of: "2026-02-30"},
    {meeting_date: "2026-10-11"}, {hold: 50}, {hike: "30"}, {cut: -1}]) {
    const data = oddsSample(); Object.assign(data.decisions[0], overrides);
    assert.equal(U.rateOddsFor(data, "fed", now), null, JSON.stringify(overrides));
  }
  for (const generated_at of ["invalid", "2026-10-14T00:56:18Z", "2026-10-12T23:56:18Z"]) {
    assert.equal(U.rateOddsFor({...oddsSample(), generated_at}, "fed", now), null, generated_at);
  }
  assert.equal(U.rateOddsFor(null, "fed", now), null);
  assert.equal(U.rateOddsFor(oddsSample(), "unknown", now), null);
});
test("Decision expiry follows Quebec's calendar through winter and summer UTC rollovers", () => {
  for (const [stamp, as_of, meeting_date] of [["2026-07-14T02:00:00Z", "2026-07-12", "2026-07-13"],
    ["2026-12-16T04:00:00Z", "2026-12-14", "2026-12-15"]]) {
    const now = new Date(stamp), data = {schema_version: 1, kind: "rate_odds", generated_at: stamp,
      decisions: [{id: "fed", as_of, meeting_date, hike: 30, hold: 70, cut: 0, status: "cached"}]};
    assert.equal(U.rateOddsFor(data, "fed", now).row.as_of, as_of);
    assert.equal(U.rateOddsFor(data, "fed", new Date(now.getTime() + 3 * 3600000)), null);
  }
});
