"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const W = require("../js/weekly-reports-utils.js");
const NOW = Date.parse("2026-10-17T16:30:00Z");
const sample = () => ({schema_version:1, kind:"savy_weekly_reports", generated_at:"2026-10-17T16:00:00Z", reports:{
  real_estate:{title:"Synthetic property brief", edition_date:"2026-10-12", document_scope:"summary", summary:"Synthetic fixture.", highlights:[],
    document:{path:"reports/real-estate/2026-10-12.pdf",label:"Open summary",mime_type:"application/pdf",pages:2,size_bytes:200,sha256:"a".repeat(64)}},
  stocks:{title:"Synthetic ranking",edition_date:"2026-10-14",reference_date:"2026-10-14",document_scope:"full",summary:"Synthetic fixture.",method_note:"Synthetic scenarios, not recommendations.",
    stocks:["AAA","BBB","CCC","DDD"].map((ticker,index)=>({rank:index+1,ticker,company:"Synthetic "+ticker,rating:4-index/10,decision:"HOLD",summary:"Synthetic thesis.",central_label:"Synthetic central scenario.",risk:"Synthetic risk."})),
    document:{path:"reports/stocks/2026-10-14.pdf",label:"Open report",mime_type:"application/pdf",pages:2,size_bytes:200,sha256:"b".repeat(64)}}
}});
test("dated report contracts retain a smaller ranking and distinct document scopes", () => {
  const data = W.normalize(sample(), NOW);
  assert.equal(data.reports.real_estate.edition_date, "2026-10-12");
  assert.equal(data.reports.real_estate.document_scope, "summary");
  assert.equal(data.reports.stocks.document_scope, "full");
  assert.deepEqual(data.reports.stocks.stocks.map(row => row.ticker), ["AAA", "BBB", "CCC", "DDD"]);
  assert.equal(data.reports.stocks.stocks.length, 4, "do not fill a fifth slot with an ineligible stock");
});
test("invalid or future editions and unsafe or mismatched PDF paths cannot become public links", () => {
  for (const change of [{edition_date: "2026-10-18"}, {edition_date: "2026-02-30"},
    {document: {...sample().reports.stocks.document, path: "javascript:alert(1)"}},
    {document: {...sample().reports.stocks.document, path: "https://example.test/report.pdf"}},
    {document: {...sample().reports.stocks.document, path: "reports/stocks/2026-10-07.pdf"}}]) {
    assert.throws(() => W.normalizeReport({...sample().reports.stocks, ...change}, "stocks", NOW));
  }
  const raw = sample(); raw.reports.stocks.document.path = "../private.json";
  const normalized = W.normalize(raw, NOW);
  assert.equal(normalized.reports.stocks, null);
  assert.equal(normalized.reports.real_estate.edition_date, "2026-10-12", "one malformed edition does not hide the other one");
});
test("ranks and ratings are validated while genuine smaller or empty universes remain valid", () => {
  const raw = sample(), report = raw.reports.stocks;
  for (const change of [{rank: 2}, {ticker: "<img>"}, {rating: 6}, {rating: "3.9"}, {decision: "STRONG BUY"}]) {
    assert.throws(() => W.normalizeReport({...report, stocks: [{...report.stocks[0], ...change}]}, "stocks", NOW));
  }
  assert.equal(W.normalizeReport({...report, stocks: []}, "stocks", NOW).stocks.length, 0);
  assert.equal(W.normalizeReport({...report, stocks: [{...report.stocks[0], rating: null, decision: null}]}, "stocks", NOW).stocks[0].rating, null);
  assert.equal(W.localDay(Date.parse("2026-10-18T01:00:00Z")), "2026-10-17");
});

const performance = () => ({schema_version:1,kind:"savy_finviz_performance",generated_at:"2026-10-17T16:00:00Z",initial_capital:10000,currency:"USD",return_basis:"price_return",launch_date:"2026-09-30",as_of:"2026-10-02",period_start:"2026-10-01",dates:["2026-09-30","2026-10-01","2026-10-02"],values:{top5:[10000,11000,9900],others:[10000,10000,10200],spy:[10000,10100,10300]},method_note:"Synthetic price-return simulation, not investment results."});
test("Finviz performance derives compounded period/cumulative returns and matched SPY gaps from NAVs", () => {
  const p=W.normalizePerformance(performance(),NOW),rows=W.performanceRows(p);
  assert.ok(Math.abs(rows[0].period+.1)<1e-12);
  assert.ok(Math.abs(rows[0].total+.01)<1e-12);
  assert.ok(Math.abs(rows[0].gap_total+.04)<1e-12);
  assert.ok(Math.abs(rows[0].gap_period-(-.1-(10300/10100-1)))<1e-12);
  assert.equal(rows[2].gap_total,0);
});
test("Finviz dates, currency, cash baseline and complete aligned histories are required", () => {
  for(const change of [{initial_capital:9000},{currency:"CAD"},{return_basis:"total_return"},{as_of:"2026-10-03"},{period_start:"2026-09-29"},{generated_at:"2026-10-18T16:00:00Z"},{dates:["2026-09-30","2026-10-01","2026-10-01"]},{values:{...performance().values,top5:[10000,11000]}},{values:{...performance().values,top5:[10000,11000,NaN]}},{values:{...performance().values,top5:[9999,11000,9900]}}])
    assert.throws(()=>W.normalizePerformance({...performance(),...change},NOW));
  const raw=performance();raw.private_positions={ticker:"PRIVATE"};
  assert.equal(W.normalizePerformance(raw,NOW).private_positions,undefined);
});
test("Finviz tracking cannot reset, delete or rewrite a published valuation", () => {
  const previous=W.normalizePerformance(performance(),NOW),next=structuredClone(previous);
  next.dates.push("2026-10-05");next.as_of="2026-10-05";for(const id of W.PERFORMANCE_IDS)next.values[id].push(10500);
  assert.deepEqual(W.continuePerformance(previous,W.normalizePerformance(next,NOW)),next);
  const changed=structuredClone(next);changed.values.top5[1]=10999;assert.throws(()=>W.continuePerformance(previous,changed));
  assert.throws(()=>W.continuePerformance(next,previous));
  const missing=structuredClone(next);missing.dates[1]="2026-10-04";assert.throws(()=>W.continuePerformance(previous,missing));
});
