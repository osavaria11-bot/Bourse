"use strict";
const {test} = require("node:test"), assert = require("node:assert/strict");
const H = require("../js/portfolio-heatmap-utils.js"), P = require("../js/portfolio-utils.js");
function fixture() {
  const days = ["2025-12-31", "2026-07-15", "2026-09-15", "2026-10-08", "2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"];
  const prices = {series: [{id: "CAD", quote_symbol: "CAD.TO", currency: "CAD", title: "Canada", history: days.map((day, i) => [day, 100 + i * 10])},
    {id: "USD", quote_symbol: "USD", currency: "USD", title: "US", history: days.map((day, i) => [day, 200 - i * 10])},
    {id: "USDCAD", history: days.map(day => [day, 1.4])}]};
  const positions = [{ticker: "CAD", currency: "CAD", quantity: 10}, {ticker: "USD", currency: "USD", quantity: 5}];
  return {prices, positions, current: P.valuationAt(positions, prices, days.at(-1))};
}
test("heatmap uses CAD areas/weights but listing-currency returns and never mutates holdings", () => {
  const {prices, current} = fixture(), before = structuredClone({prices, current}), result = H.model(current, prices);
  assert.equal(result.complete, true); assert.equal(result.end, "2026-10-15");
  assert.ok(Math.abs(result.rows[0].percent - (180 / 170 - 1) * 100) < 1e-10);
  assert.ok(Math.abs(result.rows[1].percent - (120 / 130 - 1) * 100) < 1e-10);
  assert.equal(result.rows[1].value_cad, 840);
  assert.ok(Math.abs(result.rows.reduce((sum, row) => sum + row.weight, 0) - 100) < 1e-10);
  const fxOnly = structuredClone(current); fxOnly.rows[1].value_cad *= 2; fxOnly.total += 840;
  assert.equal(H.model(fxOnly, prices).rows[1].percent, result.rows[1].percent);
  assert.deepEqual({prices, current}, before);
});
test("all historical periods have explicit baselines and preserve missing history", () => {
  const {prices, current} = fixture();
  for (const [range, start] of [["1W", "2026-10-08"], ["1M", "2026-09-15"], ["3M", "2026-07-15"], ["YTD", "2025-12-31"]]) {
    const result = H.model(current, prices, prices, range);
    assert.equal(result.start, start); assert.equal(result.rows[0].baseline_date, start);
    assert.ok(result.rows.every(row => typeof row.percent === "number"));
  }
  prices.series[0].history = prices.series[0].history.slice(-1);
  assert.equal(H.model(current, prices).rows[0].percent, null);
  assert.equal(H.model(current, prices, prices, "YTD").rows[0].percent, null);
  assert.throws(() => H.model(current, prices, prices, "bogus"), /invalide/);
});
test("intraday includes today's point in five sessions and never colors an older session as today's return", () => {
  const {prices, current} = fixture(), intraday = structuredClone(prices), quoted = structuredClone(current);
  intraday.series[0].current_quote = {id: "CAD", quote_symbol: "CAD.TO", currency: "CAD", price: 190, previous_close: 180, session_date: "2026-10-16", timestamp: "2026-10-16T14:00:00Z"};
  quoted.rows[0].price = 190; quoted.rows[0].price_date = "2026-10-16";
  const day = H.model(quoted, prices, intraday);
  assert.equal(day.end, "2026-10-16"); assert.ok(Math.abs(day.rows[0].percent - 100 / 18) < 1e-10);
  assert.equal(day.rows[1].percent, null); assert.match(day.rows[1].reason, /antérieure/);
  assert.equal(H.model(quoted, prices, intraday, "1W").start, "2026-10-09");
  intraday.series[0].current_quote.quote_symbol = "WRONG";
  assert.equal(H.model(quoted, prices, intraday).rows[0].percent, null);
});
test("partial FX valuation keeps all selector rows but never invents an area or exact weight", () => {
  const {prices, positions} = fixture(); prices.series[2].history = [];
  const result = H.model(P.valuationAt(positions, prices, "2026-10-15"), prices);
  assert.equal(result.complete, false); assert.equal(result.rows.length, 2); assert.equal(result.valued.length, 1);
  assert.deepEqual(result.missing, ["USD"]); assert.ok(result.rows.every(row => row.weight === null));
  assert.notEqual(result.rows[1].percent, null);
  assert.deepEqual(H.model(null, null).rows, []); assert.equal(H.model(null, null).end, null);
});
test("no fabricated zero returns for missing prices, while rounding avoids negative zero", () => {
  const {prices, current} = fixture(); prices.series[0].history.at(-2)[1] = 180.001;
  assert.equal(H.model(current, prices).rows[0].percent, 0);
  prices.series[0].history.at(-2)[1] = 181;
  assert.ok(H.model(current, prices).rows[0].percent < 0);
  Object.assign(current.rows[0], {price: null, price_date: null});
  assert.equal(H.model(current, prices).rows[0].reason, "Cours indisponible");
});
for (const [width, height] of [[1200, 420], [270, 390], [1, 1]]) test(`200 treemap tiles preserve area, bounds and non-overlap at ${width}×${height}`, () => {
  const rows = Array.from({length: 200}, (_, index) => ({ticker: "T" + index, value_cad: index === 199 ? .0001 : 200 - index}));
  const total = rows.reduce((sum, row) => sum + row.value_cad, 0), before = structuredClone(rows), tiles = H.layout(rows, width, height);
  assert.equal(tiles.length, rows.length); let area = 0;
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i]; area += tile.width * tile.height;
    assert.ok(tile.x >= 0 && tile.y >= 0 && tile.width > 0 && tile.height > 0);
    assert.ok(tile.x + tile.width <= width + 1e-9 && tile.y + tile.height <= height + 1e-9);
    assert.ok(Math.abs(tile.width * tile.height / (width * height) - tile.value_cad / total) < 1e-10);
    for (const other of tiles.slice(i + 1)) {
      const overlapW = Math.min(tile.x + tile.width, other.x + other.width) - Math.max(tile.x, other.x);
      const overlapH = Math.min(tile.y + tile.height, other.y + other.height) - Math.max(tile.y, other.y);
      assert.ok(overlapW < 1e-9 || overlapH < 1e-9);
    }
  }
  assert.ok(Math.abs(area / (width * height) - 1) < 1e-10); assert.deepEqual(rows, before);
  assert.deepEqual(H.layout([...rows].reverse(), width, height), tiles);
});
test("single, empty, zero-sized and unvalued layouts are safe", () => {
  assert.deepEqual(H.layout([{ticker: "ONLY", value_cad: 10}], 300, 400), [{ticker: "ONLY", value_cad: 10, x: 0, y: 0, width: 300, height: 400}]);
  for (const [width, height] of [[0, 10], [10, -1], [Infinity, 10], [NaN, 10]]) assert.deepEqual(H.layout(fixture().current.rows, width, height), []);
  assert.deepEqual(H.layout([{ticker: "A", value_cad: null}, {ticker: "B", value_cad: -1}], 300, 400), []);
  assert.deepEqual(H.layout([], 300, 400), []);
});
test("stable color scale distinguishes gains/losses and clamps color, not numeric returns", () => {
  assert.equal(H.color(null, 3), "#263747"); assert.equal(H.color(0, 3), "#263747");
  assert.notEqual(H.color(1, 3), H.color(-1, 3)); assert.notEqual(H.color(1, 3), H.color(2, 3));
  assert.equal(H.color(3, 3), H.color(300, 3)); assert.equal(H.color(-3, 3), H.color(-300, 3));
  assert.match(H.color(.35, 3), /^#[0-9a-f]{6}$/);
});
