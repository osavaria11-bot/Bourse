"use strict";
const {test} = require("node:test"), assert = require("node:assert/strict");
const P = require("../js/portfolio-utils.js"), F = require("../js/portfolio-analytics-utils.js");
const almost = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, actual + " != " + expected);
function selection(data, positions) {
  const history = P.historyFor(positions, data);
  return {history, start: history[0][0], end: history.at(-1)[0], incomplete: false};
}
function riskFixture(count = 40) {
  const points = [], portfolio = [], fx = [];
  let day = new Date("2026-07-01T00:00:00Z"), benchmarkValue = 100, portfolioValue = 100;
  while (points.length <= count) {
    if (![0, 6].includes(day.getUTCDay())) {
      const date = day.toISOString().slice(0, 10), i = points.length;
      if (i) {const change = i % 2 ? .01 : -.005; benchmarkValue *= 1 + change; portfolioValue *= 1 + 1.5 * change;}
      points.push([date, benchmarkValue]); portfolio.push([date, portfolioValue]); fx.push([date, 1.25]);
    }
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return {series: [{id: "AAA", title: "A", currency: "CAD", history: portfolio},
    {id: "FEQT", title: "FEQT", currency: "CAD", quote_symbol: "FEQT.NE", history: points}, {id: "USDCAD", history: fx}]};
}
test("contributions use beginning portfolio weights and historical FX, summing to the chart return", () => {
  const data = {series: [
    {id: "CAD", title: "Canadian", history: [["2026-10-01", 100], ["2026-10-09", 110]]},
    {id: "USD", title: "American", history: [["2026-10-01", 100], ["2026-10-09", 110]]},
    {id: "USDCAD", history: [["2026-10-01", 1.25], ["2026-10-09", 1.4]]},
  ]};
  const positions = [{ticker: "CAD", quantity: 10, currency: "CAD"}, {ticker: "USD", quantity: 20, currency: "USD"}];
  const selected = selection(data, positions), result = F.contributionsFor(positions, data, selected);
  assert.equal(result.available, true); assert.equal(result.start_value, 3500); assert.equal(result.change_cad, 680);
  const usd = result.rows.find(row => row.ticker === "USD");
  almost(usd.percent, 23.2); almost(usd.start_weight, 2500 / 3500 * 100); almost(usd.contribution, 580 / 3500 * 100);
  almost(result.total, 680 / 3500 * 100);
  almost(result.total, (selected.history.at(-1)[1] / selected.history[0][1] - 1) * 100);
});
test("the biggest contributor need not have the highest standalone return; incomplete denominators never invent contributions", () => {
  const data = {series: [{id: "SMALL", title: "Small", history: [["2026-10-06", 10], ["2026-10-09", 20]]},
    {id: "BIG", title: "Big", history: [["2026-10-06", 100], ["2026-10-09", 110]]}]};
  const positions = [{ticker: "SMALL", quantity: 1, currency: "CAD"}, {ticker: "BIG", quantity: 100, currency: "CAD"}];
  const selected = selection(data, positions), result = F.contributionsFor(positions, data, selected);
  assert.equal(result.rows[0].ticker, "BIG"); almost(result.rows[0].percent, 10); almost(result.rows[1].percent, 100);
  assert.equal(F.contributionsFor(positions, data, {...selected, incomplete: true}).available, false);
  data.series[1].history = data.series[1].history.slice(1);
  assert.equal(F.contributionsFor(positions, data, selected).available, false);
});
test("sample daily volatility is annualized by sqrt(252) and beta is covariance divided by benchmark variance", () => {
  const data = riskFixture(), positions = [{ticker: "AAA", quantity: 3, currency: "CAD"}];
  const risk = F.riskFor(positions, data, selection(data, positions));
  assert.equal(risk.available, true); assert.equal(risk.observations, 40); almost(risk.portfolio.beta, 1.5); almost(risk.benchmark.beta, 1);
  const expectedVariance = 40 * .0075 ** 2 / 39;
  almost(risk.benchmark.volatility, Math.sqrt(expectedVariance * 252) * 100);
  almost(risk.portfolio.volatility, 1.5 * risk.benchmark.volatility);
  const heldFEQT = [{ticker: "FEQT", quantity: 2, currency: "CAD"}];
  const identical = F.riskFor(heldFEQT, data, selection(data, heldFEQT));
  almost(identical.portfolio.beta, 1); almost(identical.portfolio.volatility, identical.benchmark.volatility);
  almost(identical.portfolio.drawdown.value, identical.benchmark.drawdown.value);
});
test("drawdown finds the peak before the trough inside the selected period and short samples suppress volatility and beta", () => {
  const dates = ["2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"];
  const data = {series: [{id: "AAA", history: dates.map((date, i) => [date, [100, 120, 90, 110][i]])},
    {id: "FEQT", currency: "CAD", quote_symbol: "FEQT.NE", history: dates.map((date, i) => [date, [100, 110, 100, 105][i]])}]};
  const positions = [{ticker: "AAA", quantity: 1, currency: "CAD"}], risk = F.riskFor(positions, data, selection(data, positions));
  almost(risk.portfolio.drawdown.value, -25); assert.equal(risk.portfolio.drawdown.peak_date, "2026-10-07"); assert.equal(risk.portfolio.drawdown.trough_date, "2026-10-08");
  almost(risk.benchmark.drawdown.value, (100 / 110 - 1) * 100);
  assert.equal(risk.portfolio.volatility, null); assert.equal(risk.portfolio.beta, null); assert.equal(risk.benchmark.beta, null);
});
test("risk uses exact common closes without carried holiday quotes and rejects missing chunks or an invalid benchmark listing", () => {
  const data = riskFixture(), positions = [{ticker: "AAA", quantity: 2, currency: "USD"}];
  data.series[0].history.splice(10, 1);
  let selected = selection(data, positions), risk = F.riskFor(positions, data, selected);
  assert.equal(risk.observations, 39); assert.equal(risk.skipped_closes, 1);
  data.series[0].history.splice(5, 20);
  assert.equal(F.riskFor(positions, data, selected).available, false);
  const wrong = riskFixture(); wrong.series[1].quote_symbol = "FEQT.TO";
  assert.equal(F.riskFor(positions, wrong, selection(wrong, positions)).available, false);
  const missingFX = riskFixture(); missingFX.series[2].history = [];
  assert.equal(F.riskFor(positions, missingFX, selection(missingFX, positions)).available, false);
  assert.equal(F.riskFor(positions, riskFixture(), {...selected, incomplete: true}).available, false);
});
test("a constant benchmark never produces an infinite beta, and statistical minimums are enforced separately", () => {
  const positions = [{ticker: "AAA", quantity: 1, currency: "CAD"}], data = riskFixture();
  data.series[1].history = data.series[1].history.map(row => [row[0], 100]);
  const risk = F.riskFor(positions, data, selection(data, positions));
  assert.equal(risk.portfolio.beta, null); assert.equal(risk.benchmark.beta, null); assert.equal(risk.beta_reason, "constant_benchmark");
  almost(risk.benchmark.volatility, 0); almost(risk.benchmark.drawdown.value, 0);
  const month = riskFixture(20), monthRisk = F.riskFor(positions, month, selection(month, positions));
  assert.ok(monthRisk.portfolio.volatility > 0); assert.equal(monthRisk.portfolio.beta, null);
});
const earningsCatalog = {series: [{id: "BIG"}, {id: "SMALL"}, {id: "CDR"}, {id: "EMPTY"}, {id: "ETF"}]};
const now = Date.parse("2026-10-11T20:00:00Z");
function metric(actual, estimate, currency = "USD") {return {actual, estimate, currency, source_url: "https://example.com/earnings"};}
function event(id, date, reported = true) {return {id, report_date: date, report_at: null, quarter: "Q3 2026", date_status: reported ? "reported" : "estimated",
  eps: metric(reported ? 2 : null, 1.5), revenue: metric(reported ? 2e9 : null, 1.9e9), messages: reported ? [{text: "Demand remained strong", language: "en", source_url: "https://example.com/report"}] : [],
  report_url: "https://example.com/report", sources: [{label: "Source fixture", url: "https://example.com/earnings"}]};}
function earningsFixture() {
  const feed = (company, events, fetch_status = "fresh") => ({company_symbol: company, events, fetch_status, fetched_at: fetch_status === "unavailable" ? null : new Date(now).toISOString(), source_url: "https://example.com/earnings"});
  return {schema_version: 1, kind: "portfolio_earnings", generated_at: new Date(now).toISOString(), timezone: "America/Toronto", window: {start: "2026-09-28", end: "2026-11-01"}, instruments: {
    BIG: feed("BIG", [event("aaaaaaaaaaaaaaaa", "2026-10-06"), event("bbbbbbbbbbbbbbbb", "2026-10-14", false)]),
    CDR: feed("BIG", [event("aaaaaaaaaaaaaaaa", "2026-10-06")]),
    SMALL: feed("SMALL", [event("cccccccccccccccc", "2026-10-08")]), EMPTY: feed("EMPTY", [], "unavailable"), ETF: feed("ETF", [], "not_applicable"),
  }};
}
test("earnings weeks start on Monday in Toronto, including Sunday and UTC midnight boundaries", () => {
  assert.deepEqual(F.weekFor("2026-10-11").days, ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"]);
  assert.equal(F.localDay(Date.parse("2026-10-12T02:00:00Z")), "2026-10-11");
  assert.equal(F.weekFor(F.localDay(Date.parse("2026-10-12T05:00:00Z"))).start, "2026-10-12");
  assert.throws(() => F.weekFor("2026-02-30"));
});
test("earnings surprises compare like-for-like numbers, including losses and zero consensus", () => {
  assert.equal(F.earningsOutcome(metric(-.5, -1)).status, "beat");
  almost(F.earningsOutcome(metric(-.5, -1)).percent, 50);
  assert.equal(F.earningsOutcome(metric(-1, -.5)).status, "miss");
  assert.equal(F.earningsOutcome(metric(2, 2)).status, "inline");
  assert.equal(F.earningsOutcome(metric(1, 0)).percent, null);
  assert.equal(F.earningsOutcome(metric(1, null)).status, "unknown");
  assert.equal(F.earningsOutcome(metric(null, 2)).status, "pending");
});
test("weekly earnings are held-only, merge CDR/issuer rows, support local filters and separate missing calendars from ETFs", () => {
  const earnings = F.normalizeEarnings(earningsFixture(), earningsCatalog, now);
  const current = {complete: true, total: 100, rows: [{ticker: "BIG", title: "Big", value_cad: 70}, {ticker: "CDR", title: "Big CDR", value_cad: 20}, {ticker: "EMPTY", title: "Empty", value_cad: 10}, {ticker: "ETF", title: "Fund", value_cad: 0}]};
  const result = F.selectEarnings(current, earnings, {week: F.weekFor("2026-10-11"), now});
  assert.equal(result.rows.length, 1); assert.equal(result.reported, 1); assert.equal(result.pending, 0); assert.equal(result.rows[0].holdings.length, 2);
  assert.equal(result.rows[0].holdings[0].weight, 70); assert.deepEqual(result.unavailable, ["EMPTY"]); assert.deepEqual(result.notApplicable, ["ETF"]);
  assert.equal(F.selectEarnings(current, earnings, {ticker: "CDR", week: result.week, now}).rows[0].holdings.length, 1);
  const next = F.selectEarnings(current, earnings, {week: F.weekFor("2026-10-14"), now}); assert.equal(next.pending, 1); assert.equal(next.reported, 0);
  assert.equal(F.selectEarnings(current, earnings, {week: F.weekFor("2026-11-05"), now}).inWindow, false);
  const missing = F.selectEarnings({...current, complete: false}, earnings, {week: result.week, now}); assert.equal(missing.rows[0].holdings[0].weight, null);
});
test("earnings validation rejects false future results, unsafe sources, wrong dates and unpaired types; caches retain their age", () => {
  const unsafe = earningsFixture(); unsafe.instruments.BIG.events[0].sources[0].url = "javascript:alert(1)"; assert.throws(() => F.normalizeEarnings(unsafe, earningsCatalog, now));
  const future = earningsFixture(); future.instruments.BIG.events[0].report_date = "2026-10-14"; assert.throws(() => F.normalizeEarnings(future, earningsCatalog, now));
  const futureTime = earningsFixture(); futureTime.instruments.SMALL.events[0].report_date = "2026-10-11"; futureTime.instruments.SMALL.events[0].report_at = "2026-10-11T23:00:00Z"; assert.throws(() => F.normalizeEarnings(futureTime, earningsCatalog, now));
  const pending = earningsFixture(); pending.instruments.BIG.events[1].messages.push({text: "Fake result", language: "fr", source_url: "https://example.com/report"}); assert.throws(() => F.normalizeEarnings(pending, earningsCatalog, now));
  const bad = earningsFixture(); bad.instruments.BIG.events[0].eps.actual = "2"; assert.throws(() => F.normalizeEarnings(bad, earningsCatalog, now));
  const cached = earningsFixture(); cached.instruments.BIG.fetched_at = "2026-10-01T20:00:00Z";
  const normalized = F.normalizeEarnings(cached, earningsCatalog, now);
  const result = F.selectEarnings({rows: [{ticker: "BIG", title: "Big"}]}, normalized, {week: F.weekFor("2026-10-11"), now}); assert.deepEqual(result.cached, ["BIG"]);
  assert.equal(normalized.instruments.BIG.fetched_at, "2026-10-01T20:00:00Z");
});
