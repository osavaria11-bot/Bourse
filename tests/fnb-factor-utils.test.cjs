"use strict";
const {test} = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const F = require('../js/fnb-factor-utils.js'), render = require('../scripts/fnb_factor_view.cjs');
const D = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/fnb-analysis.json'), 'utf8'));
const close = (a, b, epsilon = 1e-10) => assert.ok(Math.abs(a - b) < epsilon, `${a} ≈ ${b}`);
function synthetic() {
  const d = structuredClone(D), n = d.dates.length, r = d.universe.returns, rf = Math.expm1(Math.log1p(d.assumptions.risk_free) / 12);
  let seed = 81273;
  const noise = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed / 2 ** 32 - .5) * .06;};
  const x = Array.from({length: n}, () => Array.from({length: 5}, noise));
  r.VEQT = x.map(row => row[0] + rf); r.VFV = x.map(row => row[0] * 1.1 + rf);
  for (const [j, long, short] of [[1, 'VVL', 'VEQT'], [2, 'VMO', 'VEQT'], [3, 'FCUQ', 'VFV'], [4, 'FCUL', 'VFV']]) r[long] = x.map((row, i) => row[j] + r[short][i]);
  const beta = [.85, .3, -.2, .1, .4];
  d.results['7'].monthly = x.map(row => rf + .002 + row.reduce((s, v, i) => s + v * beta[i], 0));
  d.results.VEQT.monthly = [...r.VEQT];
  return {d, beta};
}
test('recovers simultaneous signed exposures in an independently constructed portfolio', () => {
  const {d, beta} = synthetic(), c = F.compare(d, '7', 'VEQT');
  assert.equal(c.available, true); assert.equal(c.months, D.dates.length);
  c.factors.forEach((f, i) => {close(f.portfolio, beta[i]); close(f.benchmark, i ? 0 : 1); close(f.delta, beta[i] - (i ? 0 : 1)); close(f.low, f.high, 1e-8);});
  close(c.portfolioR2, 1); close(c.activeR2, 1); close(c.residualContribution, 0);
});
test('every current portfolio and benchmark uses the same common sample and reconciles active variance', () => {
  const before = JSON.stringify(D);
  for (const id of D.order) for (const reference of D.benchmark_order) {
    const c = F.compare(D, id, reference);
    assert.equal(c.available, true, `${id} / ${reference}`); assert.equal(c.start, D.dates[0]); assert.equal(c.end, D.dates.at(-1));
    assert.equal(c.months, D.dates.length);
    for (const f of c.factors) {assert.ok(Number.isFinite(f.portfolio)); assert.ok(f.low <= f.delta && f.delta <= f.high); close(f.delta, f.portfolio - f.benchmark);}
    if (id !== reference) close(c.factors.reduce((s, f) => s + f.contribution, 0) + c.residualContribution, 1);
    else {close(c.trackingError, 0); assert.equal(c.activeR2, null); assert.equal(c.residualContribution, null); c.factors.forEach(f => {close(f.delta, 0); assert.equal(f.contribution, null);});}
  }
  assert.equal(JSON.stringify(D), before, 'Factor analysis never mutates source allocations or returns');
});
test('active attribution permits negative risk contributions without clipping or renormalizing', () => {
  const c = F.compare(D, '7', 'VEQT');
  assert.ok(c.factors.some(f => f.contribution < 0));
  close(c.factors.reduce((s, f) => s + f.contribution, 0) + c.residualContribution, 1);
  close(c.factors.find(f => f.id === 'market').portfolio, .857649958123403, 1e-10);
});
test('reversing portfolio and benchmark reverses sensitivities and intervals, preserves risk attribution', () => {
  const a = F.compare(D, '7', 'VEQT'), b = F.compare(D, 'VEQT', '7');
  close(a.trackingError, b.trackingError); close(a.activeR2, b.activeR2);
  a.factors.forEach((f, i) => {const g = b.factors[i]; close(f.delta, -g.delta); close(f.low, -g.high); close(f.high, -g.low); close(f.contribution, g.contribution);});
});
test('missing, short, duplicate and mismatched histories remain unavailable without inventing returns', () => {
  for (const mutate of [
    d => {delete d.universe.returns.VVL;}, d => {d.results['7'].monthly.pop();},
    d => {d.universe.returns.FCUQ.fill(null, 0, d.dates.length - 35);}, d => {d.universe.returns.VMO[15] = null;},
    d => {d.universe.dates[1] = d.universe.dates[0];}, d => {d.dates[0] = '2023-13';},
    d => {d.assumptions.risk_free = null;}, d => {d.universe.returns.VVL = [...d.universe.returns.VEQT];},
    d => {d.universe.returns.VMO = [...d.universe.returns.VVL];}
  ]) {const d = structuredClone(D); mutate(d); assert.equal(F.compare(d, '7', 'VEQT').available, false);}
  assert.equal(F.compare(D, 'unknown', 'VEQT').available, false);
});
test('a contiguous aligned overlap of at least 36 months uses its real dates', () => {
  const d = structuredClone(D), offset = d.dates.length - 36; d.universe.dates = d.universe.dates.slice(offset);
  for (const k of Object.keys(d.universe.returns)) d.universe.returns[k] = d.universe.returns[k].slice(offset);
  const c = F.compare(d, '7', 'VEQT'); assert.equal(c.available, true); assert.equal(c.months, 36); assert.equal(c.start, D.dates[offset]);
});
test('factor panel is rebuilt once during full and fast quote publication', () => {
  const html = '<section id="exposures"><h2 id="exposuresTitle">Géographie et secteurs</h2><div class="exposure-grid"></div></section><script src="../js/fnb-dashboard.js?v=old"></script>';
  const once = render(html), twice = render(once);
  assert.equal(once, twice); assert.equal((once.match(/id="factorTitle"/g) || []).length, 1);
  assert.equal((once.match(/src="\.\.\/js\/fnb-factor-utils.js/g) || []).length, 1);
  assert.ok(once.indexOf('id="factorTitle"') < once.indexOf('class="exposure-grid"'));
  assert.match(fs.readFileSync(path.join(__dirname, '../scripts/build_monthly_fnb.cjs'), 'utf8'), /fnb_factor_view/);
  const report = fs.readFileSync(path.join(__dirname, '../reports/portefeuilles-fnb.html'), 'utf8');
  assert.match(report, /id="factorTitle"/); assert.match(report, /fnb-factor-utils.js\?v=20261024-factors/);
});
