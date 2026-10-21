"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),D=require('../data/fnb-analysis.json'),rank=require('../scripts/fnb_preferences.cjs');
test('all equity candidates use aligned common windows, explicit flags and one disclosed score',()=>{
 const before=JSON.stringify(D),ranking=rank(D);
 assert.equal(ranking.as_of,D.assumptions.as_of);assert.equal(ranking.entries.length,13);
 assert.ok(!ranking.entries.some(e=>['10','11'].includes(e.id)));
 for(const e of ranking.entries){
  assert.equal(e.diagnostics.debut_28.months,28);assert.equal(e.diagnostics.derniers_12.end,D.dates.at(-1));
  assert.equal(e.score,e.worst_information+e.worst_sharpe-25*D.results[e.id].mer);
  if(e.eligible)assert.equal(e.signals.length,0);
  else assert.match(e.reason,/Réévaluation requise/);
 }
 const proposal=ranking.entries.find(e=>e.id==='proposal');assert.equal(proposal.eligible,false);assert.ok(proposal.performance_flags.some(f=>f.includes('IR 12 mois')));
 assert.ok(ranking.entries.find(e=>e.id==='7').limit_flags.some(f=>f.includes('FINN')));
 assert.equal(JSON.stringify(D),before,'Ranking never edits an allocation, return or diagnostic');
});
test('an older portfolio with the same profile and lower fees can outrank every Robuste',()=>{
 const d=structuredClone(D);d.results['5']=structuredClone(d.results[d.robust_order[1]]);d.results['5'].mer=.001;
 assert.equal(rank(d).entries[0].id,'5');
});
test('FEQT has a 50% exception in every candidate, without exempting geography, crypto or other funds',()=>{
 const ranking=rank(D);
 for(const id of ['1','8'])assert.ok(!ranking.entries.find(e=>e.id===id).limit_flags.some(f=>f.startsWith('FEQT')));
 assert.ok(ranking.entries.find(e=>e.id==='1').limit_flags.includes('Limite géographique dépassée'));
 for(const [ticker,weight,blocked] of [['FEQT',.5,false],['FEQT',.501,true],['FCIV',.36,true],['FINN',.16,true]]){
  const d=structuredClone(D);d.results['1'].weights={[ticker]:weight,VCN:1-weight};
  assert.equal(rank(d).entries.find(e=>e.id==='1').limit_flags.some(f=>f.startsWith(ticker+' au-dessus')),blocked,ticker+' '+weight);
 }
 assert.equal(require('../data/fnb-model.json').funds.FEQT.max_weight,.50,'Next monthly optimization follows the same exception');
});
test('recent deterioration is screened for every candidate regardless of its name',()=>{
 const d=structuredClone(D),id=d.robust_order[0];d.results[id].monthly=d.results[id].monthly.map((r,i)=>i>=d.dates.length-12?r-.03:r);
 const entry=rank(d).entries.find(e=>e.id===id);assert.equal(entry.eligible,false);assert.ok(entry.performance_flags.length>0);
 const short=structuredClone(D);short.results['2'].monthly.pop();assert.throws(()=>rank(short),/non aligné/);
});
