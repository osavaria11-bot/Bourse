"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),D=require('../data/fnb-analysis.json'),rank=require('../scripts/fnb_preferences.cjs');
test('the shared quote-publication command cannot restore a stale financial ranking or remove horizon opinions',()=>{
 const stage=fs.mkdtempSync(path.join(os.tmpdir(),'savy-ranking-publication-'));
 try{
  const files=['data/fnb-analysis.json','data/fnb-catalog.json','data/fnb-frontier-universe.json','data/fnb-horizon-ranking.json','reports/portefeuilles-fnb.html','js/fnb-frontier-utils.js',...['build_report_archive','build_monthly_fnb','fnb_preferences','fnb_horizon_view','fnb_performance_view','fnb_frontier_view','fnb_frontier_overlay','fnb_factor_view','fnb_risk_view'].map(s=>'scripts/'+s+'.cjs')];
  for(const file of files){fs.mkdirSync(path.dirname(path.join(stage,file)),{recursive:true});fs.copyFileSync(path.join(root,file),path.join(stage,file));}
  for(const folder of ['stocks','real-estate'])fs.mkdirSync(path.join(stage,'reports',folder),{recursive:true});
  const stale=structuredClone(D);stale.preference_ranking={method_version:'stale',entries:[],criteria:'Ancien classement'};fs.writeFileSync(path.join(stage,'data/fnb-analysis.json'),JSON.stringify(stale));
  const command=()=>execFileSync(process.execPath,[path.join(stage,'scripts/build_report_archive.cjs')],{cwd:stage});command();
  const current=JSON.parse(fs.readFileSync(path.join(stage,'data/fnb-analysis.json'),'utf8')),html=fs.readFileSync(path.join(stage,'reports/portefeuilles-fnb.html'),'utf8');
  assert.deepEqual(current.preference_ranking,rank(D));assert.equal(current.preference_ranking.entries[0].id,'7');
  assert.match(html,/id="riskSnapshotTitle"/);assert.match(html,/id="factorTitle"/);assert.match(html,/fnb-factor-utils.js/);
  assert.match(html,/Mon jugement · 2, 5 et 10 ans/);assert.match(html,/financial-quality-v4-no-construction-gates/);
  delete current.preference_ranking;const financial=structuredClone(D);delete financial.preference_ranking;assert.deepEqual(current,financial);
  command();assert.equal(fs.readFileSync(path.join(stage,'reports/portefeuilles-fnb.html'),'utf8'),html);
 }finally{fs.rmSync(stage,{recursive:true,force:true});}
});
