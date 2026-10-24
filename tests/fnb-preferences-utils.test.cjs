"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),D=require('../data/fnb-analysis.json'),rank=require('../scripts/fnb_preferences.cjs');
test('all equity candidates use aligned common windows and a financial score without automatic exclusion',()=>{
 const before=JSON.stringify(D),ranking=rank(D);
 assert.equal(ranking.as_of,D.assumptions.as_of);assert.equal(ranking.entries.length,D.custom_order.length-2+D.proposal_order.length+D.robust_order.length+(D.recommended_order||[]).length);
 assert.ok(!ranking.entries.some(e=>['10','11'].includes(e.id)));
 for(const [i,e] of ranking.entries.entries()){
  assert.equal(e.diagnostics.debut_28.months,28);assert.equal(e.diagnostics.derniers_12.end,D.dates.at(-1));
  assert.equal(e.score,e.worst_information+e.worst_sharpe-25*D.results[e.id].mer);
  assert.equal(e.eligible,e.score!==null);assert.equal(e.performance_review_required,e.signals.length>0);
  if(e.signals.length)assert.match(e.reason,/Points à surveiller/);
  if(i)assert.ok(ranking.entries[i-1].score>=e.score);
 }
 const proposal=ranking.entries.find(e=>e.id==='proposal');assert.equal(proposal.eligible,true);assert.ok(proposal.performance_flags.some(f=>f.includes('IR 12 mois')));
 assert.ok(ranking.entries.find(e=>e.id==='7').limit_flags.some(f=>f.includes('FINN')));
 assert.equal(ranking.entries[0].id,'7','Conviction is judged on financial results rather than fund caps');
 assert.equal(JSON.stringify(D),before,'Ranking never edits an allocation, return or diagnostic');
});
test('an older portfolio with the same profile and lower fees can outrank every Robuste',()=>{
 const d=structuredClone(D),bestRobust=rank(D).entries.find(e=>D.robust_order.includes(e.id)).id;d.results['5']=structuredClone(d.results[bestRobust]);d.results['5'].mer=.001;
 const entries=rank(d).entries,position=entries.find(e=>e.id==='5').rank;
 assert.ok(D.robust_order.every(id=>position<entries.find(e=>e.id===id).rank));
});
test('construction checks retain FEQT and other caps without downgrading existing candidates',()=>{
 const ranking=rank(D),base=ranking.entries.find(e=>e.id==='1');
 for(const id of ['1','8'])assert.ok(!ranking.entries.find(e=>e.id===id).limit_flags.some(f=>f.startsWith('FEQT')));
 assert.ok(base.limit_flags.includes('Limite géographique dépassée'));assert.equal(base.eligible,true);
 assert.ok(!base.signals.includes('Limite géographique dépassée'));
 for(const [ticker,weight,flagged] of [['FEQT',.5,false],['FEQT',.501,true],['FCIV',.36,true],['FINN',.16,true]]){
  const d=structuredClone(D);d.results['1'].weights={[ticker]:weight,VCN:1-weight};
  const entry=rank(d).entries.find(e=>e.id==='1');
  assert.equal(entry.limit_flags.some(f=>f.startsWith(ticker+' au-dessus')),flagged,ticker+' '+weight);
  assert.equal(entry.score,base.score);assert.equal(entry.rank,base.rank);assert.equal(entry.eligible,true);
 }
 assert.equal(require('../data/fnb-model.json').funds.FEQT.max_weight,.50,'Next monthly optimization keeps the existing construction rule');
});
test('geography, sectors and archived exposure alerts cannot change score, eligibility, rank or reasons',()=>{
 const before=rank(D),changed=structuredClone(D),flags=['Limite géographique dépassée','Limite sectorielle dépassée'];
 for(const entry of before.entries){
  const q=changed.results[entry.id];q.geo_equity=[1,0,0,0,0];q.sectors=q.sectors.map((_,i)=>i===0?1:0);
  const prior=q.robust_review?.review_required?q.robust_review.signals||['Revue de robustesse requise']:[];
  q.robust_review={review_required:true,signals:[...prior,...flags]};
 }
 const after=rank(changed),judgment=e=>({id:e.id,rank:e.rank,score:e.score,eligible:e.eligible,signals:e.signals,reason:e.reason,diagnostics:e.diagnostics});
 assert.deepEqual(after.entries.map(judgment),before.entries.map(judgment));
 assert.equal(after.policy.exposure_limits_affect_ranking,false);assert.equal(after.policy.construction_limits_affect_ranking,false);
 for(const e of after.entries){
  for(const flag of flags)assert.ok(e.limit_flags.includes(flag),'Exposure diagnostic is retained: '+flag);
  assert.ok(!e.signals.some(f=>flags.includes(f)));assert.deepEqual(e.ranking_limit_flags,[]);
 }
});
test('fees affect financial quality while crypto, caps and advisory reviews never create a ranking gate',()=>{
 const id=D.robust_order[0],get=d=>rank(d).entries.find(e=>e.id===id),base=get(D);
 const costly=structuredClone(D);costly.results[id].mer+=.001;assert.ok(get(costly).score<base.score);
 const crypto=structuredClone(D);crypto.results[id].crypto=.031;crypto.results[id].robust_review={review_required:true,signals:['Limite crypto dépassée']};
 assert.equal(get(crypto).rank,base.rank);assert.equal(get(crypto).eligible,true);assert.ok(get(crypto).limit_flags.includes('Crypto au-dessus de 3 %'));
 const reviewed=structuredClone(D);reviewed.results[id].robust_review={review_required:true,signals:['Revue de robustesse requise','Limite sectorielle dépassée']};
 assert.equal(get(reviewed).rank,base.rank);assert.equal(get(reviewed).eligible,true);assert.equal(get(reviewed).performance_review_required,true);assert.deepEqual(get(reviewed).signals,['Revue de robustesse requise']);
});
test('recent deterioration changes financial diagnostics rather than automatically excluding a name',()=>{
 const d=structuredClone(D),id=d.robust_order[0],base=rank(D).entries.find(e=>e.id===id);d.results[id].monthly=d.results[id].monthly.map((r,i)=>i>=d.dates.length-12?r-.03:r);
 const entry=rank(d).entries.find(e=>e.id===id);assert.equal(entry.eligible,true);assert.ok(entry.score<base.score);assert.equal(entry.performance_review_required,true);assert.ok(entry.performance_flags.length>0);
 const short=structuredClone(D);short.results['2'].monthly.pop();assert.throws(()=>rank(short),/non aligné/);
});
