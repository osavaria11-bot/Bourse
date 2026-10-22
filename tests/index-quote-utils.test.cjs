const test = require("node:test"), assert = require("node:assert/strict");
const J = require("../js/index-quote-utils.js"), I = require("../js/intraday-utils.js");
const now = Date.parse("2026-10-22T15:02:00Z");
function fixture() {
  const data = {};
  for (const d of J.definitions) {
    data["q" + d.id] = {symbol: d.symbol, currency: d.currency, datatype: d.type, prevClose: 100};
    data["c" + d.id] = [{dateTime: "2026-10-21T16:00:00-04:00", close: 100},
      {dateTime: "2026-10-22T10:50:00-04:00", close: 101}, {dateTime: "2026-10-22T10:55:00-04:00", close: 102},
      {dateTime: "2026-10-22T11:00:00-04:00", close: 103}, {dateTime: "2026-10-22T10:57:00-04:00", close: 999}];
  }
  return {data};
}
test("TMX backup keeps exact listings, currencies, completed bar times and previous-session returns", () => {
  const rows = J.parse(fixture(), now);
  assert.equal(rows.length, 4);
  for (const row of rows) {
    assert.equal(row.timestamp, "2026-10-22T15:00:00.000Z");
    assert.equal(row.price, 102); assert.equal(row.previous_close, 100);
    assert.equal(row.fetched_at, new Date(now).toISOString());
    assert.equal(row.intraday_history.length, 2);
    const data = I.normalize({schema_version: 1, kind: "intraday_quotes", generated_at: row.fetched_at, quotes: [row]}, now);
    const session = I.marketSession({id: row.id, quote_symbol: row.quote_symbol, currency: row.currency}, data, now);
    assert.ok(Math.abs(session.percent - 2) < 1e-10);
    assert.match(I.label(session.quote), /TMX Money/);
    assert.match(session.quote.source_url, /^https:\/\/money.tmx.com\//);
  }
  assert.match(J.request(now).query, /fromDate:"2026-10-15"/);
});
test("TMX partial failures, wrong indices, currencies and invalid or future bars never replace valid quotes", () => {
  const source = fixture(); source.data.qTSX.symbol = "^TX60"; source.data.qIXIC.currency = "CAD";
  source.data.qEEM.datatype = "equity";
  source.data.cFEQT = [{dateTime: "2026-10-22T11:00:00-04:00", close: 103},
    {dateTime: "2026-10-22T10:55:00Z", close: 102}, {dateTime: "2026-10-22T10:50:00-04:00", close: -1}];
  assert.deepEqual(J.parse(source, now), []);
  const partial = fixture(); partial.data.qIXIC = null; partial.errors = [{message: "Provider unavailable"}];
  assert.equal(J.parse(partial, now).length, 3);
  assert.deepEqual(J.parse(fixture(), now + 9 * 86400000), []);
  assert.ok(J.parse(fixture(), now + 86400000).every(q => q.fetch_status === "cached"), "Yesterday's observations cannot look current during today's open hours");
});
test("source attribution is fixed to the verified provider and symbol", () => {
  const row = J.parse(fixture(), now)[0];
  const wrap = q => I.normalize({schema_version: 1, kind: "intraday_quotes", generated_at: row.fetched_at, quotes: [q]}, now).quotes[0];
  assert.equal(wrap({...row, source_url: "https://evil.example/"}).source_url, "https://money.tmx.com/en/quote/%5ECOMPX%3AUS");
  assert.equal(wrap({...row, source_symbol: "^TX60"}).source_label, "Yahoo Finance");
  const spx = {...row, id: "SPX", quote_symbol: "^GSPC", currency: "USD", source_provider: "cboe", source_symbol: "_SPX"};
  assert.equal(wrap(spx).source_label, "Cboe");
});
