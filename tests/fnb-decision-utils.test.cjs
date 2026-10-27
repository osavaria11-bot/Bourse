'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const U=require('../js/fnb-decision-utils'),R=require('../js/fnb-risk-utils');
const D=require('../data/fnb-analysis.json'),A=require('../data/fnb-daily-risk.json'),H=require('../data/fnb-stress-history.json'),P=require('../data/fnb-performance.json');
const close=(a,b)=>assert.ok(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<1e-10,`${a} ≈ ${b}`);
test('daily decision metrics recover compounded returns, sample volatility and arithmetic Sharpe',()=>{
  const x=Array.from({length:252},(_,i)=>i%2?.01:-.01),m=U.metrics(x,252,.02,x.map((_,i)=>i));
  close(m.annualReturn,(1-.0001)**126-1);close(m.vol,.01*Math.sqrt(252*252/251));close(m.sharpe,-.02/m.vol);
  assert.equal(m.cvar,null);assert.equal(m.blocks,12);assert.equal(m.tailFragile,true);
  assert.equal(U.metrics([.01],252,.02),null);assert.equal(U.metrics([NaN,.01]),null);assert.equal(U.metrics([-1,.01]),null);
  assert.equal(U.metrics(x.slice(0,251),252,.02).annualReturn,null);assert.equal(U.metrics(x.slice(0,251),252,.02).sharpe,null);
});
test('every candidate and benchmark uses identical dates, conventions and daily source weights',()=>{
  const before=JSON.stringify([D,A,H]),ids=U.choices(D,'VEQT'),a=U.analyse(D,ids,'VEQT',A,H);
  assert.deepEqual(ids,['7',...D.robust_order.slice(0,2)]);assert.equal(a.basis,'daily');assert.equal(a.rows.length,4);
  for(const row of a.rows){
    const x=A.daily_series.dates.map((_,i)=>Object.entries(D.results[row.id].weights).reduce((s,[t,w])=>s+w*A.daily_series.returns[t][i],0));
    assert.deepEqual(row.returns,x);close(row.annualReturn,x.reduce((s,v)=>s*(1+v),1)**(252/x.length)-1);
    close(row.maxDrawdown,R.maximumDrawdown(x).value);close(row.cvar,R.losses(R.compoundBlocks(x,A.daily_series.session_indices)).cvar);
    assert.equal(row.observations,a.dates.length);assert.equal(row.tailFragile,true);
  }
  assert.equal(JSON.stringify([D,A,H]),before,'No allocation, historical rank or daily dataset is mutated');
});
test('short histories and absent daily weights never produce a fabricated monthly CVaR',()=>{
  for(const n of [100,251,252,400,503,504,755]){
    const a=structuredClone(A);a.observations=n;a.daily_series.dates=a.daily_series.dates.slice(-n);a.daily_series.session_indices=a.daily_series.session_indices.slice(-n);
    for(const t in a.daily_series.returns)a.daily_series.returns[t]=a.daily_series.returns[t].slice(-n);
    const result=U.analyse(structuredClone(D),['2','7'],'VEQT',a,H);assert.equal(result.basis,n>=252?'daily':'monthly');
    for(const row of result.rows)assert.equal(row.cvar!==null,n>=504);
  }
  const bad=structuredClone(A);bad.results['7'].weights={FEQT:1};
  const a=U.analyse(structuredClone(D),['7','2'],'VEQT',bad,H);assert.equal(a.basis,'monthly');assert.ok(a.rows.every(r=>r.cvar===null));
  const missing=U.analyse(D,['2'],'VEQT',null,H);assert.equal(missing.basis,'monthly');
  const incomplete=structuredClone(D);incomplete.results['2'].monthly=[];assert.equal(U.analyse(incomplete,['2','7'],'VEQT',null,H).available,false);
  const gaps=structuredClone(A);gaps.daily_series.session_indices[gaps.daily_series.session_indices.length-1]++;
  assert.equal(U.analyse(structuredClone(D),['2'],'VEQT',gaps,H).basis,'monthly');
});
test('mandates and benchmark-relative rankings stay separate, with distinct user choices',()=>{
  assert.deepEqual(U.candidates(D,'VBAL'),['10']);assert.deepEqual(U.candidates(D,'FBAL'),['10']);assert.deepEqual(U.candidates(D,'VGRO'),['11']);
  assert.ok(!U.candidates(D,'VEQT').some(k=>['10','11'].includes(k)));
  assert.deepEqual(U.choices(D,'VEQT',['2','2','7']),['2','7',D.robust_order[0]]);
  const rows=[{id:'a',annualReturn:.2,sharpe:1,cvar:.1},{id:'b',annualReturn:.1,sharpe:2,cvar:.05},{id:'c',annualReturn:null,sharpe:2,cvar:null},{id:'ref',isBenchmark:true,annualReturn:1,sharpe:5,cvar:0}];
  assert.equal(U.ranks(rows,'growth').get('a'),1);assert.equal(U.ranks(rows,'balance').get('b'),1);assert.equal(U.ranks(rows,'balance').get('c'),1);
  assert.equal(U.ranks(rows,'protection').get('b'),1);assert.equal(U.ranks(rows,'protection').has('c'),false);assert.equal(U.ranks(rows,'growth').has('ref'),false);
  assert.equal(U.ranks(rows,'unknown').size,0);
});
test('personal loss thresholds flag available shocks without turning missing scenarios into safety',()=>{
  const row={maxDrawdown:-.15,scenarios:[{name:'loss',portfolio:{available:true,return:-.3,classification:'modeled'}},{name:'gain',portfolio:{available:true,return:.2,classification:'observed'}},{name:'missing',portfolio:{available:false,return:null}}]};
  const t=U.tolerance(row,.2);assert.equal(t.status,'exceeded');assert.equal(t.breaches.length,1);assert.equal(t.missing,1);close(t.worst,.3);
  assert.equal(U.tolerance(row,.4).status,'not_exceeded_in_available');assert.equal(U.tolerance(row,null).status,'unset');
  assert.equal(U.tolerance({maxDrawdown:null,scenarios:[row.scenarios[2]]},.2).status,'unavailable');
});
test('post-publication returns use actual launch dates and the identical allocation, never the common-start simulation',()=>{
  for(const id of [...D.custom_order,...D.robust_order,...D.recommended_order,...D.proposal_order]){
    const accountId=D.custom_order.includes(id)?'savy-'+id:id==='proposal'?'proposal-'+D.optimization.month:id;
    const account=P.accounts.find(a=>a.id===accountId),r=U.recorded(D,id,'VEQT',P);
    assert.ok(account,id);
    if(!account.history.length){assert.equal(r.available,false,id);continue;}
    assert.equal(r.available,true,id);assert.equal(r.start,account.launch_date);assert.equal(r.end,P.as_of);
  }
  // Fixed synthetic days exercise the period arithmetic independently of the
  // growing public ledger. Appending a real session must not break this test.
  const id=D.robust_order[0],sample={methodology:{model:'buy_hold_fractional_ex_date_close_v1'},as_of:'2026-10-23',accounts:[
    {id,weights:D.results[id].weights,launch_date:'2026-10-21',published_at:'2026-10-20T20:00:00Z',history:[
      {date:'2026-10-21',value:10000},{date:'2026-10-22',value:10100},{date:'2026-10-23',value:10200}]},
    {id:'VEQT',kind:'benchmark',history:[{date:'2026-10-19',value:9000},{date:'2026-10-20',value:9500},
      {date:'2026-10-21',value:10000},{date:'2026-10-22',value:10050},{date:'2026-10-23',value:10100}]}]};
  const r=U.recorded(D,id,'VEQT',sample);assert.equal(r.start,'2026-10-21');assert.equal(r.observations,2);assert.equal(r.short,true);
  close(r.total,.02);close(r.gap,.01);
  const extended=structuredClone(sample);extended.as_of='2026-10-26';extended.accounts[0].history.push({date:'2026-10-26',value:10300});extended.accounts[1].history.push({date:'2026-10-26',value:10150});
  const next=U.recorded(D,id,'VEQT',extended);assert.equal(next.observations,3);assert.equal(next.start,r.start);close(next.total,.03);close(next.gap,.015);
  assert.equal(U.recorded(D,id,'VEQT',require('../data/fnb-comparison.json')).available,false);
  const changed=structuredClone(D);changed.results[id].weights={VEQT:1};assert.equal(U.recorded(changed,id,'VEQT',sample).available,false);
  assert.equal(U.recorded(D,id,'NONEXISTENT',sample).gap,null);
  const pending=structuredClone(sample);pending.accounts[0].history=[];assert.equal(U.recorded(D,id,'VEQT',pending).available,false);
});
test('date windows and bounded weight transfers produce descriptive ranks without optimizing allocations',()=>{
  const before=JSON.stringify(D),a=U.analyse(D,['7',D.robust_order[0],D.robust_order[1]],'VEQT',A,H);
  const s=U.sensitivity(D,a,'balance');assert.equal(s.length,3);
  for(const row of s){assert.deepEqual(row.windows.map(w=>w.observations),[252,504,A.observations]);assert.ok(row.weightVariants>0);assert.ok(row.weightRank.every(v=>v>=1&&v<=3));assert.ok(row.weightMetric[0]<=row.weightMetric[1]);}
  const protect=U.sensitivity(D,a,'protection');assert.ok(protect.every(s=>s.windows[0].rank===null),'12 months do not support 24 disjoint blocks');
  const monthly=U.analyse(D,['2','7'],'VEQT',null,H);assert.ok(U.sensitivity(D,monthly,'balance').every(s=>s.weightRank===null));
  assert.equal(JSON.stringify(D),before);
});
test('shared holdings are a documented partial view of the top ten, retaining issuer contributions',()=>{
  const o=U.overlap(D,'2');assert.equal(o.funds,Object.keys(D.results['2'].weights).length);
  close(o.top10,D.lookthrough.results['2'].top10_weight);
  for(const p of o.sharedTop){assert.ok(p.funds.length>1);assert.ok(D.lookthrough.results['2'].top10.some(x=>x.name===p.name));}
});
test('the selected horizon compounds one real common trailing period without including the base-day return',()=>{
  const dates=Array.from({length:36},(_,i)=>String(2022+Math.floor(i/12))+'-'+String(i%12+1).padStart(2,'0'));
  const a={available:true,dates,rows:[{id:'p',returns:Array(36).fill(.01)},{id:'b',isBenchmark:true,returns:Array(36).fill(.005)}]};
  const before=JSON.stringify(a),h=U.horizon(a,2);
  assert.equal(h.available,true);assert.equal(h.start,'2022-12');assert.equal(h.end,'2024-12');assert.equal(h.observations,24);
  close(h.results[0].total,1.01**24-1);close(h.results[1].total,1.005**24-1);assert.equal(JSON.stringify(a),before);
  for(const years of [5,10]){const h=U.horizon(a,years);assert.equal(h.available,false);assert.deepEqual(h.results,[]);assert.match(h.reason,/plus court/);}
  for(const years of ['',0,1,NaN])assert.equal(U.horizon(a,years),null);
});
test('daily horizon anniversaries use the prior common session, handle leap years and reject incomplete histories',()=>{
  const a={available:true,dates:['2022-02-25','2022-02-28','2022-03-01','2024-02-29'],rows:[{id:'p',returns:[.7,.8,.1,.2]}]};
  const h=U.horizon(a,2);assert.equal(h.requestedStart,'2022-02-28');assert.equal(h.start,'2022-02-28');close(h.results[0].total,.32);
  a.dates=['2022-02-25','2022-02-28','2022-03-01','2024-02-27'];assert.equal(U.horizon(a,2).start,'2022-02-25','Closed anniversary uses the previous common close');
  a.rows[0].returns.pop();assert.equal(U.horizon(a,2).available,false);a.rows[0].returns.push(NaN);assert.equal(U.horizon(a,2).available,false);
});
