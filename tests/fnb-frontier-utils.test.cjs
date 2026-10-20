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
