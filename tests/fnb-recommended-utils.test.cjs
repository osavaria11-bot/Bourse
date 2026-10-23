"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const D=require('../data/fnb-analysis.json'),H=require('../data/fnb-holdings.json'),rank=require('../scripts/fnb_preferences.cjs'),{consolidate}=require('../scripts/fnb_holdings.cjs');
test('three accepted portfolios have complete look-through, charts, risk data and annual research',()=>{
 const html=fs.readFileSync(require('node:path').join(__dirname,'../reports/portefeuilles-fnb.html'),'utf8');
 assert.equal(D.recommended_order.length,3);
 for(const k of D.recommended_order){
  const q=D.results[k];assert.equal(q.benchmark,'VFV');assert.ok(D.order.includes(k)&&D.exposure_order.includes(k));
  assert.deepEqual(consolidate(q.weights,H.funds),D.lookthrough.results[k]);assert.equal(D.lookthrough.results[k].top10.length,10);
  assert.ok(q.max_geo_gap<=.10&&q.max_sector_gap<=.07&&q.gold<=.05+1e-8&&q.crypto<=.03);
  assert.equal((html.match(new RegExp('data-fiche="'+k+'"','g'))||[]).length,1);
  for(const chart of ['risk','growth'])assert.equal((html.match(new RegExp('id="'+chart+'-series-'+k+'"','g'))||[]).length,1);
  assert.equal(q.historical_backtest.rebalance,'january_targets');assert.equal(q.historical_backtest.periods.after.months,33);
  for(const field of ['sharpe','information','beta','treynor','tracking_error','sortino','max_drawdown'])assert.ok(Number.isFinite(q[field]),k+' '+field);
 }
 assert.match(html,/Backtest long · rééquilibrage annuel en janvier/);assert.match(html,/ce n’est pas un test indépendant/);
});
test('VFV reference and VEQT holding permission are scoped to the three additions',()=>{
 const ranking=rank(D);
 for(const e of ranking.entries)assert.equal(e.benchmark,D.recommended_order.includes(e.id)?'VFV':'VEQT');
 const id=D.recommended_order[2];assert.deepEqual(ranking.entries.find(e=>e.id===id).limit_flags,[]);
 const bad=structuredClone(D);bad.results[id].weights.VEQT=.401;
 assert.ok(rank(bad).entries.find(e=>e.id===id).limit_flags.some(f=>f.startsWith('VEQT au-dessus')));
 const legacy=structuredClone(D);legacy.results['2'].weights={VEQT:.4,VFV:.3,XEF:.3};
 assert.ok(rank(legacy).entries.find(e=>e.id==='2').limit_flags.includes('Benchmark détenu dans l’allocation'));
});
