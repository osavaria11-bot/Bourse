"use strict";
// Project the authorized simulation state into public NAVs only. Never publish the state itself.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const W=require("../js/weekly-reports-utils.js");
if(!process.argv[2])throw Error("Usage: node scripts/build_research_performance.cjs /absolute/path/to/current-state.json");
const state=JSON.parse(fs.readFileSync(process.argv[2],"utf8")),root=path.resolve(__dirname,".."),dest=path.join(root,"data/research-performance.json");
const near=(a,b,label)=>assert.ok(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<1e-6,label);
assert.equal(state.initial,10000);assert.equal(state.currency,"USD");
const source={top5:state.values.top5,others:state.values.others,spy:state.benchmark};
for(const [id,series] of Object.entries(source)){
 assert.equal(series.length,state.dates.length);
 series.forEach((row,i)=>{
  assert.equal(row.date,state.dates[i]);near(row.return_since_start,row.nav/state.initial-1,"Cumulative "+id);
  if(row.daily_return!==undefined)near(row.daily_return,i?row.nav/series[i-1].nav-1:0,"Daily "+id);
 });
}
const asOf=state.asof.slice(0,10);assert.equal(asOf,state.dates.at(-1));
const price=t=>{const q=state.prices[t]?.[asOf];return typeof q==="number"?q:q?.close;};
for(const id of ["top5","others"]){
 const nav=Object.entries(state.positions[id]).reduce((sum,[ticker,quantity])=>sum+quantity*price(ticker),state.cash[id]);
 near(nav,source[id].at(-1).nav,"Positions + cash "+id);
}
near(state.benchmark_position.quantity*price("SPY")+(state.benchmark_position.cash||0),source.spy.at(-1).nav,"SPY buy and hold");
for(const trade of state.trades){
 near(trade.notional,trade.quantity*trade.price,"Trade notional");
 if(trade.execution_at&&trade.report_date!==state.dates[0]){
  const report=state.editions.find(e=>e.report_date===trade.report_date);
  assert.ok(report&&Date.parse(report.published_at)<Date.parse(trade.execution_at),"No transaction before report publication");
 }
}
const window=state.reporting_windows.at(-1);assert.equal(window.end,asOf);
const payload=W.normalizePerformance({schema_version:1,kind:"savy_finviz_performance",generated_at:new Date().toISOString(),
 initial_capital:10000,currency:"USD",return_basis:"price_return",launch_date:state.dates[0],as_of:asOf,period_start:window.start,
 dates:state.dates,values:Object.fromEntries(Object.entries(source).map(([id,rows])=>[id,rows.map(r=>r.nav)])),
 method_note:"Simulation en USD : 10 000 $ par portefeuille au 30 septembre 2026. Série de cours hors dividendes, sans frais ni impôts. Historique reconstitué jusqu’au 8 octobre; suivi enregistré ensuite. Les nouvelles pondérations s’appliquent après la clôture d’exécution, jamais à la période passée. Rééquilibrages du jeudi; valeurs actualisées lors de la livraison hebdomadaire, pas en intraday. Les clôtures et dates ci-dessus sont celles du dernier relevé enregistré, pas celles de la consultation."});
for(const row of W.performanceRows(payload)){
 const recorded=window.values[row.id];near(recorded.period_return,row.period,"Period "+row.id);near(recorded.cumulative_return,row.total,"Total "+row.id);
 if(row.id!=="spy"){near(recorded.gap_spy_period,row.gap_period,"Period SPY gap");near(recorded.gap_spy_cumulative,row.gap_total,"Total SPY gap");}
}
if(fs.existsSync(dest))W.continuePerformance(W.normalizePerformance(JSON.parse(fs.readFileSync(dest,"utf8"))),payload);
fs.writeFileSync(dest,JSON.stringify(payload,null,2)+"\n");
console.log("Verified public Finviz NAVs:",asOf,"·",state.dates.length,"dates ·",state.trades.length,"transactions checked; source state unchanged.");
