'use strict';
// Reuse the dashboard's actual universe, constraints and forecast calibration.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const U=require('../js/fnb-frontier-utils.js'),F=require('../js/fnb-forecast-utils.js');
function prepare(root=path.resolve(__dirname,'..')){
  const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
  const data=U.extend(read('data/fnb-analysis.json'),read('data/fnb-frontier-universe.json'));
  const ids=data.optimization.eligible_funds;
  data.results=Object.fromEntries(F.BENCHMARKS.map(t=>[t,data.results[t]]));
  for(const t of ids){
    const u=data.universe,eq=u.equity[t];
    // Discard only floating point settlement residuals, never negative assets.
    const asset=k=>{const v=u[k][t];if(!Number.isFinite(v)||v < -1e-12)throw Error('Invalid asset mix: '+t);return Math.max(0,v);};
    data.results['fund:'+t]={weights:{[t]:1},mer:u.mer[t],geo_total:[...u.geo[t].map(v=>v*eq),...['gold','crypto','bond','cash'].map(asset)]};
  }
  const stress=read('data/fnb-stress-history.json'),macro=read('data/macro-data.json');
  const prepared=F.prepare(data,stress,macro),planning=F.prepare(data,stress,macro,{returnBasis:'planning'});
  if(!prepared.available||!planning.available)throw Error(prepared.reason||planning.reason);
  const indices=ids.map(t=>prepared.rows.findIndex(r=>r.id==='fund:'+t));
  if(indices.some(i=>i<0))throw Error('Unavailable source: '+JSON.stringify(prepared.unavailable));
  const sourceFiles=['data/fnb-analysis.json','data/fnb-frontier-universe.json','data/fnb-stress-history.json','data/macro-data.json','data/fnb-model.json','js/fnb-forecast-utils.js'];
  const limits=U.limitsFor(data,ids,.5),styles=['FINN','FCMO','VMO','XMI'];
  const norm=Math.sqrt(styles.filter(t=>ids.includes(t)).length);
  limits.innovationMomentumCap=.30;limits.innovationMomentumIds=styles;
  limits.rows.push(ids.map(t=>styles.includes(t)?1/norm:0));
  limits.bounds.push(.30/norm);limits.labels.push('innovation + momentum maximum');
  return {version:1,modelVersion:F.VERSION,ids,indices,reference:prepared.rows.findIndex(r=>r.id==='VFV'),
    limits,prepared,planning,minWeight:.02,maxFunds:8,
    names:Object.fromEntries(ids.map(t=>[t,data.fund_labels[t].name])),
    sourceDates:Object.fromEntries(ids.map(t=>[t,data.source_dates[t]])),
    sourceUrls:Object.fromEntries(ids.map(t=>[t,data.source_urls[t]])),
    sourceHashes:Object.fromEntries(sourceFiles.map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex')]))};
}
if(require.main===module)process.stdout.write(JSON.stringify(prepare(process.argv[2]))+'\n');
module.exports=prepare;
