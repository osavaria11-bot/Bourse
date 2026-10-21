"use strict";
// One rule for every equity-growth candidate. Names and selection families
// never enter the score; the two mixed mandates keep their separate purpose.
const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
const sd=a=>{const m=mean(a);return Math.sqrt(a.reduce((s,v)=>s+(v-m)**2,0)/(a.length-1));};
const total=a=>a.reduce((s,v)=>s*(1+v),1)-1;
function period(p,b,rf,dates){
 if(p.length<2||p.length!==b.length||p.some(v=>!Number.isFinite(v)||v<=-1)||b.some(v=>!Number.isFinite(v)||v<=-1))throw Error('Périodes de classement incompatibles');
 const vol=sd(p)*Math.sqrt(12),active=p.map((v,i)=>v-b[i]),te=sd(active)*Math.sqrt(12);
 return {start:dates[0],end:dates.at(-1),months:p.length,total_return:total(p),benchmark_return:total(b),gap:total(p)-total(b),sharpe:vol>1e-12?(mean(p)*12-rf)/vol:null,information:te>1e-12?mean(active)*12/te:null};
}
function limits(q,D){
 const flags=[],caps={FEQT:.50,'CGL.C':.05,XIT:.10,ZEB:.10,ZEO:.05,FINN:.15},eps=1e-8;
 for(const [t,w] of Object.entries(q.weights))if(w>(caps[t]??.35)+eps)flags.push(t+' au-dessus du plafond par fonds');
 if(q.weights.VEQT||q.weights.XEQT)flags.push('Benchmark détenu dans l’allocation');
 if(q.crypto>.03+eps)flags.push('Crypto au-dessus de 3 %');
 const g=q.geo_equity,lo=[.30,.15,.15,.05],hi=[.60,.40,.40,.20];
 if(g.some((v,i)=>Math.abs(v-D.universe.ref_geo[i])>.10+eps)||g.slice(0,4).some((v,i)=>v<lo[i]-eps||v>hi[i]+eps)||g[4]>.05+eps)flags.push('Limite géographique dépassée');
 if(q.sectors.some((v,i)=>v>.35+eps||Math.abs(v-D.universe.ref_sector[i])>.07+eps))flags.push('Limite sectorielle dépassée');
 return flags;
}
module.exports=function preferences(D){
 const dates=D.dates,n=dates.length,rf=D.assumptions.risk_free,b=D.results.VEQT.monthly;
 if(n<28||b.length!==n)throw Error('Historique commun insuffisant pour le classement');
 const ids=[...(D.robust_order||[]),...(D.proposal_order||[]),...D.custom_order.filter(k=>!['10','11'].includes(k))];
 const entries=ids.map(id=>{
  const q=D.results[id];if(q.monthly.length!==n)throw Error('Historique non aligné : '+id);
  const windows={debut_28:[0,28],derniers_24:[n-24,n],derniers_12:[n-12,n],derniers_6:[n-6,n],derniers_3:[n-3,n]},diagnostics={};
  for(const [key,[a,z]] of Object.entries(windows))diagnostics[key]=period(q.monthly.slice(a,z),b.slice(a,z),rf,dates.slice(a,z));
  const long=[diagnostics.debut_28,diagnostics.derniers_24,diagnostics.derniers_12];
  const worst_information=long.every(r=>r.information!==null)?Math.min(...long.map(r=>r.information)):null;
  const worst_sharpe=long.every(r=>r.sharpe!==null)?Math.min(...long.map(r=>r.sharpe)):null;
  const performance_flags=[];
  if(diagnostics.derniers_12.information===null||diagnostics.derniers_12.information<0)performance_flags.push('IR 12 mois négatif ou indisponible');
  if(diagnostics.derniers_6.gap<0)performance_flags.push('Retard cumulé sur 6 mois face à VEQT');
  const limit_flags=limits(q,D),review_signals=q.robust_review?.review_required?q.robust_review.signals||['Revue de robustesse requise']:[];
  const signals=[...new Set([...performance_flags,...limit_flags,...review_signals])];
  // A disclosed preference score, not a probability or a fitted forecast.
  // Fees are already included in returns; this is an additional cost preference.
  const score=worst_information===null||worst_sharpe===null?null:worst_information+worst_sharpe-25*q.mer;
  const eligible=signals.length===0;
  const num=v=>v===null?'indisponible':new Intl.NumberFormat('fr-CA',{maximumFractionDigits:2,minimumFractionDigits:2}).format(v);
  const reason=(eligible?'Critères actuels respectés. ':'Réévaluation requise : '+signals.join('; ')+'. ')+
   'IR minimal 28 / 24 / 12 mois : '+num(worst_information)+'; Sharpe minimal : '+num(worst_sharpe)+'. '+
   'RFG '+num(q.mer*100)+' %. '+(diagnostics.derniers_3.gap<0?'Retard sur les 3 derniers mois à surveiller. ':'')+
   (id==='proposal'?'Le rejeu chronologique de la recherche reste distinct de ce backtest à allocation fixe. ':'');
  return {id,eligible,score,worst_information,worst_sharpe,mer:q.mer,signals,performance_flags,limit_flags,diagnostics,reason};
 });
 entries.sort((a,b)=>Number(b.eligible)-Number(a.eligible)||(b.score??-Infinity)-(a.score??-Infinity)||a.mer-b.mer||a.id.localeCompare(b.id));
 const date=['2026-10-21',D.assumptions.analysis_date,D.optimization.generated_at.slice(0,10),...(D.robust_selections||[]).map(c=>c.published_at.slice(0,10))].filter(Boolean).sort().at(-1);
 return {date,as_of:D.assumptions.as_of,method_version:'common-robustness-v2-feqt50-sector7',
  policy:{effective_date:'2026-10-21',feqt_cap:.50,geo_tolerance:.10,sector_tolerance:.07},
  criteria:'Même règle pour tous les candidats : limites actuelles et absence de signal défavorable sur 6 / 12 mois d’abord; puis IR minimal + Sharpe minimal des fenêtres début 28 mois / derniers 24 mois / derniers 12 mois, moins 25 × RFG annuel (en décimal). Frais déjà inclus dans les rendements; la pénalité exprime une préférence pour des coûts plus faibles. Les 3 derniers mois servent d’alerte. Les allocations historiques hors limites restent suivies et signalées. Nº 10 et 11, mandats mixtes, exclus. Classement rétrospectif, sans test indépendant ni garantie de robustesse future; les variantes Robuste ne sont pas prioritaires par leur nom.',
  entries:entries.map((e,i)=>({...e,rank:i+1}))};
};
