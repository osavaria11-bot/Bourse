(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./fnb-risk-utils.js'),require('./fnb-factor-utils.js'),require('./fnb-stress-utils.js'),require('./fnb-forecast-utils.js'));
  else root.SavyFnbDecisionUtils=factory(root.SavyFnbRisk,root.SavyFnbFactors,root.SavyFnbStress,root.SavyFnbForecast);
})(typeof globalThis!=='undefined'?globalThis:this,function(R,F,S,Forward){
  'use strict';
  const GOALS={global:{label:'Comparaison globale',key:null,metric:'comparaison globale',higher:true},growth:{label:'Croissance',key:'annualReturn',metric:'rendement annualisé',higher:true},balance:{label:'Compromis',key:'sharpe',metric:'Sharpe',higher:true},protection:{label:'Protection',key:'cvar',metric:'CVaR à 21 séances',higher:false}};
  const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
  const sameWeights=(a,b)=>!!a&&!!b&&Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(k=>Number.isFinite(b[k])&&Math.abs(a[k]-b[k])<1e-10);
  const own=D=>[...(D.recommended_order||[]),...(D.robust_order||[]),...(D.proposal_order||[]),...(D.custom_order||[])];
  function candidates(D,benchmark){
    const group=['VBAL','FBAL'].includes(benchmark)?['10']:['VGRO','FGRO'].includes(benchmark)?['11']:own(D).filter(k=>!['10','11'].includes(k));
    const order=(D.preference_ranking?.entries||[]).map(e=>e.id);
    return group.filter(k=>D.results[k]).sort((a,b)=>(order.indexOf(a)<0?999:order.indexOf(a))-(order.indexOf(b)<0?999:order.indexOf(b)));
  }
  function choices(D,benchmark,selected=[]){
    const allowed=candidates(D,benchmark),out=[];
    // Keep the user's candidates when possible. A change of objective never
    // replaces allocations or turns a retrospective ranking into an instruction.
    for(const id of [...selected,...allowed])if(allowed.includes(id)&&!out.includes(id)&&out.length<3)out.push(id);
    return out;
  }
  function metrics(returns,frequency=252,riskFree=0,indices=null){
    if(!Array.isArray(returns)||returns.length<2||returns.some(v=>!Number.isFinite(v)||v<=-1))return null;
    const n=returns.length,m=mean(returns),vol=Math.sqrt(returns.reduce((s,v)=>s+(v-m)**2,0)/(n-1)*frequency),total=returns.reduce((s,v)=>s*(1+v),1)-1;
    const blocks=frequency===252&&indices?R.compoundBlocks(returns,indices):[],tail=blocks.length>=24?R.losses(blocks):null;
    return {annualReturn:n>=frequency?(1+total)**(frequency/n)-1:null,sharpe:n>=frequency&&vol>1e-12?(m*frequency-riskFree)/vol:null,vol,total,maxDrawdown:R.maximumDrawdown(returns)?.value??null,
      cvar:tail?.cvar??null,var:tail?.var??null,observations:n,blocks:blocks.length,tailObservations:tail?.tailObservations??0,tailFragile:!tail||R.effectiveObservations(blocks)*.05<10};
  }
  function analyse(D,selected,benchmark,daily,stress){
    const ids=[...new Set([...selected,benchmark])].filter(k=>D.results[k]);
    if(!ids.includes(benchmark)||!selected.length)return {available:false,reason:'Sélection ou référence indisponible.',rows:[]};
    const joint=ids.map(id=>R.jointSeries(D,id,benchmark,daily));
    const dailyBasis=joint.every(s=>s&&s.dates.length>=252&&s.session_indices.at(-1)-s.session_indices[0]===s.dates.length-1&&s.dates.join()===joint[0].dates.join());
    if(!dailyBasis&&(!Array.isArray(D.dates)||D.dates.length<2||ids.some(id=>D.results[id].monthly?.length!==D.dates.length||D.results[id].monthly.some(r=>!Number.isFinite(r)||r<=-1))))return {available:false,reason:'Historiques communs incomplets : comparaison indisponible.',rows:[]};
    const dates=dailyBasis?joint[0].dates:D.dates,frequency=dailyBasis?252:12,indices=dailyBasis?joint[0].session_indices:null;
    const rows=ids.map((id,i)=>{
      const returns=dailyBasis?joint[i].p:D.results[id].monthly;
      const scenarios=S.compare(D,id,benchmark,stress),risk=R.compare(D,id,benchmark,daily);
      return {id,...metrics(returns,frequency,D.assumptions.risk_free,indices),returns,risk,scenarios,mer:D.results[id].mer,
        isBenchmark:id===benchmark,flags:D.preference_ranking?.entries.find(e=>e.id===id)?.limit_flags||[]};
    });
    return {available:true,rows,dates,start:dates[0],end:dates.at(-1),frequency,indices,dailyReturns:dailyBasis?daily.daily_series.returns:null,basis:dailyBasis?'daily':'monthly',dailyStatus:daily?.status||'unavailable',
      method:dailyBasis?'Rendements totaux CAD aux poids cibles quotidiens constants; annualisation à 252 séances.':'Backtest mensuel CAD, rééquilibrage annuel en janvier; creux intramensuels et CVaR à 21 séances non estimables ici.'};
  }
  function ranks(rows,goal){
    if(goal==='global')return Forward.global(rows,'historical').ranks;
    const g=GOALS[goal];if(!g)return new Map();
    const valid=rows.filter(r=>!r.isBenchmark&&Number.isFinite(r[g.key])).sort((a,b)=>(a[g.key]-b[g.key])*(g.higher?-1:1)||a.id.localeCompare(b.id));
    let rank=0,previous=null;return new Map(valid.map((r,i)=>{if(previous===null||Math.abs(r[g.key]-previous)>1e-10)rank=i+1;previous=r[g.key];return [r.id,rank];}));
  }
  function horizon(analysis,years){
    years=Number(years);
    if(![2,5,10].includes(years)||!analysis?.available||!analysis.dates?.length)return null;
    const end=analysis.dates.at(-1),year=Number(end.slice(0,4))-years;
    let requestedStart=String(year)+end.slice(4);
    // A leap-day anniversary falls on February 28 in a non-leap year.
    if(end.length===10){const month=Number(end.slice(5,7)),day=Number(end.slice(8,10));
      const last=new Date(Date.UTC(year,month,0)).getUTCDate();
      requestedStart=String(year)+'-'+String(month).padStart(2,'0')+'-'+String(Math.min(day,last)).padStart(2,'0');}
    const base=analysis.dates.findLastIndex(d=>d<=requestedStart);
    if(base<0)return {years,available:false,requestedStart,end,observations:0,results:[],reason:'L’historique est plus court que '+years+' ans; aucun rendement sur cet horizon n’est calculable.'};
    const dates=analysis.dates.slice(base+1);
    if(!dates.length||analysis.rows.some(r=>r.returns?.length!==analysis.dates.length||r.returns.some(x=>!Number.isFinite(x)||x<=-1)))return {years,available:false,requestedStart,end,observations:0,results:[],reason:'Rendements communs incomplets sur cet horizon.'};
    return {years,available:true,requestedStart,start:analysis.dates[base],end,observations:dates.length,
      results:analysis.rows.map(r=>({id:r.id,isBenchmark:r.isBenchmark,total:r.returns.slice(base+1).reduce((v,x)=>v*(1+x),1)-1})),
      note:'Rejeu rétrospectif sur une seule période commune terminée à la dernière observation; aucune projection ni probabilité de gain future. Si l’anniversaire est fermé, la clôture commune précédente est utilisée.'};
  }
  function tolerance(row,limit){
    const available=row.scenarios.filter(s=>s.portfolio.available),missing=row.scenarios.length-available.length;
    if(!Number.isFinite(limit)||limit<=0||limit>1)return {status:'unset',missing,breaches:[],worst:null};
    const points=available.map(s=>({name:s.name,loss:-s.portfolio.return,classification:s.portfolio.classification}));
    if(Number.isFinite(row.maxDrawdown))points.push({name:'Recul maximal du comparatif',loss:-row.maxDrawdown,classification:'reconstructed'});
    const breaches=points.filter(p=>p.loss>=limit),worst=points.length?Math.max(...points.map(p=>p.loss)):null;
    return {status:breaches.length?'exceeded':points.length?'not_exceeded_in_available':'unavailable',missing,breaches,worst};
  }
  function sensitivity(D,analysis,goal){
    const g=GOALS[goal];if(!g?.key||!analysis.available)return [];
    const rows=analysis.rows.filter(r=>!r.isBenchmark),windows=[...new Set([analysis.frequency,analysis.frequency*2,analysis.dates.length])].filter(n=>n<=analysis.dates.length);
    const byWindow=windows.map(n=>({n,ranks:ranks(rows.map(r=>({id:r.id,...metrics(r.returns.slice(-n),analysis.frequency,D.assumptions.risk_free,analysis.indices?.slice(-n))})),goal)}));
    return rows.map(row=>{
      const dated=byWindow.map(w=>({observations:w.n,rank:w.ranks.get(row.id)??null})),others=rows.filter(r=>r.id!==row.id),local=[];
      // A local diagnostic, never a search for a winning allocation. Transfers
      // are at most two percentage points and preserve positive weights / sum 1.
      if(analysis.basis==='daily'){
        const w=D.results[row.id].weights,series=D&&analysis.indices?analysis.dailyReturns:null;
        if(series)for(const from of Object.keys(w))for(const to of Object.keys(w))if(from!==to){
          const shift=Math.min(.02,w[from]);if(shift<=1e-12||!series[from]||!series[to])continue;
          const x=row.returns.map((r,i)=>r+shift*(series[to][i]-series[from][i]));
          const m=metrics(x,252,D.assumptions.risk_free,analysis.indices);
          const rank=ranks([...others,{id:row.id,...m}],goal).get(row.id);
          if(rank!==undefined)local.push({rank,value:m[g.key]});
        }
      }
      const ranked=dated.map(w=>w.rank).filter(Number.isFinite);
      return {id:row.id,windows:dated,dateRank:ranked.length?[Math.min(...ranked),Math.max(...ranked)]:null,weightVariants:local.length,
        weightRank:local.length?[Math.min(...local.map(v=>v.rank)),Math.max(...local.map(v=>v.rank))]:null,
        weightMetric:local.length?[Math.min(...local.map(v=>v.value)),Math.max(...local.map(v=>v.value))]:null};
    });
  }
  function recorded(D,id,benchmark,data){
    if(data?.model==='common_start_buy_hold_v1'||data?.methodology?.model!=='buy_hold_fractional_ex_date_close_v1')return {available:false,reason:'Le suivi doit provenir du registre après publication.'};
    const p=D.results[id],accountId=D.custom_order.includes(id)?'savy-'+id:id==='proposal'?'proposal-'+D.optimization.month:id;
    const a=data?.accounts?.find(a=>a.id===accountId),b=data?.accounts?.find(a=>a.id===benchmark&&a.kind==='benchmark');
    if(!a||!sameWeights(p?.weights,a.weights))return {available:false,reason:a?'Version d’allocation différente du compte enregistré.':'Compte après publication indisponible.'};
    if(!a.history?.length)return {available:false,reason:'Première clôture après publication en attente.'};
    const history=a.history,start=history[0].date,end=history.at(-1).date;
    if(a.series_type==='simulation'||start!==a.launch_date||(a.published_at&&start<a.published_at.slice(0,10))||end!==data.as_of||history.some(h=>h.date<a.launch_date||!Number.isFinite(h.value)||h.value<=0))return {available:false,reason:'Dates du suivi enregistré incompatibles.'};
    const bm=new Map((b?.history||[]).map(h=>[h.date,h.value])),matched=history.every(h=>Number.isFinite(bm.get(h.date))&&bm.get(h.date)>0);
    const total=history.at(-1).value/history[0].value-1,reference=matched?bm.get(end)/bm.get(start)-1:null;
    return {available:true,start,end,total,benchmark:reference,gap:reference===null?null:total-reference,observations:history.length-1,short:history.length-1<252};
  }
  function overlap(D,id){
    const holdings=D.lookthrough?.results?.[id],q=D.results[id];
    return {top10:Number.isFinite(holdings?.top10_weight)?holdings.top10_weight:null,maxFund:Math.max(...Object.values(q.weights)),funds:Object.keys(q.weights).length,
      sharedTop:(holdings?.top10||[]).filter(p=>Object.keys(p.contributions||{}).length>1).map(p=>({name:p.name,weight:p.weight,funds:Object.keys(p.contributions)})),
      maxGeoGap:q.max_geo_gap??null,maxSectorGap:q.max_sector_gap??null};
  }
  return {GOALS,own,candidates,choices,metrics,analyse,ranks,horizon,tolerance,sensitivity,recorded,overlap,sameWeights};
});
