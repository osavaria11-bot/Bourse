const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const {relativeMetrics, parseCapital} = require("../js/fnb-dashboard.js");
const html = fs.readFileSync(path.join(__dirname, "../reports/portefeuilles-fnb.html"), "utf8");
const D = JSON.parse(html.match(/<script id="analysis" type="application\/json">([\s\S]*?)<\/script>/)[1]);
function close(a, b, context) {if (a === null || b === null) assert.equal(a, b, context); else assert.ok(Math.abs(a - b) < 1e-9, context + ": " + a + " / " + b);}
test("each portfolio's declared benchmark reproduces every stored relative ratio", () => {
  for (const k of D.order) {
    const benchmark=D.results[k].benchmark||'VEQT';
    const actual = relativeMetrics(D.results[k], D.results[benchmark], D.assumptions.risk_free);
    for (const key of ["beta", "information", "treynor", "tracking_error", "vol_diff", "cagr_gap"]) close(actual[key], D.results[k][key], k + " " + key);
  }
});
test("the selectable FBAL, VBAL, FGRO and VGRO references match the existing pairwise audit", () => {
  for (const pair of D.pairwise) {
    const actual = relativeMetrics(D.results[pair.portfolio], D.results[pair.comparable], D.assumptions.risk_free);
    close(actual.beta, pair.beta_vs_comparable, "beta " + pair.comparable);
    for (const key of ["information", "tracking_error", "cagr_gap"]) close(actual[key], pair[key], key + " " + pair.comparable);
  }
});
test("identical or constant reference series cannot produce infinite displayed ratios", () => {
  const same = relativeMetrics(D.results.VBAL, D.results.VBAL);
  close(same.beta, 1, "self beta"); assert.equal(same.information, null); assert.equal(same.tracking_error, 0);
  const constant = relativeMetrics({monthly:[.01,.02,.03], vol:.1, cagr:.1}, {monthly:[0,0,0], vol:0, cagr:0});
  assert.equal(constant.beta, null); assert.equal(constant.treynor, null);
});
test("French capital entry supports spaces, comma decimals and CAD without accepting invalid amounts", () => {
  for (const [raw, expected] of [["10 000",10000],["12 500,50 $",12500.5],["CAD 5\u202f000",5000],["10000.25",10000.25],["abc",null],["0",null],["-100",null],["1e9",null]]) assert.equal(parseCapital(raw), expected, raw);
});

test("fund labels cover every portfolio holding and comparator without changing numeric data", () => {
  const tickers=new Set([...D.funds,...D.benchmark_order,...Object.values(D.results).flatMap(row=>Object.keys(row.weights||{}))]);
  for(const ticker of tickers){assert.ok(D.fund_labels[ticker]?.name,ticker);assert.equal(D.fund_labels[ticker].description.trim().split(/\s+/).length,2,ticker);assert.match(D.fund_labels[ticker].source_url,/^https:\/\//);}
});
