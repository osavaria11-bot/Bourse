"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8')),D=read('data/fnb-analysis.json'),U=require('../js/fnb-frontier-utils.js'),{consolidate}=require('../scripts/fnb_holdings.cjs');
test('three robust selections meet all frontier limits and have complete sourced equity look-through',()=>{
 const E=U.extend(D,read('data/fnb-frontier-universe.json')),p=U.prepare(E,{cap:.35,sample:'split'}),H=read('data/fnb-holdings.json');
 assert.equal(D.robust_order.length,3);
 for(const k of D.robust_order){
  const q=D.results[k],w=p.ids.map(t=>q.weights[t]||0);assert.ok(U.feasible(w,p.limits),k);
  const x=U.exposures(p,w);assert.ok(x.assets.crypto<=.03+1e-8);assert.ok(!q.weights.VEQT&&!q.weights.XEQT);
  const h=consolidate(q.weights,H.funds);assert.deepEqual(h,D.lookthrough.results[k]);assert.ok(h.stock_count>1000);assert.equal(h.top10.length,10);
  assert.ok(D.order.includes(k)&&D.exposure_order.includes(k));assert.ok(D.preference_ranking.entries.some(e=>e.id===k));
 }
});
test('robust cards and choices render idempotently without editing historical publications',()=>{
 const stage=fs.mkdtempSync(path.join(os.tmpdir(),'savy-robust-'));
 try{
  for(const f of ['data/fnb-analysis.json','data/fnb-frontier-universe.json','reports/portefeuilles-fnb.html']){fs.mkdirSync(path.dirname(path.join(stage,f)),{recursive:true});fs.copyFileSync(path.join(root,f),path.join(stage,f));}
  const build=()=>execFileSync(process.execPath,[path.join(root,'scripts/build_monthly_fnb.cjs'),stage]);build();
  const first=fs.readFileSync(path.join(stage,'reports/portefeuilles-fnb.html'),'utf8');build();assert.equal(fs.readFileSync(path.join(stage,'reports/portefeuilles-fnb.html'),'utf8'),first);
  for(const k of D.robust_order){assert.equal((first.match(new RegExp('data-fiche="'+k+'"','g'))||[]).length,1);for(const chart of ['risk','growth'])assert.equal((first.match(new RegExp('id="'+chart+'-series-'+k+'"','g'))||[]).length,1);}
  const archived=read('data/fnb-history/2026-10.json');assert.equal(archived.robust_order,undefined);assert.equal(archived.custom_order.length,11);
 }finally{fs.rmSync(stage,{recursive:true,force:true});}
});
test('a deteriorating robustness selection leaves the first preferences without changing its weights',()=>{
 const copy=structuredClone(D),id=copy.robust_order[0],weights=structuredClone(copy.results[id].weights);
 copy.results[id].robust_review={review_required:true,signals:['Retard cumulé sur 6 mois face à VEQT']};
 const ranking=require('../scripts/fnb_preferences.cjs')(copy);
 assert.equal(ranking.entries.at(-1).id,id);assert.match(ranking.entries.at(-1).reason,/Réévaluation requise/);assert.deepEqual(copy.results[id].weights,weights);
});
