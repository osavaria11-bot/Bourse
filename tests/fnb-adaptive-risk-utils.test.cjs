'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const R=require('../js/fnb-risk-utils.js'),F=require('../js/fnb-factor-utils.js'),S=require('../js/fnb-stress-utils.js');
const D=require('../data/fnb-analysis.json'),A=require('../data/fnb-daily-risk.json'),H=require('../data/fnb-stress-history.json');
const close=(a,b,e=1e-9)=>assert.ok(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<e,`${a} ≈ ${b}`);
function truncate(data,n){const d=structuredClone(data);d.dates=d.dates.slice(-n);d.universe.dates=d.universe.dates.slice(-n);for(const k in d.universe.returns)d.universe.returns[k]=d.universe.returns[k].slice(-n);for(const k in d.results)d.results[k].monthly=d.results[k].monthly.slice(-n);return d;}
test('maximum drawdown compounds returns, includes the initial peak, and rejects incompatible input',()=>{
 close(R.maximumDrawdown([-.1,.2,-.25]).value,-.25);assert.equal(R.maximumDrawdown([-.1,.2,-.25]).startIndex,1);
 close(R.maximumDrawdown([-.2,.05]).value,-.2);assert.equal(R.maximumDrawdown([-.2,.05]).startIndex,-1);
 close(R.maximumDrawdown([.1,.2,.3]).value,0);close(R.maximumDrawdown([-.5,-.5]).value,-.75);
 assert.equal(R.maximumDrawdown([NaN]),null);assert.equal(R.maximumDrawdown([-1.1]),null);
});
test('downside capture uses compound returns only on negative benchmark months and explains sign reversals',()=>{
 const c=R.downsideCapture([-.05,.2,.1,-.1],[-.1,.01,-.2,-.15]);close(c.portfolio,.95*1.1*.9-1);close(c.benchmark,.9*.8*.85-1);close(c.ratio,c.portfolio/c.benchmark);
 const gain=R.downsideCapture([.01,.02,.03],[-.02,-.03,-.04]);assert.ok(gain.ratio<0);assert.match(gain.interpretation,/Gain/);
 assert.equal(R.downsideCapture([.1,.1],[.1,.2]).ratio,null);assert.equal(R.downsideCapture([.1],[.1,.2]),null);
});
test('conditional downside beta recovers a known crisis slope and refuses fewer than eight down months',()=>{
 const b=Array.from({length:24},(_,i)=>(i%2?-1:1)*(.01+i*.001)),p=b.map(v=>v<0?2*v:.6*v);
 close(F.downside(p,b).beta,2);assert.notEqual(F.beta(p,b),2);assert.equal(F.downside(p.slice(0,14),b.slice(0,14)).beta,null);
 assert.equal(F.downside(p.slice(0,16),b.slice(0,16)).fragile,true);assert.equal(F.downside(p,b).fragile,false);
});
test('21-session observations are disjoint and never bridge a missing exchange session',()=>{
 const x=Array(63).fill(.01),i=Array.from({length:63},(_,i)=>i);
 assert.equal(R.compoundBlocks(x,i).length,3);close(R.compoundBlocks(x,i)[0],1.01**21-1);
 const latest=Array(43).fill(0);latest[42]=-.1;const ends=R.compoundBlocks(latest,latest.map((_,i)=>i));assert.equal(ends.length,2);close(ends.at(-1),-.1);
 const gap=i.map(v=>v>=10?v+1:v);assert.equal(R.compoundBlocks(x,gap).length,2);
 assert.equal(R.compoundBlocks(x.slice(0,20),i.slice(0,20)).length,0);
});
test('tail intervals are deterministic, preserve CVaR coherence, and do not count replications as history',()=>{
 const values=Array.from({length:40},(_,i)=>Math.sin(i)*.03-i*.0001),a=R.bootstrapTail(values),b=R.bootstrapTail(values);
 assert.deepEqual(a,b);assert.equal(a.replications,400);assert.equal(a.blockLength,3);assert.ok(a.var[0]<=a.var[1]);assert.ok(a.cvar[0]<=a.cvar[1]);
 assert.equal(R.bootstrapTail(values.slice(0,23)),null);assert.ok(R.effectiveObservations(values)<=40);
});
test('walk-forward forecasts cannot change when future data are perturbed',()=>{
 const x=Array.from({length:900},(_,i)=>Math.sin(i*.41)*.02),indices=x.map((_,i)=>i),changed=[...x];changed.fill(-.3,700);
 for(const h of [1,21]){const a=R.backtest(x,indices,h),b=R.backtest(changed,indices,h);for(let j=0;j<a.records.length;j++)if(a.records[j].index<700)close(a.records[j].var,b.records[j].var);assert.equal(a.observations,a.records.length);}
});
test('daily histories below 12, 24 and 36 months obey horizon-specific minimums',()=>{
 for(const n of [100,251,252,400,503,504,755]){
  const a=structuredClone(A);a.observations=n;a.daily_series.dates=a.daily_series.dates.slice(-n);a.daily_series.session_indices=a.daily_series.session_indices.slice(-n);for(const t in a.daily_series.returns)a.daily_series.returns[t]=a.daily_series.returns[t].slice(-n);
  const c=R.compare(structuredClone(D),'2','VEQT',a);assert.equal(c.daily.available,n>=252);assert.equal(c.var!==null,n>=504);if(c.var!==null){assert.ok(c.cvar>=c.var-1e-12);assert.equal(c.observations,Math.floor(n/21));assert.equal(c.fragile,true);}
 }
 const missing=R.compare(structuredClone(D),'2','VEQT',null);assert.equal(missing.var,null);assert.equal(missing.drawdown.frequency,'mensuelle');
});
test('absolute and active Euler contributions retain negative hedges and reconcile independently',()=>{
 const returns={X:[-.1,.1,-.2,.2],Y:[.1,-.1,.2,-.2]},c=R.activeContributions({X:.8,Y:.2},{X:.5,Y:.5},returns,4);
 close(c.reduce((s,x)=>s+x.share,0),1);const same=R.activeContributions({X:.5,Y:.5},{X:.5,Y:.5},returns,4);assert.equal(same,null);
});
test('12/24/full stability and significance are descriptive and respect minimum samples',()=>{
 const c=F.stability(D,'2','VEQT');assert.equal(c[0].available,false);assert.equal(c[1].available,true);assert.equal(c[1].months,24);assert.equal(c[2].months,40);
 for(const f of c[2].factors)assert.equal(f.significant,f.low>0||f.high<0);
 assert.equal(F.compare(truncate(D,35),'2','VEQT').available,false);
});
function fixture(){return {as_of:'2026-10-23',status:'current',scenarios:{gfc2008:{assets:{}}},indices:{},reconstructions:{}};}
function observed(value){return {return:value,start:'2007-12-31',end:'2008-12-31',currency:'CAD',total_return:true,source_url:'https://example.org/synthetic-test-source'};}
test('adaptive hierarchy prefers observed, then verified index, then complete dated reconstruction',()=>{
 const h=fixture(),s=S.SCENARIOS[0];h.scenarios.gfc2008.assets.FEQT=observed(-.37);
 h.indices.FEQT={representative:true,methodology_url:'https://example.org/index',scenarios:{gfc2008:observed(-.23)}};
 assert.equal(S.estimate(D,'FEQT',s,h).classification,'observed');close(S.estimate(D,'FEQT',s,h).return,-.37);
 delete h.scenarios.gfc2008.assets.FEQT;assert.equal(S.estimate(D,'FEQT',s,h).classification,'reconstructed');close(S.estimate(D,'FEQT',s,h).return,-.23);
 delete h.indices.FEQT;h.reconstructions.FEQT={validated:true,currency:'CAD',leverage:1,weight_basis:'current',as_of:h.as_of,source_url:'https://example.org/weights',weights:{VDY:.5,VEQT:.5}};
 h.scenarios.gfc2008.assets.VDY=observed(-.4);h.scenarios.gfc2008.assets.VEQT=observed(-.2);
 const r=S.estimate(D,'FEQT',s,h);close(r.return,-.3);assert.match(r.method,/actuelle/);
 h.reconstructions.FEQT.weight_basis='historical';assert.equal(S.estimate(D,'FEQT',s,h).classification,'insufficient','Future weights cannot masquerade as historical weights');
});
test('period stress aggregation is a weighted return, with no extra correlation term or hidden renormalization',()=>{
 const h=fixture(),s=S.SCENARIOS[0];h.scenarios.gfc2008.assets.VDY=observed(-.1);h.scenarios.gfc2008.assets.ZLB=observed(-.3);
 const a=S.aggregate(D,{VDY:.3,ZLB:.7},s,h);close(a.return,-.24);close(a.coverage.observed,1);assert.equal(a.uncertainty,null);
 delete h.scenarios.gfc2008.assets.ZLB;const b=S.aggregate(D,{VDY:.3,ZLB:.7},s,h);assert.equal(b.return,null);close(b.coverage.insufficient,.7);close(b.coverage.observed,.3);
 assert.equal(S.aggregate(D,{VDY:.3},s,h).available,false);
});
test('recent ETFs never acquire a fabricated observed crisis record; beta-only projections are explicit',()=>{
 for(const n of [11,12,23,24,35,36]){
  const d=truncate(D,n),h=fixture();h.scenarios.gfc2008.factor_shocks={market:-.3};
  const r=S.estimate(d,'FEQT',S.SCENARIOS[0],h);assert.equal(r.classification,n>=24?'modeled':'insufficient');
  if(n>=24){assert.equal(r.method,'Projection linéaire fondée sur le bêta');close(r.return,S.models(d,h).FEQT.beta*(-.3));}
 }
});
test('FX shocks compose reciprocal rates and never double-convert historical CAD total returns',()=>{
 const fx=S.SCENARIOS.find(s=>s.id==='cadUp');close((1+fx.shocks.fx)*1.15,1);
 const h=fixture();h.scenarios.gfc2008.assets.VDY=observed(-.1);h.scenarios.gfc2008.factor_shocks={fx:-.2,market:-.3};
 close(S.estimate(D,'VDY',S.SCENARIOS[0],h).return,-.1);
 assert.equal(S.estimate(D,'FEQT',fx,null).classification,'insufficient');
});
test('all ETF portfolios, benchmarks and eight scenarios reconcile coverage, signs and modeled attribution',()=>{
 const before=JSON.stringify(D),source=JSON.stringify(H);
 for(const id of D.order)for(const benchmark of ['VEQT','VFV','VBAL']){
  const scenarios=S.compare(D,id,benchmark,H);assert.equal(scenarios.length,8);
  for(const s of scenarios){for(const x of [s.portfolio,s.benchmark]){close(Object.values(x.coverage).reduce((a,v)=>a+v,0),1);assert.equal(x.available,x.return!==null);}
   if(s.available){close(s.gap,s.portfolio.return-s.benchmark.return);if(s.components)close(Object.values(s.components).reduce((a,v)=>a+v,0),s.gap);if(s.gap>0)assert.equal(s.interpretation,'Protection relative');}
  }
 }
 assert.equal(JSON.stringify(D),before);assert.equal(JSON.stringify(H),source);
});
