"use strict";
// Keep a reproducible, immutable monthly record of the browser's three profiles.
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const U=require("../js/fnb-frontier-utils.js");
const ROOT=path.resolve(__dirname,".."),PROFILE_IDS=["sharpe","information","compromise"];
const read=file=>JSON.parse(fs.readFileSync(file,"utf8"));
const digest=value=>crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const near=(a,b)=>a===null?b===null:typeof a==="number"&&Number.isFinite(a)&&Math.abs(a-b)<1e-8;
const metricKeys=["mean","vol","variance","tracking","excess","sharpe","information","cagr"];
function inputsFor(data){
 const p=U.prepare(data,{cap:.35,sample:"split"}),ids=p.ids;
 return {ids,dates:data.dates,as_of:p.asOf,risk_free:p.riskFree,cap:p.cap,limits:p.limits,seed:p.feasible,
  returns:Object.fromEntries([...ids,"VEQT"].map(id=>[id,data.universe.returns[id]]))};
}
function prepare(inputs,sample){
 const {ids,dates,returns,risk_free:rf}=inputs,split=sample==="split"&&dates.length>=36?dates.length-12:dates.length;
 const fit=U.moments(ids.map(id=>returns[id].slice(0,split)),returns.VEQT.slice(0,split),rf);
 const validation=split<dates.length?U.moments(ids.map(id=>returns[id].slice(split)),returns.VEQT.slice(split),rf):null;
 return {ids,cap:inputs.cap,limits:inputs.limits,feasible:inputs.seed,fit,validation,dates:{fit:dates.slice(0,split),validation:dates.slice(split)}};
}
function evaluate(p,weights){
 return {calibration:U.metrics(p.fit,weights),validation:p.validation?U.metrics(p.validation,weights):null,exposures:U.exposures(p,weights)};
}
function difference(a,b){
 return a&&b?Object.fromEntries(metricKeys.map(k=>[k,typeof a[k]==="number"&&typeof b[k]==="number"?a[k]-b[k]:null])):null;
}
function compareProfile(p,current,previous){
 const ids=[...new Set([...p.ids,...Object.keys(previous.weights)])].sort();
 const changes=ids.map(id=>({ticker:id,previous:previous.weights[id]||0,current:current.weights[id]||0,
  change:(current.weights[id]||0)-(previous.weights[id]||0)})).sort((a,b)=>Math.abs(b.change)-Math.abs(a.change)||a.ticker.localeCompare(b.ticker));
 const unavailable=ids.filter(id=>(previous.weights[id]||0)>1e-8&&!p.ids.includes(id));
 const old=unavailable.length?null:evaluate(p,p.ids.map(id=>previous.weights[id]||0));
 return {changes,entries:changes.filter(x=>x.previous<=1e-6&&x.current>1e-6).map(x=>x.ticker),
  exits:changes.filter(x=>x.previous>1e-6&&x.current<=1e-6).map(x=>x.ticker),
  one_way_turnover:changes.reduce((s,x)=>s+Math.abs(x.change),0)/2,
  previous_published:{calibration:previous.calibration,validation:previous.validation},
  previous_weights_on_current_window:old,
  strategy_change_on_current_window:old?{calibration:difference(current.calibration,old.calibration),validation:difference(current.validation,old.validation)}:null,
  unavailable_previous_funds:unavailable};
}
function build(data,{generatedAt=new Date().toISOString(),previous=null}={}){
 const inputs=inputsFor(data),month=data.optimization.month;
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error("Invalid publication month");
 const [year,m]=month.split("-").map(Number),cutoff=new Date(Date.UTC(year,m-1,0)).toISOString().slice(0,7);
 if(inputs.dates.at(-1)!==cutoff)throw Error("The frontier must cover the last completed month");
 if(previous&&previous.month>=month)throw Error("Previous frontier must precede this month");
 const L=inputs.limits,policy={version:1,benchmark:"VEQT",currency:"CAD",periods_per_year:12,
  returns:"Total returns, constant target weights each month",covariance:"Sample covariance",risk_free:"Constant comparison rate",
  compromise_priority:.5,validation_months:12,general_cap:.35,
  fund_caps:Object.fromEntries(inputs.ids.map((id,i)=>[id,L.caps[i]])),crypto_cap:L.cryptoCap,
  geo_tolerance:L.geoTolerance,sector_tolerance:L.sectorTolerance,sector_cap:L.sectorCap,unknown_geography_cap:L.unknownCap,
  region_minimum:[.30,.15,.15,.05],region_maximum:[.60,.40,.40,.20]};
 const record={schema_version:1,kind:"fnb_frontier_monthly",month,generated_at:generatedAt,as_of:inputs.as_of,
  source_month:cutoff,input_digest:digest(inputs),inputs,policy,
  risk_free_source:data.optimization.risk_free,samples:{},comparison:previous?{
   previous_month:previous.month,method_changes:JSON.stringify(previous.policy)===JSON.stringify(policy)?[]:["Policy or eligible universe changed; inspect both policies"],
   added_months:inputs.dates.filter(d=>!previous.inputs.dates.includes(d)),risk_free_change:inputs.risk_free-previous.inputs.risk_free
  }:null,
  note:"Historical optimization, not an executed rebalance. The first record is a baseline. The compromise is selected from sampled nondominated candidates; it is not an exhaustive joint optimum."};
 for(const sample of ["split","all"]){
  const p=prepare(inputs,sample),solution=U.solve(p),compromise=U.compromise(solution.candidates,.5);
  if(!solution.sharpe||!solution.information||!compromise)throw Error("A positive-ratio profile is unavailable; no partial monthly record");
  if(solution.candidates.some(point=>!U.feasible(point.weights,p.limits)))throw Error("Infeasible frontier candidate");
  const profiles={};
  for(const [id,point] of Object.entries({sharpe:solution.sharpe,information:solution.information,compromise})){
   const current={weights:Object.fromEntries(p.ids.map((ticker,i)=>[ticker,point.weights[i]])),...evaluate(p,point.weights)};
   const old=previous?.samples[sample]?.profiles[id];
   if(old)current.comparison=compareProfile(p,current,old);
   profiles[id]=current;
  }
  record.samples[sample]={dates:p.dates,benchmark:{calibration:p.fit.reference,validation:p.validation?.reference??null},profiles,
   audit:{absolute_points:solution.absolute.length,active_points:solution.active.length,checked_candidates:solution.candidates.length,max_solver_gap:solution.maxSolverGap}};
 }
 validate(record,previous);return record;
}
function validate(record,previous=null){
 if(record.schema_version!==1||record.kind!=="fnb_frontier_monthly"||record.input_digest!==digest(record.inputs))throw Error("Invalid frontier archive or inputs digest");
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(record.month)||!Number.isFinite(Date.parse(record.generated_at)))throw Error("Invalid frontier publication date");
 if(record.source_month!==record.inputs.dates.at(-1)||record.as_of!==record.inputs.as_of)throw Error("Inconsistent frontier dates");
 if(previous&&record.comparison?.previous_month!==previous.month)throw Error("Missing link to previous monthly frontier");
 for(const sample of ["split","all"]){
  const p=prepare(record.inputs,sample),saved=record.samples[sample];
  if(JSON.stringify(p.dates)!==JSON.stringify(saved.dates))throw Error("Inconsistent calibration and validation windows");
  if(saved.audit.max_solver_gap>1e-7||saved.audit.absolute_points!==61||saved.audit.active_points!==61)throw Error("Uncertified frontier solve");
  for(const id of PROFILE_IDS){
   const profile=saved.profiles[id],w=p.ids.map(t=>profile.weights[t]);
   if(Object.keys(profile.weights).length!==p.ids.length||!U.feasible(w,p.limits))throw Error("Invalid archived portfolio weights");
   const actual=evaluate(p,w);
   for(const window of ["calibration","validation"]){
    if((actual[window]===null)!==(profile[window]===null))throw Error("Missing validation metrics");
    if(actual[window]&&metricKeys.some(k=>!near(profile[window][k],actual[window][k])))throw Error("Archived ratio disagrees with monthly returns");
   }
   if(JSON.stringify(profile.exposures)!==JSON.stringify(actual.exposures))throw Error("Archived exposures disagree with weights");
   if(previous&&JSON.stringify(profile.comparison)!==JSON.stringify(compareProfile(p,profile,previous.samples[sample].profiles[id])))throw Error("Monthly changes disagree with previous archive");
  }
 }
 return record;
}
function publish(root,record){
 validate(record);
 const folder=path.join(root,"data/fnb-frontier-history"),file=path.join(folder,record.month+".json");
 const months=fs.existsSync(folder)?fs.readdirSync(folder).filter(name=>/^\d{4}-\d{2}\.json$/.test(name)).sort():[];
 if(fs.existsSync(file)){
  if(fs.readFileSync(file,"utf8")!==JSON.stringify(record)+"\n")throw Error("Refusing to overwrite an immutable frontier archive");
 }else months.push(record.month+".json");
 months.sort();
 let previous=null;
 const entries=months.map(name=>{const r=validate(name===record.month+".json"?record:read(path.join(folder,name)),previous);previous=r;return {month:r.month,as_of:r.as_of,path:"data/fnb-frontier-history/"+name,generated_at:r.generated_at,input_digest:r.input_digest};});
 const latestRecord=previous,index={schema_version:1,kind:"fnb_frontier_history",latest_month:latestRecord.month,months:entries};
 // Complete every financial and historical check before writing any new archive.
 fs.mkdirSync(folder,{recursive:true});
 if(!fs.existsSync(file))fs.writeFileSync(file,JSON.stringify(record)+"\n",{flag:"wx"});
 for(const [target,value] of [["data/fnb-frontier-monthly.json",latestRecord],["data/fnb-frontier-history/index.json",index]]){
  const dest=path.join(root,target),temp=dest+".tmp";
  fs.writeFileSync(temp,JSON.stringify(value)+"\n");fs.renameSync(temp,dest);
 }
 return latestRecord;
}
function main(argv=process.argv.slice(2)){
 const rootArg=argv.indexOf("--root"),root=rootArg>=0?path.resolve(argv[rootArg+1]):ROOT;
 const base=read(path.join(root,"data/fnb-analysis.json")),extra=read(path.join(root,"data/fnb-frontier-universe.json"));
 const folder=path.join(root,"data/fnb-frontier-history"),month=base.optimization.month,file=path.join(folder,month+".json");
 if(argv.includes("--check")){
  const index=read(path.join(folder,"index.json")),latest=validate(read(path.join(root,"data/fnb-frontier-monthly.json")));
  const months=fs.readdirSync(folder).filter(name=>/^\d{4}-\d{2}\.json$/.test(name)).sort();
  let previous=null;
  const actual=months.map(name=>{const r=validate(read(path.join(folder,name)),previous);previous=r;return {month:r.month,as_of:r.as_of,path:"data/fnb-frontier-history/"+name,generated_at:r.generated_at,input_digest:r.input_digest};});
  if(JSON.stringify(actual)!==JSON.stringify(index.months)||index.latest_month!==latest.month||latest.month!==months.at(-1).slice(0,7)||JSON.stringify(latest)!==JSON.stringify(read(path.join(folder,latest.month+".json"))))throw Error("Frontier history index or current copy disagrees with archives");
  if(latest.month===month&&extra.as_of===base.assumptions.as_of){
   if(latest.input_digest!==digest(inputsFor(U.extend(base,extra))))throw Error("Current frontier inputs changed after the monthly archive");
  }
  console.log("Validated monthly frontier archives:",months.length,"; latest",latest.month,"; research month",month);return latest;
 }
 const data=U.extend(base,extra),inputs=inputsFor(data);
 if(fs.existsSync(file)){
  const record=validate(read(file));
  if(record.input_digest!==digest(inputs))throw Error("Current inputs differ from the published month; keep the archive and review the change explicitly");
  publish(root,record);console.log("Monthly frontier already archived; retained:",month);return record;
 }
 const previousFiles=fs.existsSync(folder)?fs.readdirSync(folder).filter(name=>/^\d{4}-\d{2}\.json$/.test(name)&&name.slice(0,7)<month).sort():[];
 const previous=previousFiles.length?validate(read(path.join(folder,previousFiles.at(-1)))):null;
 const record=build(data,{previous});publish(root,record);
 console.log("Archived monthly frontier:",month,";",inputs.ids.length,"funds; split and full-history profiles.");return record;
}
module.exports={inputsFor,prepare,build,validate,publish,compareProfile,main};
if(require.main===module)main();
