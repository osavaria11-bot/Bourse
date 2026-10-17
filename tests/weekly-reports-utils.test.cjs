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
