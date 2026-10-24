'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const R=require('../js/fnb-risk-utils.js'),D=require('../data/fnb-analysis.json'),view=require('../scripts/fnb_risk_view.cjs');
const close=(a,b,e=1e-10)=>assert.ok(Math.abs(a-b)<e,`${a} ≈ ${b}`);
test('historical loss quantile and integrated expected shortfall use the actual empirical tail',()=>{
 const r=R.losses(Array.from({length:40},(_,i)=>-(i+1)/100));close(r.var,.38);close(r.cvar,.395);
 const fractional=R.losses(Array.from({length:30},(_,i)=>-(i+1)/100));close(fractional.var,.29);close(fractional.cvar,(.30+.5*.29)/1.5);
 assert.equal(R.losses([.1,NaN]),null);assert.equal(R.losses([], .95),null);assert.equal(R.losses([.1],NaN),null);
});
test('Euler contributions reconcile and retain hedges with negative risk contributions',()=>{
 const a=[-.1,.1,-.2,.2],b=a.map(x=>-x),c=R.contributions({A:.8,B:.2},{A:a,B:b},4);
 close(c.reduce((s,v)=>s+v.share,0),1);close(c[0].share,4/3);close(c[1].share,-1/3);
 assert.equal(R.contributions({A:1},{A:[0,0,0]},3),null);assert.equal(R.contributions({A:1},{A:[.1]},3),null);
});
test('every selectable portfolio and benchmark recalculates monthly tail risk without changing data',()=>{
 const original=JSON.stringify(D);
 for(const id of D.order)for(const reference of D.benchmark_order){const c=R.compare(D,id,reference);assert.equal(c.available,true);assert.ok(c.cvar>=c.var-1e-12);assert.ok(c.top.length<=4);close(c.contributions.reduce((s,v)=>s+v.share,0),1);close(c.top.reduce((s,v)=>s+v.share,0)+c.other,1);if(id===reference&&c.benchmarkVar>0)close(c.relativeVar,1);}
 assert.equal(JSON.stringify(D),original);assert.equal(R.compare(D,'missing','VEQT').available,false);
});
test('relative VaR uses the stated benchmark and is undefined when its loss threshold is nonpositive',()=>{
 const d=structuredClone(D);d.results.VEQT.monthly=Array(d.dates.length).fill(.01);assert.equal(R.compare(d,'7','VEQT').relativeVar,null);
 const a=R.compare(D,'7','VEQT'),b=R.compare(D,'7','VFV');close(a.var,b.var);close(a.cvar,b.cvar);close(a.stress,b.stress);assert.notEqual(a.relativeVar,b.relativeVar);
});
test('the compact card is idempotent and survives the shared report renderer',()=>{
 const html='<section id="exposures"><!-- fnb-factors:start --></section><script src="../js/fnb-dashboard.js?v=old"></script>';
 const a=view(html);assert.equal(view(a),a);assert.equal((a.match(/id="riskSnapshotTitle"/g)||[]).length,1);
 assert.match(fs.readFileSync(require.resolve('../scripts/build_monthly_fnb.cjs'),'utf8'),/fnb_risk_view/);
});
