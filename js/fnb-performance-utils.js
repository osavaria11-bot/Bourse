"use strict";
const SavyPerformanceUtils=(()=>{
 const finite=x=>typeof x==="number"&&Number.isFinite(x)&&x>0;
 function validate(data){
  if(data.schema_version!==1||data.currency!=="CAD"||data.capital!==10000||!Array.isArray(data.accounts))throw Error("Format de suivi invalide");
  const ids=new Set();
  for(const a of data.accounts){
   if(ids.has(a.id)||a.currency!=="CAD"||a.capital!==10000||!Array.isArray(a.history)||Math.abs(Object.values(a.weights).reduce((s,w)=>s+w,0)-1)>1e-8)throw Error("Compte invalide");ids.add(a.id);
   let last="";for(const h of a.history){if(!/^\d{4}-\d{2}-\d{2}$/.test(h.date)||h.date<=last||!finite(h.value)||h.date<a.launch_date||h.date>data.as_of)throw Error("Historique invalide");last=h.date;}
   if(a.history.length&&(a.history[0].date!==a.launch_date||Math.abs(a.history[0].value-a.capital)>.001||last!==data.as_of))throw Error("Lancement ou clôture invalide");
  }
  if(!["FEQT","VEQT","VGRO","VBAL"].every(id=>ids.has(id)))throw Error("Benchmarks manquants");return data;
 }
 function period(history,target){const end=history.at(-1),base=history.findLast(p=>p.date<=target);return end&&base?end.value/base.value-1:null;}
 function monthBefore(day){const d=new Date(day+"T12:00:00Z"),last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),0)).getUTCDate();return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()-1,Math.min(d.getUTCDate(),last),12)).toISOString().slice(0,10);}
 function metrics(history,capital=10000){
  const end=history.at(-1);if(!end)return{value:null,gain:null,total:null,day:null,week:null,month:null};
  const week=new Date(Date.parse(end.date+"T12:00:00Z")-7*86400000).toISOString().slice(0,10);
  return{value:end.value,gain:end.value-capital,total:end.value/capital-1,day:history.length>1?end.value/history.at(-2).value-1:null,week:period(history,week),month:period(history,monthBefore(end.date))};
 }
 function rebase(account,start){const base=account.history.find(h=>h.date===start);return base?account.history.filter(h=>h.date>=start).map(h=>({date:h.date,value:h.value/base.value*account.capital})):[];}
 function gap(account,benchmark){
  const latest=account.history.at(-1),first=benchmark.history.find(h=>h.date===account.launch_date),end=benchmark.history.find(h=>h.date===latest?.date);
  return latest&&first&&end?latest.value/account.capital-end.value/first.value:null;
 }
 function ranking(accounts){
  const ranks=new Map(),groups=new Map();for(const a of accounts.filter(a=>a.kind!=="benchmark"&&a.history.length)){const list=groups.get(a.launch_date)||[];list.push(a);groups.set(a.launch_date,list);}
  for(const list of groups.values()){list.sort((a,b)=>metrics(b.history).total-metrics(a.history).total||a.id.localeCompare(b.id));let prev=null,rank=0;list.forEach((a,i)=>{const total=metrics(a.history).total;if(prev===null||Math.abs(total-prev)>1e-9)rank=i+1;ranks.set(a.id,rank);prev=total;});}return ranks;
 }
 function validateComparison(data){
  validate(data);
  if(data.model!=='common_start_buy_hold_v1'||data.inception!=='2026-10-19')throw Error('Départ commun invalide');
  const expected=data.accounts.find(a=>a.id==='VEQT').history.map(h=>h.date).join(',');
  for(const a of data.accounts){
   if(a.launch_date!==data.inception||!a.actual_launch_date||!['simulation','recorded_from_common_start'].includes(a.series_type))throw Error('Comparaison désalignée');
   if(a.history.length&&a.history.map(h=>h.date).join(',')!==expected)throw Error('Séances communes incompatibles');
   if(a.actual_launch_date>data.inception&&a.series_type!=='simulation')throw Error('Simulation non signalée');
   if(!a.history.length&&!a.unavailable_reason)throw Error('Historique absent non signalé');
  }
  return data;
 }
 return{validate,validateComparison,metrics,rebase,gap,ranking,monthBefore};
})();
if(typeof module==="object"&&module.exports)module.exports=SavyPerformanceUtils;
