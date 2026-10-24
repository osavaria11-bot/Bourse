(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./fnb-factor-utils.js'));
  else root.SavyFnbRisk=factory(root.SavyFnbFactors);
})(typeof globalThis!=='undefined'?globalThis:this,function(F){
  'use strict';
  const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
  // Empirical inverse CDF and integrated upper loss tail; the fractional
  // boundary observation makes ES coherent when 5% * sample size is noninteger.
  function losses(returns,confidence=.95){
    if(!Array.isArray(returns)||!returns.length||!returns.every(Number.isFinite)||!Number.isFinite(confidence)||confidence<=0||confidence>=1)return null;
    const values=returns.map(r=>-r).sort((a,b)=>a-b),n=values.length,mass=n*(1-confidence);
    const value=values[Math.ceil(n*confidence)-1];let remaining=mass,total=0;
    for(let i=n-1;i>=0&&remaining>1e-12;i--){const weight=Math.min(1,remaining);total+=weight*values[i];remaining-=weight;}
    return {var:value,cvar:total/mass,confidence,observations:n,tailObservations:mass};
  }
  function contributions(weights,returns,n){
    const entries=Object.entries(weights||{}).filter(([,w])=>w>0);
    if(!entries.length||Math.abs(entries.reduce((s,[,w])=>s+w,0)-1)>1e-6||entries.some(([id])=>!Array.isArray(returns?.[id])||returns[id].length!==n||!returns[id].every(Number.isFinite)))return null;
    const mix=Array.from({length:n},(_,i)=>entries.reduce((s,[id,w])=>s+w*returns[id][i],0)),mu=mean(mix);
    const variance=mix.reduce((s,v)=>s+(v-mu)**2,0);
    if(variance<1e-16)return null;
    return entries.map(([id,weight])=>{const m=mean(returns[id]),cross=mix.reduce((s,v,i)=>s+(v-mu)*(returns[id][i]-m),0);return {id,weight,share:weight*cross/variance};}).sort((a,b)=>b.share-a.share);
  }
  function compare(D,id,reference){
    const p=D?.results?.[id],b=D?.results?.[reference],n=D?.dates?.length;
    if(!p||!b||n<36||p.monthly?.length!==n||b.monthly?.length!==n||!p.monthly.every(Number.isFinite)||!b.monthly.every(Number.isFinite))return {available:false,reason:'Au moins 36 mois communs complets sont requis.'};
    const a=losses(p.monthly),benchmark=losses(b.monthly),f=F?.compare(D,id,'VEQT');
    const market=f?.available?f.factors.find(x=>x.id==='market').portfolio:null;
    const matched=JSON.stringify(D.universe?.dates)===JSON.stringify(D.dates);
    const all=matched?contributions(p.weights,D.universe?.returns,n):null;
    const top=all?.slice(0,4)||[],other=all?1-top.reduce((s,v)=>s+v.share,0):null;
    return {available:true,...a,benchmarkVar:benchmark.var,relativeVar:benchmark.var>1e-12?a.var/benchmark.var:null,
      stress:market===null?null:market*-.20,stressShock:-.20,stressBeta:market,
      contributions:all,top,other,start:D.dates[0],end:D.dates.at(-1),reference};
  }
  return {losses,contributions,compare};
});
