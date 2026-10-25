'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),F=require('../js/fnb-forecast-utils');
const D=require('../data/fnb-analysis.json'),H=require('../data/fnb-stress-history.json'),M=require('../data/macro-data.json');
const close=(a,b,t=1e-9)=>assert.ok(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<t,`${a} ≈ ${b}`);
const ids=['7',...D.robust_order.slice(0,2)];
const prepared=F.prepare(D,H,M);
const small=(p,years=2,options={})=>F.simulate(p,years,{paths:300,internal:true,ids,...options});
test('Black-Litterman recovers the analytic scalar posterior and its uncertainty',()=>{
 const m=F.blackLitterman([[.04]],[.06],[[1]],[.10],[[.01]],.25);
 close(m.mean[0],.08);close(m.uncertainty[0][0],.005);
 const strong=F.blackLitterman([[.04]],[.06],[[1]],[.10],[[1e-8]],.25),weak=F.blackLitterman([[.04]],[.06],[[1]],[.10],[[100]],.25);
 assert.ok(strong.mean[0]>.099);assert.ok(weak.mean[0]<.06001);
 assert.equal(F.blackLitterman([[-.04]],[.06],[[1]],[.1],[[.01]],.25),null);
 assert.equal(F.blackLitterman([[.04]],[.06],[[1]],[NaN],[[.01]],.25),null);
});
test('overlapping views share uncertainty; duplicate assets receive identical conditional means',()=>{
 const m=F.blackLitterman([[.04,.04],[.04,.04]],[.06,.06],[[1,0],[0,1]],[.1,.1],[[.01,.0099],[.0099,.01]],.25);
 close(m.mean[0],m.mean[1]);close(m.uncertainty[0][0],m.uncertainty[1][0]);
 const L=F.cholesky(m.uncertainty);assert.ok(L);close(L[0][0],L[1][0]);close(L[1][1],0,1e-8);
});
test('calibration reuses real CAD returns, dated proxy history, actual allocations and existing matrix moments',()=>{
 const before=JSON.stringify([D,H,M]),p=F.prepare(D,H,M);assert.equal(p.available,true,p.reason);assert.equal(p.rows.length,Object.keys(D.results).length);
 assert.equal(p.longAvailable,true);assert.ok(p.coreDates.length>=120);assert.ok(p.coreDates[0]<='2008-01');
 for(const row of p.rows){
  const weights=D.results[row.id].weights;
  for(let t=0;t<D.universe.dates.length;t++)close(row.returns[t],Object.entries(weights).reduce((s,[id,w])=>s+w*D.universe.returns[id][t],0));
  close(Object.values(row.coverage).reduce((s,v)=>s+v,0),1);assert.ok(row.meanSE>0);assert.ok(row.exposures.length===9||row.factorReason);
 }
 assert.equal(JSON.stringify([D,H,M]),before,'No portfolio, return history or source snapshot is mutated');
 assert.deepEqual(p.means.views,['VFV','FEQT','VEQT']);assert.equal(p.regimes.estimated,false);assert.match(p.regimes.reason,/transitions/);
});
test('short common samples use a documented joint block fallback, never invented four-regime probabilities',()=>{
 const h=structuredClone(H);delete h.forward_history;
 const p=F.prepare(D,h,M);assert.equal(p.available,true);assert.equal(p.core.length,0);assert.equal(p.regimes.estimated,false);
 const a=small(p,10);assert.equal(a.available,true);assert.equal(a.coreStart,null);assert.ok(a.rows.every(r=>Number.isFinite(r.medianAnnual)));
 assert.match(a.limitations.join(' '),/crises absentes/);
});
test('new ETFs with less than 12, 24 or 36 months use declared current exposures, not fabricated observed history',()=>{
 for(const months of [0,6,11,12,23,24,35]){
  const d=structuredClone(D),h=structuredClone(H),t='RECENT';
  d.universe.returns[t]=D.dates.map((_,i)=>i<D.dates.length-months?null:D.universe.returns.VFV[i]);
  d.universe.geo[t]=[1,0,0,0,0];d.universe.equity[t]=1;for(const k of ['gold','crypto','bond','cash'])d.universe[k][t]=0;d.universe.mer[t]=.002;
  d.results.recent={weights:{[t]:1},mer:.002,geo_total:[1,0,0,0,0,0,0,0,0]};
  const p=F.prepare(d,h,M),row=p.rows.find(r=>r.id==='recent');assert.ok(row);close(row.coverage.modeled,months===D.dates.length?0:1);
  assert.match(row.funds[0].method,/Projection géographique/);assert.equal(row.funds[0].months,months);assert.equal(d.universe.returns[t].filter(x=>x===null).length,D.dates.length-months);
  const a=small(p,5,{ids:['recent']});assert.ok(a.rows.find(r=>r.id==='recent').futureValue>0);
 }
 const bad=structuredClone(D);bad.results.recent={weights:{RECENT:1},mer:.002,geo_total:[1,0,0,0,0,0,0,0,0]};
 const p=F.prepare(bad,H,M);assert.ok(p.unavailable.some(r=>r.id==='recent'));assert.ok(!p.rows.some(r=>r.id==='recent'));
});
test('validated representative indices take precedence over current geographic projections',()=>{
 const d=structuredClone(D),h=structuredClone(H);d.universe.returns.NEW=Array(D.dates.length).fill(null);d.results.new={weights:{NEW:1},mer:.002,geo_total:[1,0,0,0,0,0,0,0,0]};
 h.indices.NEW={validated:true,representative:true,currency:'CAD',total_return:true,source_url:'https://example.org/index',as_of:h.as_of,dates:D.dates,returns:D.universe.returns.VFV};
 const p=F.prepare(d,h,M),r=p.rows.find(r=>r.id==='new');assert.ok(r);close(r.coverage.reconstructed,1);assert.match(r.funds[0].method,/Indice/);
 h.indices.NEW.representative=false;assert.ok(F.prepare(d,h,M).unavailable.some(r=>r.id==='new'));
});
test('unknown geography, short series and leverage fail locally without deleting other forecasts',()=>{
 const d=structuredClone(D);d.results.bad={weights:{VFV:1.5},mer:.01,geo_total:[1,0,0,0,0,0,0,0,0]};
 const p=F.prepare(d,H,M);assert.equal(p.available,true);assert.ok(p.unavailable.some(r=>r.id==='bad'));
 const short=structuredClone(D);short.universe.dates=short.universe.dates.slice(0,11);assert.equal(F.prepare(short,H,M).available,false);
 const gaps=structuredClone(D);gaps.universe.dates[3]='2023-11';assert.equal(F.prepare(gaps,H,M).available,false);
});
test('net forward anchors charge MER once and do not reuse the recent historical CAGR as expected alpha',()=>{
 const d=structuredClone(D),p=F.prepare(d,H,M),index=p.rows.findIndex(r=>r.id==='7'),before=p.rows[index].mean;
 d.results['7'].mer+=.01;const after=F.prepare(d,H,M).rows[index].mean;close(before-after,.01);
 const altered=structuredClone(D);altered.results['7'].cagr=8;altered.results['7'].sharpe=999;
 close(F.prepare(altered,H,M).rows[index].mean,before);
 assert.ok(Math.abs(before-D.results['7'].cagr)>.05);
});
test('25 000 is the production minimum, not evidence of long-horizon calibration',()=>{
 assert.equal(F.simulate(prepared,5,{paths:24999}).available,false);assert.equal(F.simulate(prepared,3).available,false);
 assert.equal(F.simulate(prepared,5,{paths:NaN}).available,false);
 assert.equal(F.walkForward(prepared,D).longHorizonCalibrated,false);
});
test('joint seeded trajectories are reproducible, selection-invariant, and preserve their horizon prefixes',()=>{
 const d=structuredClone(D);d.results.clone=structuredClone(D.results['7']);d.results.clone.id='clone';const p=F.prepare(d,H,M);
 const a=small(p,2,{ids:['7','clone']}),b=small(p,5,{ids:['7','clone']}),c=small(p,10,{ids:['7','clone']});
 assert.deepEqual(a,small(p,2,{ids:['7','clone']}));
 for(const r of a.rows){
  assert.deepEqual(r.fan,b.rows.find(x=>x.id===r.id).fan.slice(0,3));assert.deepEqual(r.fan,c.rows.find(x=>x.id===r.id).fan.slice(0,3));
 }
 const original=a.rows.find(r=>r.id==='7'),clone=a.rows.find(r=>r.id==='clone');
 close(original.median,clone.median);close(original.benchmarks.VFV.probability,clone.benchmarks.VFV.probability);
 const alone=small(p,2,{ids:['7']}).rows.find(r=>r.id==='7');assert.deepEqual(original,alone);
 for(const ref of F.BENCHMARKS){const row=a.rows.find(r=>r.id===ref);close(row.benchmarks[ref].probability,0);close(row.benchmarks[ref].tie,1);close(row.benchmarks[ref].expectedAnnualGap,0);}
});
test('drawdowns during the path are distinct from terminal losses even if the portfolio recovers',()=>{
 const p=structuredClone(prepared);p.core=[];p.dates=['a','b'];p.options.parameterUncertainty=false;p.options.blockLength=1;p.initialVol=1;
 for(const r of p.rows){r.mean=0;r.annualLogVariance=0;r.noise=[Math.log(.65),Math.log(1/.65)];r.residual=r.noise;r.coreCoefficients=null;}
 const a=small(p,2);
 for(const r of a.rows){assert.ok(r.drawdownProbability['0.3']>r.terminalLoss['0.3']);assert.ok(r.drawdownProbability['0.2']>=r.drawdownProbability['0.3']);assert.ok(r.drawdownProbability['0.3']>=r.drawdownProbability['0.4']);}
});
test('all requested thresholds, paired benchmark gaps and future wealth are mathematically consistent',()=>{
 const a=small(prepared,5);
 for(const r of a.rows){
  assert.ok(r.p10<=r.median&&r.median<=r.p90);close(r.futureValue,100000*(1+r.median));close(r.medianAnnual,Math.expm1(Math.log1p(r.median)/5));
  assert.ok(r.targets['0.08']>=r.targets['0.1']&&r.targets['0.1']>=r.targets['0.15']);
  assert.ok(r.terminalLoss['0.2']>=r.terminalLoss['0.3']&&r.terminalLoss['0.3']>=r.terminalLoss['0.4']);
  assert.ok(r.lossProbability+r.positiveProbability<=1+1e-12);
  for(const v of Object.values(r.benchmarks)){assert.ok(v.probability>=0&&v.probability<=1);assert.ok(v.p10<=v.p90);}
 }
});
test('persistent mean uncertainty widens long-term results; it is not reduced by dividing by simulations',()=>{
 const certain=structuredClone(prepared);certain.options.parameterUncertainty=false;
 const a=small(prepared,10),b=small(certain,10);
 const widths=x=>x.rows.filter(r=>ids.includes(r.id)).reduce((s,r)=>s+r.p90-r.p10,0);
 assert.ok(widths(a)>widths(b));assert.ok(a.comparisons.some(c=>c.indistinguishable));
});
test('walk-forward trains strictly before the forecast month and compares all models on identical eligible dates',()=>{
 const v=F.walkForward(prepared,D);assert.ok(v.records.length>0);
 for(const r of v.records){assert.ok(r.origin<r.date);assert.ok(r.trainMonths>=24);if(r.model==='hybrid')assert.ok(r.date>'2026-04');}
 for(const row of v.rows){const counts=row.models.map(m=>m.observations);assert.ok(counts.every(n=>n===counts[0]));assert.equal(counts[0],5);}
 const d=structuredClone(D),cut=D.dates.indexOf('2026-09');
 for(const s of Object.values(d.universe.returns))s[cut]=.5;
 const changed=F.walkForward(F.prepare(d,H,M),d);
 const key=r=>[r.id,r.model,r.date].join('|'),map=new Map(changed.records.map(r=>[key(r),r]));
 for(const r of v.records)if(r.date==='2026-09')close(r.estimate,map.get(key(r)).estimate);
});
test('macro freshness is explicit and stale VIX cannot drive the volatility adjustment',()=>{
 const m=structuredClone(M);m.series.find(s=>s.id==='VIXCLS').date='2020-01-01';
 const p=F.prepare(D,H,m);close(p.initialVol,1);assert.equal(p.macro.find(s=>s.id==='VIXCLS').stale,true);
});
test('sensitivity envelopes vary means, volatility and correlations; crisis is separate with no assigned frequency',()=>{
 const s=F.sensitivity(prepared,2,ids);assert.equal(s.scenarios.length,6);assert.equal(s.scenarios.at(-1).id,'crisis');assert.match(s.method,/sans probabilité attribuée/);
 for(const r of s.rows){assert.ok(r.medianAnnual[0]<=r.medianAnnual[1]);assert.ok(r.beatProbability[0]<=r.beatProbability[1]);assert.ok(r.crisis.drawdown90>0);}
});
test('global ranking uses dominance rather than an opaque sum and retains competing tradeoffs',()=>{
 const rows=[{id:'a',medianAnnual:.1,p10:-.1,lossProbability:.2,drawdown90:.3,beatProbability:.6,mer:.005},{id:'b',medianAnnual:.08,p10:-.05,lossProbability:.1,drawdown90:.2,beatProbability:.55,mer:.003},{id:'c',medianAnnual:.07,p10:-.11,lossProbability:.25,drawdown90:.4,beatProbability:.5,mer:.006}];
 const g=F.global(rows,'forward');assert.deepEqual(g.front,['a','b']);assert.equal(g.ranks.get('a'),1);assert.equal(g.ranks.get('c'),2);assert.ok(g.comparisons.find(r=>r.id==='c').dominatedBy.includes('a'));
 assert.equal(F.global([{id:'a'},{id:'b'}],'forward').available,false);
});
test('production forecasts actually compute 25 000 joint trajectories with the three benchmarks at 2, 5 and 10 years',()=>{
 for(const years of [2,5,10]){
  const a=F.simulate(prepared,years,{ids});assert.equal(a.available,true);assert.equal(a.paths,25000);assert.equal(a.rows.length,6);
  for(const r of a.rows){assert.ok(Number.isFinite(r.expectedAnnual));assert.ok(r.futureValue>0);assert.equal(r.fan.length,years+1);}
 }
});
