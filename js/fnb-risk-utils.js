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
  function dailyMeasure(D,id,snapshot){
    const row=snapshot?.results?.[id];
    if(!row||snapshot.horizon_sessions!==1||snapshot.confidence!==.95||snapshot.observations<252||!Number.isFinite(row.var95))return {available:false,reason:'Historique quotidien complet indisponible.'};
    const current=D?.results?.[id]?.weights||{},saved=row.weights||{},keys=Object.keys(current);
    if(keys.length!==Object.keys(saved).length||keys.some(t=>!Number.isFinite(saved[t])||Math.abs(current[t]-saved[t])>1e-10))return {available:false,reason:'Actualisation des poids quotidiens en attente.'};
    return {available:true,var:row.var95,skewness:row.skewness??null,excessKurtosis:row.excess_kurtosis??null,start:snapshot.sample_start,end:snapshot.sample_end,observations:snapshot.observations,status:snapshot.status,error:snapshot.error};
  }
  function maximumDrawdown(returns) {
    if(!Array.isArray(returns)||!returns.length||!returns.every(r=>Number.isFinite(r)&&r>=-1))return null;
    let wealth=1,peak=1,worst=0,peakIndex=-1,start=-1,end=-1;
    returns.forEach((r,i)=>{wealth*=1+r;if(wealth>peak){peak=wealth;peakIndex=i;}const d=wealth/peak-1;if(d<worst){worst=d;start=peakIndex;end=i;}});
    return {value:worst,startIndex:start,endIndex:end};
  }
  function downsideCapture(p,b) {
    if(!Array.isArray(p)||p.length!==b?.length||!p.every(r=>Number.isFinite(r)&&r>=-1)||!b.every(r=>Number.isFinite(r)&&r>=-1))return null;
    const indices=b.flatMap((r,i)=>r<0?[i]:[]),n=indices.length;
    const compound=x=>indices.reduce((v,i)=>v*(1+x[i]),1)-1,pr=compound(p),br=compound(b);
    return {ratio:n>=3&&br<0?pr/br:null,portfolio:pr,benchmark:br,observations:n,fragile:n<12,
      interpretation:n<3?'Échantillon baissier insuffisant':pr>=0?'Gain du portefeuille pendant les mois baissiers du benchmark':pr>br?'Pertes cumulées plus faibles que le benchmark':'Pertes cumulées au moins aussi fortes que le benchmark'};
  }
  function compoundBlocks(returns,indices,horizon=21,offset=null) {
    if(!Array.isArray(returns)||returns.length!==indices?.length||!returns.every(Number.isFinite))return [];
    // End-align the disjoint sample so every refresh includes the newest close.
    if(offset===null)offset=returns.length%horizon;
    const values=[];
    for(let i=offset;i+horizon<=returns.length;i+=horizon){
      if(indices[i+horizon-1]-indices[i]!==horizon-1)continue;
      values.push(returns.slice(i,i+horizon).reduce((v,r)=>v*(1+r),1)-1);
    }
    return values;
  }
  function effectiveObservations(x) {
    const n=x.length,m=mean(x),v=x.reduce((s,t)=>s+(t-m)**2,0);if(v<1e-20)return n;
    let sum=0;
    // Initial positive sequence of autocorrelation pairs; conservative cap n.
    for(let k=1;k+1<Math.min(n/2,12);k+=2){
      const rho=lag=>x.slice(lag).reduce((s,t,i)=>s+(t-m)*(x[i]-m),0)/v;
      const pair=rho(k)+rho(k+1);if(pair<=0)break;sum+=pair;
    }
    return Math.max(1,Math.min(n,n/(1+2*sum)));
  }
  function bootstrapTail(values,replications=400,blockLength=3) {
    if(values.length<24)return null;
    let state=734819;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
    const estimates=[];
    for(let k=0;k<replications;k++){
      const sample=[];while(sample.length<values.length){const start=Math.floor(random()*values.length);for(let j=0;j<blockLength&&sample.length<values.length;j++)sample.push(values[(start+j)%values.length]);}
      estimates.push(losses(sample));
    }
    const interval=key=>{const sorted=estimates.map(x=>x[key]).sort((a,b)=>a-b);return [sorted[Math.floor(.025*replications)],sorted[Math.ceil(.975*replications)-1]];};
    return {var:interval('var'),cvar:interval('cvar'),replications,blockLength,method:'Bootstrap circulaire par blocs de 3 périodes non chevauchantes de 21 séances; intervalle percentile 95 %, conditionnel à cet historique.'};
  }
  function backtest(returns,indices,horizon=1) {
    const training=horizon===1?252:504,records=[];
    for(let i=training;i+horizon<=returns.length;i+=horizon){
      if(indices[i+horizon-1]-indices[i]!==horizon-1)continue;
      const sample=horizon===1?returns.slice(i-training,i):compoundBlocks(returns.slice(i-training,i),indices.slice(i-training,i),horizon);
      if(sample.length<(horizon===1?252:24))continue;
      const forecast=losses(sample),realized=returns.slice(i,i+horizon).reduce((v,r)=>v*(1+r),1)-1;
      records.push({index:i,var:forecast.var,loss:-realized,exceeded:-realized>forecast.var});
    }
    return {horizon,observations:records.length,exceptions:records.filter(x=>x.exceeded).length,expected:records.length*.05,
      rate:records.length?records.filter(x=>x.exceeded).length/records.length:null,fragile:records.length<(horizon===1?250:24),records,
      note:'Rejeu chronologique, données strictement antérieures à la prévision; poids actuels connus après coup. Ce test du modèle ne constitue pas un suivi réel hors sélection.'};
  }
  function jointSeries(D,id,reference,snapshot) {
    const s=snapshot?.daily_series,p=D.results?.[id],b=D.results?.[reference];
    if(!s||s.currency!=='CAD'||s.total_return!==true||!Array.isArray(s.dates)||s.dates.length!==s.session_indices?.length||
       !dailyMeasure(D,id,snapshot).available||!dailyMeasure(D,reference,snapshot).available)return null;
    if(s.dates.length!==snapshot.observations||new Set(s.dates).size!==s.dates.length||s.dates.some((d,i)=>i&&d<=s.dates[i-1]))return null;
    const n=s.dates.length,tickers=[...new Set([...Object.keys(p.weights),...Object.keys(b.weights)])];
    if(tickers.some(t=>s.returns?.[t]?.length!==n||!s.returns[t].every(Number.isFinite))||s.session_indices.some((v,i)=>!Number.isInteger(v)||(i&&v<=s.session_indices[i-1])))return null;
    const mix=weights=>s.dates.map((_,i)=>Object.entries(weights).reduce((v,[t,w])=>v+w*s.returns[t][i],0));
    return {p:mix(p.weights),b:mix(b.weights),...s};
  }
  function activeContributions(pw,bw,returns,n) {
    const ids=[...new Set([...Object.keys(pw),...Object.keys(bw)])];
    if(ids.some(t=>returns?.[t]?.length!==n||!returns[t].every(Number.isFinite)))return null;
    const weights=Object.fromEntries(ids.map(t=>[t,(pw[t]||0)-(bw[t]||0)]));
    const active=Array.from({length:n},(_,i)=>ids.reduce((s,t)=>s+weights[t]*returns[t][i],0)),am=mean(active),variance=active.reduce((s,v)=>s+(v-am)**2,0);
    if(variance<1e-16)return null;
    return ids.map(id=>{const m=mean(returns[id]);return {id,activeWeight:weights[id],share:weights[id]*active.reduce((s,v,i)=>s+(v-am)*(returns[id][i]-m),0)/variance};}).sort((a,b)=>b.share-a.share);
  }
  const memo=new WeakMap();
  function compare(D,id,reference,snapshot=null){
    let cache=memo.get(D);if(cache?.snapshot!==snapshot){cache={snapshot,results:new Map()};memo.set(D,cache);}const key=id+'|'+reference;if(cache.results.has(key))return cache.results.get(key);
    const p=D?.results?.[id],b=D?.results?.[reference],n=D?.dates?.length;
    if(!p||!b||n<2||p.monthly?.length!==n||b.monthly?.length!==n||!p.monthly.every(Number.isFinite)||!b.monthly.every(Number.isFinite))return {available:false,reason:'Périodes communes complètes indisponibles.'};
    const joint=jointSeries(D,id,reference,snapshot),daily=dailyMeasure(D,id,snapshot),blocks=joint?compoundBlocks(joint.p,joint.session_indices):[],bb=joint?compoundBlocks(joint.b,joint.session_indices):[];
    const a=blocks.length>=24?losses(blocks):null,benchmark=a?losses(bb):null;
    const matched=JSON.stringify(D.universe?.dates)===JSON.stringify(D.dates);
    const all=joint?contributions(p.weights,joint.returns,joint.dates.length):matched?contributions(p.weights,D.universe?.returns,n):null;
    const active=joint?activeContributions(p.weights,b.weights,joint.returns,joint.dates.length):matched?activeContributions(p.weights,b.weights,D.universe?.returns,n):null;
    const top=all?.slice(0,4)||[],other=all?1-top.reduce((s,v)=>s+v.share,0):null;
    const contiguous=joint&&joint.session_indices.at(-1)-joint.session_indices[0]===joint.dates.length-1;
    const dp=contiguous?joint.p:p.monthly,db=contiguous?joint.b:b.monthly;
    const offsets=a?Array.from({length:21},(_,i)=>losses(compoundBlocks(joint.p,joint.session_indices,21,i))).filter(Boolean):[];
    const effective=a?effectiveObservations(blocks):0;
    const result={available:true,var:a?.var??null,cvar:a?.cvar??null,confidence:.95,horizonSessions:21,monthlyStart:joint&&blocks.length?joint.dates[joint.dates.length%21]:null,monthlyEnd:joint&&blocks.length?joint.dates.at(-1):null,observations:blocks.length,tailObservations:a?.tailObservations??0,effectiveObservations:effective,
      benchmarkVar:benchmark?.var??null,relativeVar:benchmark?.var>1e-12?a.var/benchmark.var:null,interval:a?bootstrapTail(blocks):null,
      stability:offsets.length?{minimum:Math.min(...offsets.map(x=>x.var)),maximum:Math.max(...offsets.map(x=>x.var)),note:'Sensibilité au décalage de début des blocs; échantillons dépendants, jamais additionnés.'}:null,
      coherence:a?{cvarAboveVar:a.cvar>=a.var-1e-12,monthlyAboveDaily:a.var>=daily.var,note:'La VaR ne croît pas nécessairement avec l’horizon pour toute distribution; aucune règle racine de 21 imposée.'}:null,
      backtesting:joint?{daily:backtest(joint.p,joint.session_indices),monthly:backtest(joint.p,joint.session_indices,21)}:null,
      fragile:effective*.05<10,reason:a?null:'Au moins 24 blocs complets non chevauchants de 21 séances requis.',
      drawdown:{portfolio:maximumDrawdown(dp),benchmark:maximumDrawdown(db),frequency:contiguous?'quotidienne':'mensuelle',start:contiguous?joint.dates[0]:D.dates[0],end:contiguous?joint.dates.at(-1):D.dates.at(-1),method:contiguous?'Rendements des FNB observés, simulation à poids cibles quotidiens constants':'Simulation du backtest mensuel; creux intramensuels non mesurés'},
      capture:downsideCapture(p.monthly,b.monthly),downside:F.downside(p.monthly,b.monthly),beta:F.beta(p.monthly,b.monthly),
      contributions:all,activeContributions:active,contributionFrequency:joint?'quotidienne':'mensuelle',top,other,start:joint?joint.dates[0]:D.dates[0],end:joint?joint.dates.at(-1):D.dates.at(-1),reference,daily};
    cache.results.set(key,result);return result;
  }
  return {losses,contributions,compare,dailyMeasure,maximumDrawdown,downsideCapture,compoundBlocks,effectiveObservations,bootstrapTail,backtest,jointSeries,activeContributions};
});
