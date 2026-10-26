'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const render=require('../scripts/fnb_prospective_view.cjs'),C=require('../data/fnb-prospective-proposals.json');
const root=path.resolve(__dirname,'..'),bytes=fs.readFileSync(path.join(root,C.source)),packet=JSON.parse(bytes);
test('dated projects retain a verifiable source and never manufacture a robust 50 percent result',()=>{
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),C.source_sha256);
  assert.equal(render.validate(C,packet),C);
  assert.deepEqual(C.portfolios.map(q=>q.centralThreshold),[false,false]);
  assert.deepEqual(C.portfolios.map(q=>q.robustThreshold),[false,false]);
  assert.equal(C.registered,false);assert.equal(packet.ids.length,30);
  assert.equal(packet.prepared.initialVol,packet.planning.initialVol);
  for(const change of [c=>c.portfolios[0].centralThreshold=true,c=>c.portfolios[1].robustThreshold=true,c=>c.portfolios[0].history.beatProbability=1,c=>c.portfolios[0].weights.FCMO=.36,c=>c.portfolios[0].probabilityRange[0]=.5]){
    const c=structuredClone(C);change(c);assert.throws(()=>render.validate(c,packet));
  }
});
test('rounded target weights reconcile fees and actual equity-sleeve regions and sectors',()=>{
  const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);
  for(const q of C.portfolios){
    close(Object.values(q.weights).reduce((a,b)=>a+b,0),1);
    assert.equal(Object.keys(q.weights).length,8);
    const w=packet.ids.map(t=>q.weights[t]||0),eq=w.map((v,i)=>v*packet.limits.equity[i]),total=eq.reduce((a,b)=>a+b,0);
    close(q.limits.mer,w.reduce((s,v,i)=>s+v*packet.prepared.rows[packet.indices[i]].mer,0));
    for(const field of ['geo','sector'])for(let j=0;j<q.limits[field].length;j++)close(q.limits[field][j],eq.reduce((s,v,i)=>s+v*packet.limits[field][i][j],0)/total);
    for(const [t,v] of Object.entries(q.weights)){assert.ok(v>=.02);assert.ok(v<=packet.limits.caps[packet.ids.indexOf(t)]+1e-9);close(v*1000,Math.round(v*1000));}
    close(q.limits.innovationMomentum,['FINN','FCMO','VMO','XMI'].reduce((s,t)=>s+(q.weights[t]||0),0));assert.ok(q.limits.innovationMomentum<=.30+1e-9);
    assert.ok(q.limits.maxGeoGap<=.1);assert.ok(q.limits.maxSectorGap<=.07);assert.ok(q.limits.maxSector<=.35);
  }
});
test('one allocation from both dated searches is integrated with the other portfolios, without a separate research panel',()=>{
  const D=require('../data/fnb-analysis.json'),html=fs.readFileSync(path.join(root,'reports/portefeuilles-fnb.html'),'utf8');
  assert.equal(D.prospective_order.filter(id=>D.results[id].research_ids).length,1);
  const id=D.prospective_order[0],q=D.results[id];
  assert.ok(C.portfolios.every(p=>JSON.stringify(p.weights)===JSON.stringify(q.weights)));
  assert.deepEqual(q.research_ids,C.portfolios.map(p=>p.id));assert.equal(q.benchmark,'VFV');
  assert.equal((html.match(/data-prospective-project=/g)||[]).length,0);
  assert.equal((html.match(new RegExp('data-fiche="'+id+'"','g'))||[]).length,1);
  for(const chart of ['risk','growth'])assert.equal((html.match(new RegExp('id="'+chart+'-series-'+id+'"','g'))||[]).length,1);
  assert.ok(require('../js/fnb-decision-utils.js').candidates(D,'VFV').includes(id));
  const ranking=require('../scripts/fnb_preferences.cjs')(D);assert.ok(ranking.entries.find(e=>e.id===id)?.eligible);
  assert.ok(require('../data/fnb-horizon-ranking.json').considered_ids.includes(id));
});
test('the same forecast and ranking methods apply to the new portfolio at 2, 5 and 10 years',()=>{
  const D=require('../data/fnb-analysis.json'),H=require('../data/fnb-stress-history.json'),M=require('../data/macro-data.json'),F=require('../js/fnb-forecast-utils.js'),U=require('../js/fnb-decision-utils.js');
  const id=D.prospective_order[0],before=JSON.stringify(D),p=F.prepare(D,H,M);
  assert.equal(p.available,true);assert.ok(p.rows.some(r=>r.id===id));assert.ok(!p.unavailable.some(r=>r.id===id));
  const historical=U.analyse(D,[id,'7',D.robust_order[0]],'VFV',require('../data/fnb-daily-risk.json'),H);
  assert.equal(historical.available,true);assert.equal(historical.basis,'daily');assert.ok(historical.rows.find(r=>r.id===id).cvar>0);
  for(const years of [2,5,10]){
    const a=F.simulate(p,years,{ids:[id,'7'],paths:300,internal:true}),r=a.rows.find(r=>r.id===id);
    assert.equal(a.available,true);assert.ok(Number.isFinite(r.medianAnnual));assert.ok(r.benchmarks.VFV.probability>=0&&r.benchmarks.VFV.probability<=1);
    assert.ok(F.ranking(a.rows,'growth').has(id));assert.ok(F.global(a.rows,'forward').ranks.has(id));
  }
  assert.equal(JSON.stringify(D),before);
});
