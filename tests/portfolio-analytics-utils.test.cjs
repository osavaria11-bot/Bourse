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
const newsCatalog = {series: [{id: "BIG"}, {id: "SMALL"}, {id: "EMPTY"}]};
const now = Date.parse("2026-10-11T20:00:00Z");
function newsItem(id, event, age = 1) {return {id, title: "Synthetic dated company event", publisher: "Reuters", publisher_url: "https://www.reuters.com/", source_url: "https://www.reuters.com/markets/synthetic-" + id,
  event, published_at: new Date(now - age * 3600000).toISOString()};}
function newsFixture() {return {schema_version: 1, kind: "portfolio_news", generated_at: new Date(now).toISOString(), instruments: {
  BIG: {fetch_status: "fresh", fetched_at: new Date(now).toISOString(), items: [newsItem("aaaaaaaaaaaaaaaa", "earnings"), newsItem("bbbbbbbbbbbbbbbb", "operations", 2)]},
  SMALL: {fetch_status: "fresh", fetched_at: new Date(now).toISOString(), items: [newsItem("cccccccccccccccc", "earnings"), newsItem("dddddddddddddddd", "guidance", 8 * 24)]},
  EMPTY: {fetch_status: "unavailable", fetched_at: null, items: []},
}};}
test("news ranks held events by weight and recency, excludes old/unheld items, merges duplicates and supports local filters", () => {
  const payload = newsFixture(); payload.instruments.SMALL.items.push(newsItem("bbbbbbbbbbbbbbbb", "operations", 2));
  const news = F.normalizeNews(payload, newsCatalog, now);
  const current = {complete: true, total: 100, rows: [{ticker: "BIG", title: "Big", value_cad: 90}, {ticker: "SMALL", title: "Small", value_cad: 10}]};
  const selection = F.selectNews(current, news, {now});
  assert.equal(selection.rows[0].id, "aaaaaaaaaaaaaaaa"); assert.equal(selection.rows.length, 3); assert.equal(selection.covered, 2);
  const shared = selection.rows.find(row => row.id === "bbbbbbbbbbbbbbbb"); assert.equal(shared.holdings.length, 2); assert.equal(shared.weight, 100);
  const results = F.selectNews(current, news, {now, event: "results"}); assert.equal(results.rows.length, 2);
  const small = F.selectNews(current, news, {now, ticker: "SMALL"}); assert.equal(small.rows.length, 2); assert.ok(small.rows.every(row => row.holdings.length === 1 && row.holdings[0].ticker === "SMALL"));
  const onlyBig = F.selectNews({...current, rows: current.rows.slice(0, 1)}, news, {now}); assert.equal(onlyBig.rows.length, 2);
  assert.equal(F.selectNews(current, news, {now: now + 8 * 86400000}).rows.length, 0);
});
test("news validation rejects future timestamps and unsafe links, while missing valuations never fabricate exposure weights", () => {
  const payload = newsFixture(); payload.instruments.BIG.items[0].source_url = "javascript:alert(1)";
  assert.throws(() => F.normalizeNews(payload, newsCatalog, now));
  const future = newsFixture(); future.instruments.BIG.items[0].published_at = new Date(now + 3600000).toISOString();
  assert.throws(() => F.normalizeNews(future, newsCatalog, now));
  const current = {complete: false, total: 0, rows: [{ticker: "BIG", title: "Big", value_cad: null}, {ticker: "EMPTY", title: "Empty", value_cad: null}]};
  const result = F.selectNews(current, F.normalizeNews(newsFixture(), newsCatalog, now), {now});
  assert.equal(result.rows[0].weight, null); assert.equal(result.rows[0].holdings[0].weight, null); assert.deepEqual(result.unavailable, ["EMPTY"]);
});
