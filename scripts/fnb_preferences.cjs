"use strict";
// One rule for every equity-growth candidate. Names and selection families
// never enter the score; the two mixed mandates keep their separate purpose.
const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
const sd=a=>{const m=mean(a);return Math.sqrt(a.reduce((s,v)=>s+(v-m)**2,0)/(a.length-1));};
const total=a=>a.reduce((s,v)=>s*(1+v),1)-1;
const effectiveDate='2026-10-24';
// Construction checks remain diagnostics, never a ranking gate or penalty.
const exposureFlags=new Set(['Limite géographique dépassée','Limite sectorielle dépassée']);
const constructionFlag=flag=>exposureFlags.has(flag)||['Limite crypto dépassée','Crypto au-dessus de 3 %','Benchmark détenu dans l’allocation'].includes(flag)||flag.endsWith(' au-dessus du plafond par fonds');
function period(p,b,rf,dates){
 if(p.length<2||p.length!==b.length||p.some(v=>!Number.isFinite(v)||v<=-1)||b.some(v=>!Number.isFinite(v)||v<=-1))throw Error('Périodes de classement incompatibles');
 const vol=sd(p)*Math.sqrt(12),active=p.map((v,i)=>v-b[i]),te=sd(active)*Math.sqrt(12);
 return {start:dates[0],end:dates.at(-1),months:p.length,total_return:total(p),benchmark_return:total(b),gap:total(p)-total(b),sharpe:vol>1e-12?(mean(p)*12-rf)/vol:null,information:te>1e-12?mean(active)*12/te:null};
}
function limits(q,D,id){
 const flags=[],caps={FEQT:.50,'CGL.C':.05,XIT:.10,ZEB:.10,ZEO:.05,FINN:.15},eps=1e-8;
 const veqtAllowed=(D.recommended_selections||[]).some(c=>c.veqt_cap===.40&&c.portfolios.some(p=>p.id===id));
 if(veqtAllowed)caps.VEQT=.40;
 for(const [t,w] of Object.entries(q.weights))if(w>(caps[t]??.35)+eps)flags.push(t+' au-dessus du plafond par fonds');
 if((q.weights.VEQT&&!veqtAllowed)||q.weights.XEQT)flags.push('Benchmark détenu dans l’allocation');
 if(q.crypto>.03+eps)flags.push('Crypto au-dessus de 3 %');
 const g=q.geo_equity,lo=[.30,.15,.15,.05],hi=[.60,.40,.40,.20];
 if(g.some((v,i)=>Math.abs(v-D.universe.ref_geo[i])>.10+eps)||g.slice(0,4).some((v,i)=>v<lo[i]-eps||v>hi[i]+eps)||g[4]>.05+eps)flags.push('Limite géographique dépassée');
 if(q.sectors.some((v,i)=>v>.35+eps||Math.abs(v-D.universe.ref_sector[i])>.07+eps))flags.push('Limite sectorielle dépassée');
 return flags;
}
module.exports=function preferences(D){
 const dates=D.dates,n=dates.length,rf=D.assumptions.risk_free,b=D.results.VEQT.monthly;
 if(n<28||b.length!==n)throw Error('Historique commun insuffisant pour le classement');
 const ids=[...(D.recommended_order||[]),...(D.robust_order||[]),...(D.proposal_order||[]),...D.custom_order.filter(k=>!['10','11'].includes(k))];
 const entries=ids.map(id=>{
  const q=D.results[id];if(q.monthly.length!==n)throw Error('Historique non aligné : '+id);
  const benchmark=(D.recommended_order||[]).includes(id)?'VFV':'VEQT',reference=D.results[benchmark].monthly;
  const windows={debut_28:[0,28],derniers_24:[n-24,n],derniers_12:[n-12,n],derniers_6:[n-6,n],derniers_3:[n-3,n]},diagnostics={};
  for(const [key,[a,z]] of Object.entries(windows))diagnostics[key]=period(q.monthly.slice(a,z),reference.slice(a,z),rf,dates.slice(a,z));
  const long=[diagnostics.debut_28,diagnostics.derniers_24,diagnostics.derniers_12];
  const worst_information=long.every(r=>r.information!==null)?Math.min(...long.map(r=>r.information)):null;
  const worst_sharpe=long.every(r=>r.sharpe!==null)?Math.min(...long.map(r=>r.sharpe)):null;
  const performance_flags=[];
  if(diagnostics.derniers_12.information===null||diagnostics.derniers_12.information<0)performance_flags.push('IR 12 mois négatif ou indisponible');
  if(diagnostics.derniers_6.gap<0)performance_flags.push('Retard cumulé sur 6 mois face à '+benchmark);
  if(benchmark==='VFV'&&['full','before','after'].some(k=>!q.historical_backtest.periods[k].beats_sp500))performance_flags.push('S&P 500 non battu sur toutes les périodes longues avant/après');
  const limit_flags=limits(q,D,id),review_signals=q.robust_review?.review_required?q.robust_review.signals||['Revue de robustesse requise']:[];
  const ranking_limit_flags=[];
  const signals=[...new Set([...performance_flags,...review_signals.filter(flag=>!constructionFlag(flag))])];
  // A disclosed preference score, not a probability or a fitted forecast.
  // Fees are already included in returns; this is an additional cost preference.
  const score=worst_information===null||worst_sharpe===null?null:worst_information+worst_sharpe-25*q.mer;
  const eligible=score!==null,performance_review_required=signals.length>0;
  const num=v=>v===null?'indisponible':new Intl.NumberFormat('fr-CA',{maximumFractionDigits:2,minimumFractionDigits:2}).format(v);
  const reason=(!eligible?'Score indisponible. ':performance_review_required?'Points à surveiller : '+signals.join('; ')+'. ':'')+
   'IR minimal 28 / 24 / 12 mois : '+num(worst_information)+'; Sharpe minimal : '+num(worst_sharpe)+'. '+(benchmark==='VFV'?'Référence : S&P 500 via VFV en CAD. ':'')+
   'RFG '+num(q.mer*100)+' %. '+(diagnostics.derniers_3.gap<0?'Retard sur les 3 derniers mois à surveiller. ':'')+
   (id==='proposal'?'Le rejeu chronologique de la recherche reste distinct de ce backtest à allocation fixe. ':'');
  return {id,benchmark,eligible,performance_review_required,score,worst_information,worst_sharpe,mer:q.mer,signals,performance_flags,limit_flags,ranking_limit_flags,diagnostics,reason};
 });
 entries.sort((a,b)=>(b.score??-Infinity)-(a.score??-Infinity)||a.mer-b.mer||a.id.localeCompare(b.id));
 const date=[effectiveDate,D.assumptions.analysis_date,D.optimization.generated_at.slice(0,10),...[...(D.robust_selections||[]),...(D.recommended_selections||[])].map(c=>c.published_at.slice(0,10))].filter(Boolean).sort().at(-1);
 return {date,as_of:D.assumptions.as_of,method_version:'financial-quality-v4-no-construction-gates',
  policy:{effective_date:effectiveDate,feqt_cap:.50,recommended_veqt_cap:.40,recommended_benchmark:'VFV',existing_benchmark:'VEQT',geo_tolerance:.10,sector_tolerance:.07,exposure_limits_affect_ranking:false,construction_limits_affect_ranking:false,review_flags_affect_ranking:false},
  criteria:'Qualité historique : IR minimal + Sharpe minimal des fenêtres début 28 mois / derniers 24 mois / derniers 12 mois, moins 25 × RFG annuel (en décimal). Les limites de construction, notamment géographiques, sectorielles, par fonds et crypto, ne changent ni le score ni le rang. Les signaux sur 3 / 6 / 12 mois restent des points à surveiller, sans déclassement automatique. Frais déjà inclus dans les rendements; la pénalité exprime une préférence pour des coûts plus faibles. Les contraintes de construction et de robustesse des prochaines recherches restent inchangées. Références : VFV pour les trois sélections S&P 500, VEQT pour les autres; les IR de ces deux groupes n’ont donc pas le même benchmark. Nº 10 et 11, mandats mixtes, exclus. Classement rétrospectif, distinct du jugement prospectif et sans probabilité de surperformance estimée.',
  entries:entries.map((e,i)=>({...e,rank:i+1}))};
};
