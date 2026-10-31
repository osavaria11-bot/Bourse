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
  if(!["FEQT","VEQT","VGRO","VBAL",...(data.benchmarks||[])].every(id=>data.accounts.some(a=>a.id===id&&a.kind==='benchmark')))throw Error("Benchmarks manquants");return data;
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
 const calendars=new Map(),dayString=d=>d.toISOString().slice(0,10),shift=(day,n)=>new Date(Date.parse(day+'T12:00:00Z')+n*86400000);
 function tradingDay(day){
  const d=shift(day,0),y=d.getUTCFullYear();if([0,6].includes(d.getUTCDay()))return false;
  if(!calendars.has(y)){
   const holidays=new Set(),nthMonday=(m,n)=>{const first=new Date(Date.UTC(y,m-1,1,12));return new Date(Date.UTC(y,m-1,1+(8-first.getUTCDay())%7+7*(n-1),12));};
   const a=y%19,b=Math.floor(y/100),c=y%100,dd=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-dd-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),v=h+l-7*m+114;
   const easter=new Date(Date.UTC(y,Math.floor(v/31)-1,v%31+1,12));
   for(const date of [nthMonday(2,3),shift(dayString(easter),-2),nthMonday(8,1),nthMonday(9,1),nthMonday(10,2)])holidays.add(dayString(date));
   const victoria=new Date(Date.UTC(y,4,24,12));holidays.add(dayString(shift(dayString(victoria),-(victoria.getUTCDay()+6)%7)));
   for(const [month,date] of [[0,1],[6,1],[11,25],[11,26]]){let observed=new Date(Date.UTC(y,month,date,12));while([0,6].includes(observed.getUTCDay())||holidays.has(dayString(observed)))observed=shift(dayString(observed),1);holidays.add(dayString(observed));}
   calendars.set(y,holidays);
  }
  return !calendars.get(y).has(day);
 }
 function expectedSession(now=new Date()){
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
  let day=p.year+'-'+p.month+'-'+p.day;if(Number(p.hour)*60+Number(p.minute)<16*60+15)day=dayString(shift(day,-1));
  while(!tradingDay(day))day=dayString(shift(day,-1));return day;
 }
 function freshness(data,status,now=new Date()){
  const expected=expectedSession(now),stale=data.as_of<expected,incomplete=data.accounts.some(a=>!a.history.length);
  const current=!stale&&!incomplete&&status?.status==='current'&&status.as_of===data.as_of&&status.expected_session===expected;
  return{expected,stale,incomplete,current};
 }
 return{validate,validateComparison,metrics,rebase,gap,ranking,monthBefore,tradingDay,expectedSession,freshness};
})();
if(typeof module==="object"&&module.exports)module.exports=SavyPerformanceUtils;

