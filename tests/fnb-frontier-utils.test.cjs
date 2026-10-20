"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),U=require('../js/fnb-frontier-utils.js'),D=require('../data/fnb-analysis.json');
const near=(a,b,tol=1e-9)=>assert.ok(Math.abs(a-b)<tol,a+' != '+b);
const benchmark=Array.from({length:24},(_,i)=>.012+.025*Math.sin(i*.9));
const series=[benchmark.map((r,i)=>r*.7+.005+.004*Math.cos(i)),benchmark.map((r,i)=>r*1.2+.003-.005*Math.sin(i*.4)),benchmark.map((r,i)=>r*.9+.007+.006*Math.cos(i*.5))];
test('capped simplex projection and interactive weight edits preserve a fully invested, unlevered allocation',()=>{
 for(const cap of [.25,.35,.4,.5,1]){
  const w=U.project([-.2,.3,2,1],cap);assert.ok(U.weightsOK(w,cap));
  for(let i=0;i<w.length;i++)for(const target of [0,.2,.7,1]){const next=U.changeWeight(w,i,target,cap);assert.ok(U.weightsOK(next,cap));}
 }
 assert.throws(()=>U.project([1,1],.4));assert.throws(()=>U.project([NaN,1],1));assert.throws(()=>U.changeWeight([.5,.5],2,.2,1));
});
test('arithmetic annualization, covariance, Sharpe and IR use identical monthly CAD periods',()=>{
 const model=U.moments(series,benchmark,.0237),w=[.2,.3,.5],m=U.metrics(model,w),monthly=benchmark.map((_,t)=>series.reduce((s,r,i)=>s+w[i]*r[t],0));
 const mean=a=>a.reduce((s,v)=>s+v,0)/a.length,sd=a=>Math.sqrt(a.reduce((s,v)=>s+(v-mean(a))**2,0)/(a.length-1)),active=monthly.map((r,i)=>r-benchmark[i]);
 near(m.mean,mean(monthly)*12);near(m.vol,sd(monthly)*Math.sqrt(12));near(m.sharpe,(mean(monthly)*12-.0237)/(sd(monthly)*Math.sqrt(12)));near(m.information,mean(active)*12/(sd(active)*Math.sqrt(12)));
 near(m.cagr,monthly.reduce((v,r)=>v*(1+r),1)**(12/monthly.length)-1);
 assert.throws(()=>U.moments([series[0].slice(1)],benchmark,.02));assert.throws(()=>U.metrics(model,[.5,.5,.5]));
});
test('VEQT versus itself, zero volatility and zero active risk never generate an infinite ratio',()=>{
 const same=U.moments([benchmark,benchmark],benchmark,.02),m=U.metrics(same,[1,0]);near(m.tracking,0);assert.equal(m.information,null);
 const flat=U.moments([Array(24).fill(.01)],Array(24).fill(.005),.02),q=U.metrics(flat,[1]);assert.equal(q.sharpe,null);assert.equal(q.information,null);
 const solved=U.solve({fit:same,cap:1,ids:['A','B']});assert.equal(solved.information,null);
});
test('quadratic solver matches an analytic two-asset optimum and verifies a convex optimality gap',()=>{
 const C=[[.04,.01],[.01,.09]],q=U.quadratic(C,[0,0],1);near(q.weights[0],.08/.11,1e-7);assert.ok(q.gap<1e-8);
 const bounded=U.quadratic(C,[0,0],.6);near(bounded.weights[0],.6,1e-8);
 const linear=U.quadratic([[0,0,0],[0,0,0],[0,0,0]],[.2,.1,0],.5);near(linear.weights[0],.5);near(linear.weights[1],.5);
});
test('equal expected returns retain the minimum-risk frontier rather than an arbitrary dominated endpoint',()=>{
 const a=Array.from({length:24},(_,i)=>1/64+(i%2?1/32:-1/32)),b=a.map((_,i)=>1/64+(i%2?1/128:-1/128));
 const model=U.moments([a,b],benchmark,.02),curve=U.trace(model,1);
 for(const p of curve.points)near(p.vol,Math.sqrt(model.covariance[1][1]),1e-8);
});
test('numerical Sharpe and IR maxima beat a dense feasible grid; each frontier respects its constraints',()=>{
 const fit=U.moments(series,benchmark,.02),cap=.8,solution=U.solve({fit,cap,ids:['A','B','C']});assert.ok(solution.sharpe&&solution.information);
 let bestSharpe=-Infinity,bestIR=-Infinity;
 for(let a=0;a<=80;a++)for(let b=0;b<=80;b++){const w=[a/100,b/100,1-(a+b)/100];if(!U.weightsOK(w,cap))continue;const m=U.metrics(fit,w);if(m.sharpe!==null)bestSharpe=Math.max(bestSharpe,m.sharpe);if(m.information!==null)bestIR=Math.max(bestIR,m.information);}
 assert.ok(solution.sharpe.sharpe>=bestSharpe-1e-5);assert.ok(solution.information.information>=bestIR-1e-5);assert.ok(solution.maxSolverGap<1e-7);
 for(const point of [...solution.absolute,...solution.active,...solution.cloud])assert.ok(U.weightsOK(point.weights,cap));
 for(const [points,active] of [[solution.absolute,false],[solution.active,true]])for(const point of points.filter((_,i)=>i%11===0&&points[i].lambda!==null)){
  const objective=p=>.5*(active?p.tracking**2:p.vol**2)-point.lambda*p.mean;
  for(const other of solution.cloud)assert.ok(objective(point)<=objective(other)+1e-7);
 }
 const balanced=U.compromise(solution.candidates,.5);assert.ok(solution.pareto.some(p=>p===balanced));
});
test('nonpositive excess returns cannot be sold as a positive maximum ratio',()=>{
 const b=Array.from({length:24},(_,i)=>.02+.01*Math.sin(i)),s=[b.map(v=>v-.003),b.map(v=>v-.005)],fit=U.moments(s,b,1),r=U.solve({fit,cap:1,ids:['A','B']});assert.equal(r.sharpe,null);assert.equal(r.information,null);
});
test('validation months never enter calibration moments and exploration never mutates stored portfolios',()=>{
 const before=JSON.stringify(D),p=U.prepare(D),modified=JSON.parse(before),cut=D.dates.length-12;
 for(const id of [...p.ids,'VEQT'])modified.universe.returns[id]=modified.universe.returns[id].map((r,t)=>t>=cut?r+.12:r);
 const changed=U.prepare(modified);assert.deepEqual(changed.fit,p.fit);assert.notDeepEqual(changed.validation,p.validation);assert.equal(p.fit.n,28);assert.equal(p.validation.n,12);assert.equal(U.prepare(D,{sample:'all'}).validation,null);
 const w=U.project(p.ids.map(id=>D.results.proposal.weights[id]||0),p.cap),m=U.marginals(p,w),base=U.metrics(p.fit,w);
 m.forEach((v,i)=>{if(v.step){const q=U.metrics(p.fit,U.changeWeight(w,i,w[i]+.01,p.cap));near(v.sharpe,q.sharpe-base.sharpe);near(v.information,q.information-base.information);near(v.step,.01);}});
 near(m.reduce((s,v)=>s+v.riskShare,0),1);assert.equal(JSON.stringify(D),before);
 const bad=JSON.parse(before);bad.dates[2]='2023-09';assert.throws(()=>U.prepare(bad));assert.throws(()=>U.prepare(D,{ids:['FEQT','VEQT','VCN'],cap:.4}));
});

test('all dated eligible funds are enabled, benchmark wrappers excluded and the original data immutable',()=>{
 const fs=require("node:fs"),extra=fs.existsSync(require("node:path").join(__dirname,"../data/fnb-frontier-universe.json"))?require("../data/fnb-frontier-universe.json"):null,before=JSON.stringify(D),d=U.extend(D,extra),p=U.prepare(d,{cap:.35});
 assert.equal(JSON.stringify(D),before);assert.ok(!p.ids.includes("VEQT"));assert.ok(!p.ids.includes("XEQT"));assert.ok(p.ids.includes("RUD"));
 assert.equal(p.ids.length,16+(extra?Object.keys(extra.funds).length:0));
 if(extra){assert.ok(p.ids.length>=26);const wrong={...extra,as_of:"2000-01-31"};assert.throws(()=>U.extend(D,wrong));}
});
test('diversified QP matches a dense constrained grid and rejects an infeasible universe',()=>{
 const limits={rows:[[1,0,0],[0,1,0],[0,0,1],[-1,0,0],[0,-1,0],[0,0,-1],[1,1,0],[0,0,-1]],bounds:[.8,.8,.8,0,0,0,.6,-.4]};
 const c=[[.04,.01,.005],[.01,.09,.01],[.005,.01,.06]],linear=[.01,.03,.02],q=U.constrainedQuadratic(c,linear,.8,null,limits),objective=w=>.5*w.reduce((s,v,i)=>s+v*c[i].reduce((r,x,j)=>r+x*w[j],0),0)-w.reduce((s,v,i)=>s+v*linear[i],0);
 assert.ok(U.feasible(q.weights,limits));assert.ok(q.gap<1e-7);
 for(let a=0;a<=80;a++)for(let b=0;b<=80;b++){const w=[a/100,b/100,1-(a+b)/100];if(U.feasible(w,limits))assert.ok(objective(q.weights)<=objective(w)+1e-8);}
 const bad=JSON.parse(JSON.stringify(limits));bad.bounds[6]=.1;bad.rows.push([0,0,1]);bad.bounds.push(.4);assert.throws(()=>U.feasibleStart([.3,.3,.4],bad));
});
test('every enlarged frontier point, compromise and slider edit respects economic exposure limits',()=>{
 const fs=require("node:fs"),extra=fs.existsSync(require("node:path").join(__dirname,"../data/fnb-frontier-universe.json"))?require("../data/fnb-frontier-universe.json"):null;
 const d=U.extend(D,extra),p=U.prepare(d,{cap:.35}),solution=U.solve(p),points=[...solution.absolute,...solution.active,...solution.cloud,solution.sharpe,solution.information,U.compromise(solution.pareto)].filter(Boolean);
 for(const point of points){
  const e=U.exposures(p,point.weights);assert.ok(e.valid);assert.ok(e.maxGeoGap<=.10000001);assert.ok(e.maxSectorGap<=.10000001);assert.ok(e.maxSector<=.35000001);assert.ok(e.geo[3]>=.05-1e-8);
  point.weights.forEach((w,i)=>assert.ok(w<=p.limits.caps[i]+1e-8));assert.ok(point.weights.every(w=>w>=-1e-9));
 }
 for(let i=0;i<p.ids.length;i++){const w=U.edit(p,solution.sharpe.weights,i,.1);assert.ok(U.feasible(w,p.limits));}
 const changed=JSON.parse(JSON.stringify(d));for(const id of [...p.ids,"VEQT"])for(let t=28;t<40;t++)changed.universe.returns[id][t]+=.05;
 assert.deepEqual(U.prepare(changed,{cap:.35}).fit,p.fit);
 assert.ok(solution.maxSolverGap<1e-7);
});
