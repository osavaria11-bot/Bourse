(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./fnb-factor-utils.js'));
  else root.SavyFnbStress=factory(root.SavyFnbFactors);
})(typeof globalThis!=='undefined'?globalThis:this,function(F){
  'use strict';
  // Shocks are explicit scenario assumptions, never invented historical returns.
  const SCENARIOS=[
    {id:'gfc2008',name:'Crise financière · 2008',start:'2007-12-31',end:'2008-12-31',historical:true},
    {id:'covid2020',name:'COVID · fév.–mars 2020',start:'2020-02-19',end:'2020-03-23',historical:true},
    {id:'rates2022',name:'Marché baissier · 2022',start:'2021-12-31',end:'2022-12-30',historical:true},
    {id:'world20',name:'Marché mondial −20 %',shocks:{market:-.20},horizon:'Choc instantané hypothétique'},
    {id:'technology',name:'Technologie et croissance',shocks:{market:-.10,technology:-.35},horizon:'Choc sectoriel hypothétique'},
    {id:'recession',name:'Récession et crédit',shocks:{market:-.25,bond:.05,credit:-.08},horizon:'Choc hypothétique : marché −25 %, proxy taux +5 %, spread de crédit −8 %'},
    {id:'bondRates',name:'Hausse des taux obligataires',shocks:{market:-.08,bond:-.12},horizon:'Choc hypothétique : proxy obligataire −12 %, marché −8 %'},
    {id:'cadUp',name:'CAD +15 % face au USD',shocks:{fx:1/1.15-1},horizon:'Choc de change hypothétique : USD/CAD −13,04 %'}
  ];
  const LABELS={observed:'Observé',reconstructed:'Reconstruit',modeled:'Modélisé',insufficient:'Données insuffisantes'};
  const validWeights=w=>w&&Object.keys(w).length>0&&Object.values(w).every(v=>Number.isFinite(v)&&v>=0)&&Math.abs(Object.values(w).reduce((s,v)=>s+v,0)-1)<1e-8;
  const validReturn=v=>Number.isFinite(v)&&v>=-1;
  const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
  const cache=new WeakMap();
  function models(D,input){
    let saved=cache.get(D);if(saved?.input===input)return saved.value;
    const u=D?.universe,dates=u?.dates||[],r=u?.returns||{},extra=input?.model_factors;
    const sourceIndex=new Map((extra?.dates||[]).map((d,i)=>[d,i]));
    const tickers=[...new Set(Object.values(D.results||{}).flatMap(p=>Object.keys(p.weights||{})))];
    const value={};
    for(const ticker of tickers){
      const base=F.FACTORS.map(f=>({id:f.id,values:dates.map((d,i)=>r[f.long]?.[i]-(f.short?r[f.short]?.[i]:0))}));
      for(const id of ['bond','credit','fx'])if(dates.every(d=>Number.isFinite(extra?.returns?.[id]?.[sourceIndex.get(d)])))base.push({id,values:dates.map(d=>extra.returns[id][sourceIndex.get(d)])});
      const rows=dates.flatMap((date,i)=>Number.isFinite(r[ticker]?.[i])&&base.every(f=>Number.isFinite(f.values[i]))?[{i,y:r[ticker][i],x:base.map(f=>f.values[i])}]:[]);
      const fit=F.regress(rows.map(v=>v.x),rows.map(v=>v.y));
      const betaRows=dates.flatMap((d,i)=>Number.isFinite(r[ticker]?.[i])&&Number.isFinite(r.VEQT?.[i])?[i]:[]);
      const beta=betaRows.length>=24?F.beta(betaRows.map(i=>r[ticker][i]),betaRows.map(i=>r.VEQT[i])):null;
      value[ticker]={fit,ids:base.map(f=>f.id),beta,observations:rows.length};
    }
    cache.set(D,{input,value});return value;
  }
  function historicalReturn(row,scenario){
    if(!row||row.start!==scenario.start||row.end!==scenario.end||row.currency!=='CAD'||row.total_return!==true||!validReturn(row.return)||!row.source_url)return null;
    return row.return;
  }
  function estimate(D,ticker,scenario,input){
    const event=input?.scenarios?.[scenario.id],actual=historicalReturn(event?.assets?.[ticker],scenario);
    if(scenario.historical&&actual!==null)return {ticker,return:actual,classification:'observed',method:'Rendement total du FNB en CAD',source:event.assets[ticker].source_url};
    const index=input?.indices?.[ticker],ir=historicalReturn(index?.scenarios?.[scenario.id],scenario);
    if(scenario.historical&&index?.representative===true&&index.methodology_url&&ir!==null)return {ticker,return:ir,classification:'reconstructed',method:'Indice sous-jacent représentatif',source:index.methodology_url};
    // A reconstruction is accepted only with complete, documented weights and
    // CAD component returns. Never infer FX hedges or replay leveraged periods.
    const reconstruction=input?.reconstructions?.[ticker];
    if(scenario.historical&&reconstruction?.validated===true&&reconstruction.currency==='CAD'&&reconstruction.leverage===1&&
      reconstruction.source_url&&reconstruction.as_of&&reconstruction.as_of<=input.as_of&&
      ['current','historical'].includes(reconstruction.weight_basis)&&
      (reconstruction.weight_basis==='current'||reconstruction.as_of<=scenario.start)&&
      validWeights(reconstruction.weights)){
      const parts=Object.entries(reconstruction.weights).map(([t,w])=>({w,r:historicalReturn(event?.assets?.[t],scenario)}));
      if(parts.every(p=>p.r!==null))return {ticker,return:parts.reduce((s,p)=>s+p.w*p.r,0),classification:'reconstructed',method:reconstruction.weight_basis==='historical'?'Positions datées au début du scénario':'Allocation actuelle dans un environnement historique',source:reconstruction.source_url};
    }
    const model=models(D,input)[ticker],shocks=scenario.historical?event?.factor_shocks:scenario.shocks;
    if(!model||!shocks)return {ticker,return:null,classification:'insufficient',method:'Sources et sensibilités insuffisantes'};
    if(scenario.id==='technology'){
      const sector=D.universe?.sector?.[ticker],equity=D.universe?.equity?.[ticker];
      const gold=D.universe?.gold?.[ticker],bond=D.universe?.bond?.[ticker],cash=D.universe?.cash?.[ticker],crypto=D.universe?.crypto?.[ticker];
      if(Array.isArray(sector)&&Number.isFinite(equity)&&[gold,bond,cash,crypto].every(Number.isFinite)&&Math.abs(equity+gold+bond+cash+crypto-1)<.02){
        const tech=equity*sector[0],r=tech*shocks.technology+(equity-tech)*shocks.market+crypto*(-.45);
        return {ticker,return:r,classification:'modeled',method:'Chocs sectoriels sur les expositions actuelles',components:{technology:tech*shocks.technology,market:(equity-tech)*shocks.market,crypto:crypto*(-.45)},limitations:'Actions technologie −35 %, autres actions −10 %; obligations, or, cash et devises constants. Crypto −45 %. Croissance non isolée de la technologie.'};
      }
      return {ticker,return:null,classification:'insufficient',method:'Expositions sectorielles ou actifs complémentaires incomplets'};
    }
    const nonzero=Object.entries(shocks).filter(([,v])=>v!==0);
    if(nonzero.length===1&&nonzero[0][0]==='market'&&Number.isFinite(model.beta)&&validReturn(model.beta*shocks.market))return {ticker,return:model.beta*shocks.market,classification:'modeled',method:'Projection linéaire fondée sur le bêta',components:{market:model.beta*shocks.market},limitations:'Bêta estimé sur l’historique récent; taux, crédit, devises et résiduel non isolés. Aucune trajectoire historique du FNB créée.'};
    if(model.fit&&nonzero.every(([key])=>model.ids.includes(key))){
      const components=Object.fromEntries(nonzero.map(([key,shock])=>[key,shock*model.fit.coefficients[model.ids.indexOf(key)]]));
      const r=Object.values(components).reduce((s,v)=>s+v,0);
      if(validReturn(r))return {ticker,return:r,classification:'modeled',method:'Projection factorielle conditionnelle',components,observations:model.fit.observations,maxVif:model.fit.maxVif,limitations:'Sensibilités récentes, régime et pondérations actuels; interception et résiduel non projetés. Sensibilité FX empirique, pas une mesure contractuelle de couverture.'};
    }
    return {ticker,return:null,classification:'insufficient',method:'Facteurs nécessaires non estimables sur un échantillon suffisant'};
  }
  function aggregate(D,weights,scenario,input){
    const coverage={observed:0,reconstructed:0,modeled:0,insufficient:0};
    if(!validWeights(weights))return {available:false,return:null,coverage:{...coverage,insufficient:1},positions:[],classification:'insufficient'};
    const positions=Object.entries(weights).filter(([,w])=>w>0).map(([ticker,weight])=>({...estimate(D,ticker,scenario,input),weight}));
    for(const p of positions)coverage[p.classification]+=p.weight;
    const available=positions.every(p=>validReturn(p.return));
    const classification=!available?'insufficient':coverage.modeled>1e-10?'modeled':coverage.reconstructed>1e-10?'reconstructed':'observed';
    return {available,return:available?positions.reduce((s,p)=>s+p.weight*p.return,0):null,coverage,positions,classification,weightConvention:'Poids actuels au début du choc, achat et conservation sur la période; aucun ajustement artificiel de corrélation.',uncertainty:null};
  }
  function compare(D,id,benchmark,input=null){
    return SCENARIOS.map(scenario=>{
      const p=aggregate(D,D.results?.[id]?.weights,scenario,input),b=aggregate(D,D.results?.[benchmark]?.weights,scenario,input);
      const available=p.available&&b.available,gap=available?p.return-b.return:null;
      const drivers=available?[...new Set([...p.positions,...b.positions].map(x=>x.ticker))].map(ticker=>({ticker,
        contribution:(p.positions.find(x=>x.ticker===ticker)?.weight||0)*(p.positions.find(x=>x.ticker===ticker)?.return||0)-(b.positions.find(x=>x.ticker===ticker)?.weight||0)*(b.positions.find(x=>x.ticker===ticker)?.return||0)})).sort((x,y)=>Math.abs(y.contribution)-Math.abs(x.contribution)):[];
      const componentNames=[...new Set([...p.positions,...b.positions].flatMap(x=>Object.keys(x.components||{})))];
      const components=available&&[...p.positions,...b.positions].every(x=>x.components)?Object.fromEntries(componentNames.map(k=>[k,
        p.positions.reduce((s,x)=>s+x.weight*(x.components[k]||0),0)-b.positions.reduce((s,x)=>s+x.weight*(x.components[k]||0),0)])):null;
      const market=components?.market??null,other=components?Object.entries(components).filter(([k])=>k!=='market').reduce((s,[,v])=>s+v,0):null;
      return {...scenario,portfolio:p,benchmark:b,available,gap,drivers:drivers.slice(0,4),components,
        decomposition:available&&components?{market,other,residual:gap-(market||0)-(other||0),note:'Attribution de la projection linéaire; résiduel non simulé, aucune preuve de diversification hors modèle.'}:null,
        interpretation:gap===null?'Comparaison indisponible':gap>0?'Protection relative':gap<0?'Sous-performance':'Même rendement estimé',
        status:input?.status||'unavailable',asOf:input?.as_of||null};
    });
  }
  return {SCENARIOS,LABELS,compare,estimate,aggregate,models};
});
