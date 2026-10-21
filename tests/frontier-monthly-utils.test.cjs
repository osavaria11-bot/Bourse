"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const U=require("../js/fnb-frontier-utils.js"),M=require("../scripts/build_frontier_monthly.cjs");
const data=U.extend(require("../data/fnb-analysis.json"),require("../data/fnb-frontier-universe.json"));
const original=JSON.stringify(data),firstMonth=data.optimization.month;
const first=M.build(data,{generatedAt:new Date().toISOString()});
// Synthetic future observations are test fixtures only; they are never published.
const next=structuredClone(data);
const [year,month]=firstMonth.split("-").map(Number),nextMonth=new Date(Date.UTC(year,month,1)).toISOString().slice(0,7);
next.dates.push(firstMonth);next.assumptions.as_of=new Date(Date.UTC(year,month,0)).toISOString().slice(0,10);
next.optimization.month=nextMonth;next.assumptions.risk_free+=.0033;
Object.keys(next.universe.returns).forEach((id,i)=>next.universe.returns[id].push(.01+.006*Math.sin(i)));
const second=M.build(next,{generatedAt:nextMonth+"-01T13:00:00Z",previous:first});
test("monthly profiles preserve the browser's current universe, limits and split without mutating source data",()=>{
 assert.deepEqual(first.inputs.ids,data.optimization.eligible_funds);assert.ok(first.inputs.ids.includes("FEQT"));
 assert.equal(first.policy.crypto_cap,.03);assert.equal(first.policy.fund_caps["CGL.C"],.05);
 assert.equal(first.policy.fund_caps.XIT,.10);assert.equal(first.policy.fund_caps.ZEB,.10);
 assert.equal(first.policy.fund_caps.FEQT,.50);assert.equal(first.policy.general_cap,.50);
 assert.equal(first.policy.geo_tolerance,.10);assert.equal(first.policy.sector_tolerance,.07);
 assert.equal(first.comparison,null);assert.equal(first.samples.split.dates.validation.length,12);
 assert.equal(first.samples.all.dates.validation.length,0);
 assert.equal(JSON.stringify(data),original);
 const p=U.prepare(data),solution=U.solve(p);
 for(const id of ["sharpe","information"]){
  assert.deepEqual(first.samples.split.profiles[id].weights,Object.fromEntries(p.ids.map((t,i)=>[t,solution[id].weights[i]])));
 }
 for(const sample of Object.values(first.samples)){
  assert.equal(sample.audit.absolute_points,61);assert.equal(sample.audit.active_points,61);
  assert.ok(sample.audit.checked_candidates>600);assert.ok(sample.audit.max_solver_gap<1e-7);
  for(const profile of Object.values(sample.profiles))assert.ok(profile.exposures.valid);
 }
});
test("a new FEQT allowance does not rewrite the former monthly policy, inputs or ratios",()=>{
 const archived=require('../data/fnb-frontier-history/2026-10.json'),before=JSON.stringify(archived);
 assert.equal(archived.policy.fund_caps.FEQT,.35);
 assert.equal(archived.policy.sector_tolerance,.10);
 assert.equal(JSON.stringify(M.inputsFor(data,archived.inputs.cap,archived.policy)),JSON.stringify(archived.inputs),'Serialized inputs and their digest stay byte-equivalent');
 M.validate(archived);
 const changed=structuredClone(data);changed.universe.returns.FEQT[0]+=.001;
 assert.notDeepEqual(M.inputsFor(changed,archived.inputs.cap,archived.policy),archived.inputs,'Old sources still reject revisions');
 assert.equal(JSON.stringify(archived),before);
});
test("monthly changes compare both allocations on the same new window and risk-free rate",()=>{
 assert.equal(second.comparison.previous_month,firstMonth);
 assert.deepEqual(second.comparison.added_months,[firstMonth]);
 assert.ok(Math.abs(second.comparison.risk_free_change-.0033)<1e-12);
 const sample=second.samples.split,p=M.prepare(second.inputs,"split"),profile=sample.profiles.compromise;
 const comparison=profile.comparison,oldWeights=p.ids.map(id=>first.samples.split.profiles.compromise.weights[id]);
 assert.deepEqual(comparison.previous_weights_on_current_window.calibration,U.metrics(p.fit,oldWeights));
 const oldReturns=p.fit.benchmark.map((_,m)=>p.fit.series.reduce((s,series,i)=>s+oldWeights[i]*series[m],0));
 const active=oldReturns.map((r,i)=>r-p.fit.benchmark[i]),mean=active.reduce((s,r)=>s+r,0)/active.length;
 const tracking=Math.sqrt(12*active.reduce((s,r)=>s+(r-mean)**2,0)/(active.length-1));
 assert.ok(Math.abs(comparison.previous_weights_on_current_window.calibration.information-mean*12/tracking)<1e-10);
 assert.ok(Math.abs(comparison.one_way_turnover-comparison.changes.reduce((s,c)=>s+Math.abs(c.current-c.previous),0)/2)<1e-12);
 assert.ok(Math.abs(comparison.strategy_change_on_current_window.calibration.sharpe-(profile.calibration.sharpe-comparison.previous_weights_on_current_window.calibration.sharpe))<1e-12);
 M.validate(second,first);
});
test("retired funds cannot silently produce a same-window comparison with missing returns",()=>{
 const p=M.prepare(second.inputs,"split"),old=structuredClone(first.samples.split.profiles.sharpe);
 old.weights.RETIRED=.01;
 const comparison=M.compareProfile(p,second.samples.split.profiles.sharpe,old);
 assert.deepEqual(comparison.unavailable_previous_funds,["RETIRED"]);
 assert.equal(comparison.previous_weights_on_current_window,null);
 assert.equal(comparison.strategy_change_on_current_window,null);
});
test("immutable monthly archives are idempotent and independently validated before becoming current",()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"savy-frontier-monthly-"));
 try{
  M.publish(root,first);
  const archive=path.join(root,"data/fnb-frontier-history/"+firstMonth+".json"),bytes=fs.readFileSync(archive,"utf8");
  M.publish(root,first);assert.equal(fs.readFileSync(archive,"utf8"),bytes);
  const changed=structuredClone(first);changed.note="A different edition cannot replace the archive";
  assert.throws(()=>M.publish(root,changed),/immutable/);
  const broken=structuredClone(second);broken.samples.split.profiles.sharpe.calibration.sharpe+=.1;
  assert.throws(()=>M.publish(root,broken),/ratio/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,"data/fnb-frontier-monthly.json"))).month,firstMonth);
  assert.ok(!fs.existsSync(path.join(root,"data/fnb-frontier-history/"+nextMonth+".json")));
  const wrong=structuredClone(second);wrong.samples.split.profiles.sharpe.comparison.one_way_turnover+=.1;
  assert.throws(()=>M.publish(root,wrong),/Monthly changes/);
  assert.ok(!fs.existsSync(path.join(root,"data/fnb-frontier-history/"+nextMonth+".json")));
  M.publish(root,second);assert.equal(fs.readFileSync(archive,"utf8"),bytes);
  const index=JSON.parse(fs.readFileSync(path.join(root,"data/fnb-frontier-history/index.json")));
  assert.deepEqual(index.months.map(x=>x.month),[firstMonth,nextMonth]);
  assert.equal(index.latest_month,nextMonth);
  assert.throws(()=>M.validate(wrong,first),/Monthly changes/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test("incomplete month alignment cannot create an apparently fresh frontier",()=>{
 const broken=structuredClone(data);broken.optimization.month=nextMonth;
 assert.throws(()=>M.build(broken),/last completed month/);
 const extra=structuredClone(require("../data/fnb-frontier-universe.json"));extra.dates.pop();
 assert.throws(()=>U.extend(require("../data/fnb-analysis.json"),extra),/mêmes mois/);
});
test("a month with no positive Sharpe is still archived with an explicit unavailable profile",()=>{
 const bear=structuredClone(data);
 for(const values of Object.values(bear.universe.returns))for(let i=0;i<values.length;i++)values[i]-=.1;
 const record=M.build(bear);
 for(const sample of Object.values(record.samples)){
  assert.equal(sample.profiles.sharpe,null);
  assert.match(sample.unavailable_profiles.sharpe,/No positive finite ratio/);
 }
 M.validate(record);
});
