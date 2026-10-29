(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./fnb-factor-utils.js'),require('./fnb-frontier-utils.js'));
  else root.SavyFnbForecast=factory(root.SavyFnbFactors,root.SavyFrontierUtils);
})(typeof globalThis!=='undefined'?globalThis:this,function(F,Frontier){
  'use strict';
  const VERSION='20261025-readable-3',PATHS=25000,HORIZONS=[2,5,10],BENCHMARKS=['VFV','FEQT','VEQT'];
  const SOURCE={year:2026,date:'2026-04-30',url:'https://institutpf.org/normes-hypotheses-projection',name:'Institut de planification financière / FP Canada · 2026',cash:.024,bond:.032,canada:.063,us:.064,developed:.066,emerging:.075,inflation:.021};
  const mean=a=>a.reduce((s,v)=>s+v,0)/a.length,dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),finite=Number.isFinite;
  const center=a=>{const m=mean(a);return a.map(v=>v-m);};
  const variance=a=>{const c=center(a);return dot(c,c)/(a.length-1);};
  const quantile=(a,p)=>{const k=(a.length-1)*p,i=Math.floor(k);return a[i]+(a[Math.min(i+1,a.length-1)]-a[i])*(k-i);};
  const sorted=a=>[...a].sort((a,b)=>a-b),range=a=>[Math.min(...a),Math.max(...a)];
  const month=d=>/^\d{4}-(0[1-9]|1[0-2])$/.test(d)?Number(d.slice(0,4))*12+Number(d.slice(5)):NaN;
  const validReturn=x=>finite(x)&&x> -1&&x<5;
  const cov=(a,b)=>dot(center(a),center(b))/(a.length-1);
  function rng(seed){let state=seed>>>0;return ()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return (state+.5)/4294967296;};}
  function normal(random){return Math.sqrt(-2*Math.log(random()))*Math.cos(2*Math.PI*random());}
  function solve(a,b){
    const m=a.map((r,i)=>[...r,b[i]]),n=b.length;
    for(let k=0;k<n;k++){
      let pivot=k;for(let i=k+1;i<n;i++)if(Math.abs(m[i][k])>Math.abs(m[pivot][k]))pivot=i;
      if(Math.abs(m[pivot][k])<1e-14)return null;
      [m[k],m[pivot]]=[m[pivot],m[k]];const z=m[k][k];for(let j=k;j<=n;j++)m[k][j]/=z;
      for(let i=0;i<n;i++)if(i!==k){const t=m[i][k];for(let j=k;j<=n;j++)m[i][j]-=t*m[k][j];}
    }
    return m.map(r=>r[n]);
  }
  // Semidefinite Cholesky preserves identical portfolios instead of adding
  // independent jitter to their mean uncertainty or their market paths.
  function cholesky(a){
    const n=a.length,L=Array.from({length:n},()=>Array(n).fill(0)),tol=Math.max(1e-14,...a.map((r,i)=>r[i]*1e-8));
    for(let i=0;i<n;i++)for(let j=0;j<=i;j++){
      let v=a[i][j];for(let k=0;k<j;k++)v-=L[i][k]*L[j][k];
      if(i===j){if(v< -tol)return null;L[i][j]=Math.sqrt(v>tol?v:0);}
      else if(L[j][j]>1e-10)L[i][j]=v/L[j][j];else if(Math.abs(v)>tol)return null;
    }
    return L;
  }
  function blackLitterman(covariance,prior,P,Q,omega,tau){
    const n=prior?.length,k=Q?.length;
    if(!n||!k||!finite(tau)||tau<=0||!prior.every(finite)||covariance?.length!==n||covariance.some(r=>r.length!==n||!r.every(finite))||P?.length!==k||P.some(r=>r.length!==n||!r.every(finite))||!Q.every(finite)||omega?.length!==k||omega.some(r=>r.length!==k||!r.every(finite))||!cholesky(covariance)||!cholesky(omega))return null;
    const C=covariance.map(r=>r.map(v=>v*tau)),CP=C.map(r=>P.map(p=>dot(r,p))),A=P.map((p,i)=>P.map((_,j)=>dot(p,CP.map(r=>r[j]))+omega[i][j]));
    const innovation=Q.map((q,i)=>q-dot(P[i],prior)),weights=solve(A,innovation);if(!weights)return null;
    const gain=CP.map(r=>solve(A,r));if(gain.some(r=>!r))return null;
    const posterior=prior.map((v,i)=>v+dot(CP[i],weights));
    const uncertainty=C.map((r,i)=>r.map((v,j)=>v-dot(gain[i],CP[j])));
    return {mean:posterior,uncertainty,gain,tau,prior:[...prior],views:[...Q]};
  }
  function defaults(){return {returnBasis:'history',recentCarry:0,equityView:0,viewSE:.03,volScale:1,blockLength:3,parameterUncertainty:true};}
  function geography(q){const g=q?.geo_total;return Array.isArray(g)&&g.length===9&&g.every(v=>finite(v)&&v>=0)&&Math.abs(g.reduce((s,v)=>s+v,0)-1)<1e-6?g:null;}
  function anchor(g,r=SOURCE){return dot(g,[r.us,r.canada,r.developed,r.emerging,r.us,0,0,r.bond,r.cash]);}
  const PROXY_FEES={
    US:{fee:.000945,url:'https://www.ssga.com/us/en/individual/etfs/state-street-spdr-sp-500-etf-trust-spy'},
    CA:{fee:.0006,url:'https://www.blackrock.com/ca/investors/en/literature/fact-sheet/xic-ishares-core-s-p-tsx-capped-composite-index-etf-fund-fact-sheet-en-ca.pdf'},
    DEV:{fee:.0032,url:'https://www.ishares.com/us/products/239623/ishares-msci-eafe-etf'},
    EM:{fee:.0072,url:'https://www.ishares.com/us/products/239637/ishares-msci-emerging-markets-etf'},
    XBB:{fee:.001,url:'https://www.blackrock.com/ca/investors/en/products/239493/ishares-canadian-universe-bond-index-etf'}
  };
  function returnAssumptions(H,end,basis='history'){
    const fallback={basis:'planning',requested:basis,rates:SOURCE,sourceName:'Repères prudents · Institut PF 2026',start:null,end:SOURCE.date,months:0,
      reason:basis==='history'?'Historique long incomplet : utilisation explicite des repères prudents.':null};
    if(basis==='planning')return fallback;
    const h=H?.forward_history,keys=Object.keys(PROXY_FEES);
    if(h?.currency!=='CAD'||h.total_return!==true||!Array.isArray(h.dates))return fallback;
    const valid=h.dates.flatMap((d,i)=>d<=end&&finite(month(d))&&keys.every(k=>validReturn(h.returns?.[k]?.[i]))?[i]:[]);
    let first=valid.length-1;while(first>0&&month(h.dates[valid[first]])-month(h.dates[valid[first-1]])===1)first--;
    const indices=valid.slice(Math.max(0,first));if(indices.length<120)return fallback;
    const net={},gross={};
    for(const k of keys){net[k]=Math.expm1(12*mean(indices.map(i=>Math.log1p(h.returns[k][i]))));gross[k]=(1+net[k])*Math.exp(PROXY_FEES[k].fee)-1;}
    return {basis:'history',requested:basis,sourceName:'Historique des marchés en CAD',start:h.dates[indices[0]],end:h.dates[indices.at(-1)],months:indices.length,
      rates:{us:gross.US,canada:gross.CA,developed:gross.DEV,emerging:gross.EM,bond:gross.XBB,cash:SOURCE.cash},net,
      feeAdjustment:{asOf:'2026-10-25',proxies:PROXY_FEES,method:'Approximation avant frais à partir des frais courants des proxys, supposés constants sur le passé; les frais historiques peuvent différer. Les frais actuels des FNB détenus sont ensuite déduits une fois.'},
      sourceUrls:h.source_urls,reason:null};
  }
  function aligned(input,dates,values){if(!Array.isArray(input)||input.length!==values?.length)return null;const m=new Map(input.map((d,i)=>[d,values[i]]));return dates.map(d=>m.get(d)??null);}
  function fundSeries(D,t,dates,H){
    const actual=aligned(D.universe.dates,dates,D.universe.returns[t]);
    if(actual?.every(validReturn))return {values:actual,classification:'observed',months:actual.length,source:D.source_urls?.[t]||null,method:'Rendements totaux réels du FNB en CAD'};
    const index=H?.indices?.[t];
    if(index?.validated===true&&index.representative===true&&index.currency==='CAD'&&index.total_return===true&&index.source_url&&index.as_of<=H.as_of){
      const v=aligned(index.dates,dates,index.returns);if(v?.every(validReturn))return {values:v,classification:'reconstructed',months:actual?.filter(validReturn).length||0,source:index.source_url,method:'Indice représentatif validé; série de proxy, pas historique du FNB'};
    }
    let geo=D.universe.geo?.[t];const mer=D.universe.mer?.[t];
    if(Array.isArray(geo)&&geo.length===5){
      const equity=D.universe.equity?.[t],assets=['gold','crypto','bond','cash'].map(k=>D.universe[k]?.[t]);
      if(!finite(equity)||!assets.every(v=>finite(v)&&v>=0)||Math.abs(equity+assets.reduce((s,v)=>s+v,0)-1)>1e-6)return null;
      geo=[...geo.map(v=>v*equity),...assets];
    }
    // A declared geographic projection of CURRENT holdings, never an observed
    // pre-inception track record. Unknown countries >2% cannot be defended.
    if(!Array.isArray(geo)||geo.length!==9||geo.some(v=>!finite(v)||v<0)||Math.abs(geo.reduce((s,v)=>s+v,0)-1)>1e-6||geo[4]>.02||geo[6]>1e-6||!finite(mer))return null;
    const proxy=['VFV','VCN','XEF','VEE','VFV','CGL.C','',null,null];
    const values=dates.map((date,i)=>{
      let v=0;for(let k=0;k<9;k++)if(geo[k]>1e-10){
        let r;if(k===7)r=aligned(H?.model_factors?.dates,dates,H?.model_factors?.returns?.bond)?.[i];
        else if(k===8)r=Math.expm1(Math.log1p(SOURCE.cash)/12);
        else r=aligned(D.universe.dates,dates,D.universe.returns[proxy[k]])?.[i];
        if(!validReturn(r))return null;v+=geo[k]*r;
      }
      return v-mer/12;
    });
    return values.every(validReturn)?{values,classification:'modeled',months:actual?.filter(validReturn).length||0,source:D.source_urls?.[t]||null,method:'Projection géographique des expositions actuelles; styles, levier et couvertures non reconstruits'}:null;
  }
  function macroSnapshot(M,end){
    const wanted=['IR3TIB01CAM156N','VIXCLS','DGS10','V41690973','NYFEDRECPROB','NFCI','BAMLH0A0HYM2','T10Y2Y'];
    return (M?.series||[]).filter(s=>wanted.includes(s.id)&&finite(s.value)&&s.date<=end).map(s=>({id:s.id,title:s.title,date:s.date,value:s.value,unit:s.unit,url:s.source_url,stale:(new Date(end)-new Date(s.date))/86400000>s.max_age_days,status:s.fetch_status}));
  }
  function modelMeans(D,rows,options,assumptions={rates:SOURCE}){
    const reference=rows.findIndex(r=>r.id==='VEQT');if(reference<0)return null;
    const moments=Frontier.moments(rows.map(r=>r.returns),rows[reference].returns,SOURCE.cash),C=moments.covariance;
    if(C[reference][reference]<1e-12)return null;
    const market=anchor(rows[reference].geo,assumptions.rates),premium=market+.5*C[reference][reference]-SOURCE.cash;
    const prior=rows.map((r,i)=>C[i][reference]/C[reference][reference]*premium);
    const views=BENCHMARKS.map(id=>rows.findIndex(r=>r.id===id)).filter(i=>i>=0),P=views.map(index=>rows.map((_,j)=>j===index?1:0));
    const Q=views.map(i=>anchor(rows[i].geo,assumptions.rates)+.5*C[i][i]+options.equityView*rows[i].geo.slice(0,5).reduce((s,v)=>s+v,0)-SOURCE.cash);
    // View errors are correlated through shared geographic CMAs. The SE is an
    // explicit modelling assumption, NOT a measured confidence score.
    const omega=views.map(i=>views.map(j=>dot(rows[i].geo.map((v,k)=>v*(k===7?.5:k===8?.2:1)),rows[j].geo.map((v,k)=>v*(k===7?.5:k===8?.2:1)))*options.viewSE**2+(i===j?1e-8:0)));
    const bl=blackLitterman(C,prior,P,Q,omega,12/rows[0].returns.length);if(!bl)return null;
    return {...bl,covariance:C,reference,market,views:views.map(i=>rows[i].id),omega,
      annual:rows.map((r,i)=>SOURCE.cash+bl.mean[i]-r.mer)};
  }
  function prepare(D,H={},M={},options={}){
    const o={...defaults(),...options},dates=D?.universe?.dates;
    if(!Array.isArray(dates)||dates.length<24||dates.some((d,i)=>!finite(month(d))||(i&&month(d)!==month(dates[i-1])+1))||!D.results||!['history','planning'].includes(o.returnBasis)||!finite(o.recentCarry)||o.recentCarry<0||o.recentCarry>1||!finite(o.equityView)||Math.abs(o.equityView)>.1||!finite(o.viewSE)||o.viewSE<.005||o.viewSE>.15||!finite(o.volScale)||o.volScale<.5||o.volScale>2||![1,3,6,12].includes(o.blockLength))return {available:false,reason:'Données communes ou hypothèses prospectives invalides.'};
    const funds={},unavailable=[],rows=[];
    for(const [id,q] of Object.entries(D.results)){
      const w=q.weights,g=geography(q),parts=Object.entries(w||{});
      if(!g||!finite(q.mer)||q.mer<0||!parts.length||parts.some(([,v])=>!finite(v)||v<0)||Math.abs(parts.reduce((s,[,v])=>s+v,0)-1)>1e-6){unavailable.push({id,reason:'Expositions, frais ou poids non défendables; levier et positions vendeuses non pris en charge.'});continue;}
      for(const [t] of parts)if(!(t in funds))funds[t]=fundSeries(D,t,dates,H);
      if(parts.some(([t])=>!funds[t])){unavailable.push({id,reason:'Source réelle, indice validé ou projection des expositions insuffisante pour une position.'});continue;}
      const returns=dates.map((_,i)=>parts.reduce((s,[t,v])=>s+v*funds[t].values[i],0));
      const coverage={observed:0,reconstructed:0,modeled:0,insufficient:0};parts.forEach(([t,w])=>coverage[funds[t].classification]+=w);
      const historicalMer=parts.every(([t])=>finite(D.universe.mer?.[t]))?parts.reduce((s,[t,w])=>s+w*D.universe.mer[t],0):q.mer;
      rows.push({id,geo:g,mer:q.mer,historicalMer,returns,coverage,funds:parts.map(([t,w])=>({ticker:t,weight:w,...funds[t],values:undefined}))});
    }
    const assumptions=returnAssumptions(H,dates.at(-1),o.returnBasis),means=modelMeans(D,rows,o,assumptions);if(!means)return {available:false,reason:'Ancrage de marché ou matrice Black-Litterman non estimable.',unavailable};
    const byDate=new Map((H.forward_history?.dates||[]).map((d,i)=>[d,i])),long=H.forward_history,marketGeo=D.results.VEQT.geo_total;
    const coreAt=(date)=>{
      const i=byDate.get(date),x=long?.returns;if(i===undefined||!x)return null;
      const r=['US','CA','DEV','EM','XBB','XCB','XGB','FX'].map(k=>x[k]?.[i]);if(!r.every(validReturn))return null;
      const market=dot(marketGeo.slice(0,4),r.slice(0,4))+marketGeo[4]*r[0];
      return [Math.log1p(market),Math.log1p(r[4]),Math.log1p(r[5])-Math.log1p(r[6]),Math.log1p(r[7])];
    };
    const longDates=(long?.currency==='CAD'&&long?.total_return===true?long.dates:[]).filter(d=>d<=dates.at(-1)&&coreAt(d));
    // Retain the longest contiguous suffix; never close a gap by pretending
    // that two non-adjacent months were consecutive block observations.
    let first=longDates.length-1;while(first>0&&month(longDates[first])-month(longDates[first-1])===1)first--;
    const validLong=longDates.slice(Math.max(0,first)),currentCore=dates.map(coreAt),useLong=validLong.length>=120&&currentCore.every(Boolean)&&dates.length>=36;
    const core=useLong?validLong.map(coreAt):[],coreMeans=useLong?core[0].map((_,i)=>mean(core.map(x=>x[i]))):[];
    const centeredCore=core.map(x=>x.map((v,i)=>v-coreMeans[i]));
    const m=macroSnapshot(M,H.as_of||D.assumptions?.as_of||dates.at(-1)+'-28'),vix=m.find(s=>s.id==='VIXCLS'&&!s.stale),us=D.universe.returns.VFV;
    const recentUS=Array.isArray(us)&&us.slice(-12).every(validReturn)?Math.sqrt(variance(us.slice(-12))*12):null;
    const initialVol=vix&&recentUS>0?Math.max(.75,Math.min(1.5,vix.value/100/recentUS)):1;
    const styleIds=['market','value','growth','momentum','quality','lowvol','rates','credit','fx'];
    const u=D.universe.returns,extra=H.model_factors;
    const styleX=dates.map((d,i)=>[u.VEQT?.[i],u.VVL?.[i]-u.VEQT?.[i],u.ZNQ?.[i]-u.VFV?.[i],u.VMO?.[i]-u.VEQT?.[i],u.FCUQ?.[i]-u.VFV?.[i],u.FCUL?.[i]-u.VFV?.[i],...['bond','credit','fx'].map(k=>aligned(extra?.dates,dates,extra?.returns?.[k])?.[i])]);
    for(let j=0;j<rows.length;j++){
      const row=rows[j],logs=row.returns.map(Math.log1p),c=center(logs),fit=useLong?F.regress(currentCore,logs):null;
      row.mean=means.annual[j];row.meanSE=Math.sqrt(Math.max(0,means.uncertainty[j][j]));row.beta=means.covariance[j][means.reference]/means.covariance[means.reference][means.reference];
      row.pastAnnual=D.results[row.id].cagr??null;
      row.activeAvailable=dates.length>=36&&row.coverage.observed>1-1e-8;
      row.activeLogs=row.activeAvailable?logs.map((v,t)=>v+row.historicalMer/12-row.beta*(Math.log1p(rows[means.reference].returns[t])+rows[means.reference].historicalMer/12)-(1-row.beta)*Math.log1p(SOURCE.cash)/12):Array(dates.length).fill(0);
      row.activeAnnualLog=12*mean(row.activeLogs);
      row.viewResponse=dot(means.gain[j],means.views.map(id=>rows.find(r=>r.id===id).geo.slice(0,5).reduce((s,v)=>s+v,0)));
      row.noise=c;row.coreCoefficients=fit?.coefficients||null;row.residual=fit?center(fit.residual):c;row.coreR2=fit?.rSquared??null;row.coreVif=fit?.maxVif??null;
      const style=styleX.every(x=>x.every(finite))?F.regress(styleX,row.returns):null;
      row.exposures=style?styleIds.map((id,i)=>({id,value:style.coefficients[i],se:style.standardErrors[i],significant:Math.abs(style.coefficients[i])>1.96*style.standardErrors[i]})):[];
      row.factorReason=style?null:'Neuf sensibilités conjointes non identifiables (taille ou colinéarité); aucune prime de style future inventée.';
      row.annualLogVariance=fit?12*(variance(row.residual)+variance(core.map(x=>dot(fit.coefficients,x)))):12*variance(c);
      const marketNoise=useLong?core.map(x=>x[0]):center(rows[means.reference].returns.map(Math.log1p));
      const marketCov=fit?cov(core.map(x=>dot(fit.coefficients,x)),marketNoise):cov(c,marketNoise);
      const mixedVariance=.25*row.annualLogVariance/12+.25*row.beta**2*variance(marketNoise)+.5*row.beta*marketCov;
      row.correlationScale=mixedVariance>1e-14?Math.sqrt(row.annualLogVariance/12/mixedVariance):1;
    }
    const L=cholesky(means.uncertainty);if(!L)return {available:false,reason:'Incertitude Black-Litterman non définie positive.'};
    return {available:true,version:VERSION,dates,start:dates[0],end:dates.at(-1),source:SOURCE,returnSource:assumptions,historyInput:H.forward_history||null,options:o,rows,unavailable,macro:m,initialVol,
      means:{prior:means.prior,views:means.views,omega:means.omega,tau:means.tau,covariance:means.uncertainty,cholesky:L},
      core:centeredCore,coreDates:useLong?validLong:[],longAvailable:useLong,
      regimes:{estimated:false,labels:['Expansion','Ralentissement','Récession','Crise'],reason:'Quatre régimes économiques et leurs transitions ne sont pas identifiables avec cet historique commun. Repli : bootstrap joint de blocs, sans probabilités de régime inventées.'},
      limitations:[
        'Fréquences conditionnelles au modèle, non probabilités futures calibrées. Le nombre de simulations réduit seulement le bruit numérique.',
        assumptions.basis==='history'?'Les moyennes de marché depuis '+assumptions.start+' sont prolongées comme hypothèse, pas comme prévision certaine. Le choix de la période historique change le résultat.':'Repères de planification 2026 pour 10 ans ou plus; à 2 et 5 ans, leur application est une hypothèse prudente.',
        'Équilibre de référence via VEQT, proxy global avec biais canadien, pas portefeuille de marché mondial exhaustif. Vues géographiques corrélées VFV/FEQT/VEQT, pas trois informations indépendantes.',
        'Valorisations et bénéfices prévisionnels non disponibles dans les sources actuelles : aucune vue automatique fondée sur ces données. Primes futures de style et de change nulles par défaut.',
        useLong?'Risques de marché/taux/crédit/change reconstruits via proxys CAD depuis '+validLong[0]+', expositions actuelles, résidus joints récents. Risques de style et ruptures d’exposition en crise peuvent manquer.':'Échantillon récent seulement : les crises absentes ne peuvent être calibrées. Pas de queues normales imposées, mais les événements hors historique peuvent être sous-estimés.',
        'Frais internes inclus une fois dans le nouveau rendement prospectif. CAD nominal, distributions réinvesties; impôts, courtage, versements et retraits exclus. Poids actuels constants, modèle de rendements mensuels agrégés.',
        'Drawdowns mesurés aux fins de mois : les baisses intramensuelles peuvent être plus profondes. Projections géographiques et modèles statistiques ne sont jamais des historiques réels de FNB.'
      ]};
  }
  function simulate(p,years,{paths=PATHS,seed=251026,ids=null,scenario='central',internal=false}={}){
    if(!p?.available||!HORIZONS.includes(Number(years))||!Number.isInteger(paths)||paths<(internal?100:PATHS)||paths>100000)return {available:false,reason:p?.reason||'Au moins 25 000 trajectoires sont requises.'};
    years=Number(years);const chosen=ids?new Set([...ids,...BENCHMARKS]):null,indices=p.rows.flatMap((r,i)=>!chosen||chosen.has(r.id)?[i]:[]),rows=indices.map(i=>p.rows[i]);
    const n=rows.length,months=years*12,ref=rows.findIndex(r=>r.id==='VFV'),marketIndex=rows.findIndex(r=>r.id==='VEQT'),L=p.means.cholesky,block=p.options.blockLength;
    if(ref<0||!n)return {available:false,reason:'VFV ou candidats indisponibles.'};
    const terminal=rows.map(()=>[]),drawdowns=rows.map(()=>[]),oneYear=rows.map(()=>[]),fan=rows.map(()=>Array.from({length:years},()=>[])),paired=rows.map(()=>Object.fromEntries(BENCHMARKS.map(b=>[b,[]])));
    const vol=p.options.volScale*(scenario==='volatility'?1.25:1),shift=scenario==='lower'?-p.options.viewSE:scenario==='higher'?p.options.viewSE:0;
    const long=!!p.core?.length,coeff=rows.map(r=>r.coreCoefficients),baseVar=rows.map(r=>r.annualLogVariance/12);
    for(let path=0;path<paths;path++){
      const random=rng(seed+Math.imul(path+1,2654435761)),z=p.rows.map(()=>normal(random));
      const delta=indices.map(i=>p.options.parameterUncertainty?dot(L[i],z):0),wealth=new Float64Array(n),peak=new Float64Array(n),dd=new Float64Array(n);let base=0,longBase=0;
      // This is a user-defined persistence SCENARIO, not a claim of alpha.
      // Joint block resampling retains uncertainty in the estimated advantage.
      // A separate random stream keeps market paths paired across assumptions.
      const alpha=new Float64Array(n);
      if(p.options.recentCarry>0){
        const ar=rng((seed^0x51ed270b)+Math.imul(path+1,2654435761));let k=0;
        for(let t=0;t<p.dates.length;t++){
          if(t%block===0)k=Math.floor(ar()*p.dates.length);
          for(let j=0;j<n;j++)alpha[j]+=rows[j].activeLogs[(k+t%block)%p.dates.length]/p.dates.length;
        }
      }
      for(let t=0;t<months;t++){
        if(t%block===0){base=Math.floor(random()*p.dates.length);longBase=long?Math.floor(random()*p.core.length):0;}
        const k=(base+t%block)%p.dates.length,c=long?p.core[(longBase+t%block)%p.core.length]:null;
        const scale=vol*(1+(p.initialVol-1)*Math.exp(-t/12));
        for(let j=0;j<n;j++){
          const r=rows[j],noise=c&&coeff[j]?dot(coeff[j],c)+r.residual[k]:r.noise[k];
          const correlated=scenario==='correlation'?(.5*noise+.5*r.beta*(c?c[0]:rows[marketIndex].noise[k]))*r.correlationScale:noise;
          const target=Math.max(-.8,r.mean+delta[j]+shift*r.viewResponse);
          let step=Math.log1p(target)/12-baseVar[j]*scale*scale/2+correlated*scale+p.options.recentCarry*alpha[j]*Math.exp(-Math.LN2*t/24);
          if(scenario==='crisis'&&t===0)step+=Math.log1p(-Math.min(.8,Math.max(0,.35*r.beta)));
          wealth[j]+=step;peak[j]=Math.max(peak[j],wealth[j]);dd[j]=Math.min(dd[j],wealth[j]-peak[j]);
          if((t+1)%12===0){const w=Math.expm1(wealth[j]);fan[j][(t+1)/12-1].push(w);if(t===11)oneYear[j].push(w);}
        }
      }
      for(let j=0;j<n;j++){
        terminal[j].push(Math.expm1(wealth[j]));drawdowns[j].push(-Math.expm1(dd[j]));
        for(const b of BENCHMARKS){const k=rows.findIndex(r=>r.id===b);if(k>=0)paired[j][b].push(Math.expm1(wealth[j]/years)-Math.expm1(wealth[k]/years));}
      }
    }
    const result=rows.map((r,j)=>{
      const v=sorted(terminal[j]),d=sorted(drawdowns[j]),cagr=v.map(v=>Math.expm1(Math.log1p(v)/years)),probs={};
      for(const b of BENCHMARKS){const a=paired[j][b];probs[b]=a.length?{probability:a.filter(x=>x>1e-12).length/paths,tie:a.filter(x=>Math.abs(x)<=1e-12).length/paths,expectedAnnualGap:mean(a),p10:quantile(sorted(a),.1),p90:quantile(sorted(a),.9)}:null;}
      const s=Math.sqrt(variance(oneYear[j])),median=quantile(v,.5);
      return {id:r.id,isBenchmark:BENCHMARKS.includes(r.id),mer:r.mer,beta:r.beta,pastAnnual:r.pastAnnual,activeAvailable:r.activeAvailable,recentAlphaAnnual:Math.expm1(r.activeAnnualLog),meanAnchor:r.mean,meanSE:r.meanSE,meanBand:[r.mean-1.96*r.meanSE,r.mean+1.96*r.meanSE],
        expectedAnnual:mean(cagr),medianAnnual:Math.expm1(Math.log1p(median)/years),median,p10:quantile(v,.1),p90:quantile(v,.9),futureValue:100000*(1+median),expectedFutureValue:100000*(1+mean(v)),
        positiveProbability:v.filter(x=>x>0).length/paths,lossProbability:v.filter(x=>x<0).length/paths,
        targets:Object.fromEntries([.08,.10,.15].map(t=>[String(t),cagr.filter(x=>x>=t).length/paths])),
        terminalLoss:Object.fromEntries([.2,.3,.4].map(t=>[String(t),v.filter(x=>x<=-t).length/paths])),
        drawdownProbability:Object.fromEntries([.2,.3,.4].map(t=>[String(t),d.filter(x=>x>=t).length/paths])),
        drawdown90:quantile(d,.9),drawdownMedian:quantile(d,.5),benchmarks:probs,beatProbability:probs.VFV?.probability??null,projectedSharpe:s>1e-12?(mean(oneYear[j])-SOURCE.cash)/s:null,
        coverage:r.coverage,exposures:r.exposures,factorReason:r.factorReason,
        fan:[{year:0,p10:0,median:0,p90:0},...fan[j].map((x,i)=>{const a=sorted(x);return {year:i+1,p10:quantile(a,.1),median:quantile(a,.5),p90:quantile(a,.9)};})]};
    });
    const comparisons=[];
    for(let j=0;j<rows.length;j++)for(let k=j+1;k<rows.length;k++){
      const i=indices[j],l=indices[k],difference=rows[j].mean-rows[k].mean,se=Math.sqrt(Math.max(0,p.means.covariance[i][i]+p.means.covariance[l][l]-2*p.means.covariance[i][l]));
      comparisons.push({a:rows[j].id,b:rows[k].id,difference,se,low:difference-1.96*se,high:difference+1.96*se,scope:'base_without_assumed_alpha',indistinguishable:p.options.recentCarry>0?null:Math.abs(difference)<=1.96*se+1e-12});
    }
    return {available:true,version:VERSION,years,paths,seed,scenario,rows:result,comparisons,source:p.source,returnSource:p.returnSource,options:p.options,regimes:p.regimes,macro:p.macro,start:p.start,end:p.end,coreStart:p.coreDates[0]||null,coreEnd:p.coreDates.at(-1)||null,limitations:p.limitations};
  }
  function sensitivity(p,years,ids){
    const scenarios=['central','lower','higher','volatility','correlation','crisis'];
    const results=scenarios.map(scenario=>simulate(p,years,{paths:2500,ids,scenario,internal:true}));
    return {paths:2500,scenarios:scenarios.map((id,i)=>({id,rows:results[i].rows})),rows:results[0].rows.map(r=>{
      const list=results.slice(0,5).map(s=>s.rows.find(x=>x.id===r.id));
      return {id:r.id,medianAnnual:range(list.map(r=>r.medianAnnual)),positiveProbability:range(list.map(r=>r.positiveProbability)),beatProbability:range(list.map(r=>r.beatProbability)),drawdown30:range(list.map(r=>r.drawdownProbability['0.3'])),crisis:results[5].rows.find(x=>x.id===r.id)};
    }),method:'Bornes de sensibilité, pas intervalles calibrés : vues actions ± leur erreur-type déclarée, volatilité +25 %, mélange 50 % vers le marché commun à variance marginale préservée; crise initiale −35 % × bêta testée séparément, sans probabilité attribuée.'};
  }
  function walkForward(p,D){
    const origins=[];for(let t=24;t<p.dates.length;t++)origins.push(t);
    const ref=p.rows.find(r=>r.id==='VEQT'),records=[];
    for(const t of origins){
      const trainRows=p.rows.map(r=>({...r,returns:r.returns.slice(0,t)})),b=ref.returns.slice(0,t),bm=mean(b),hasViews=p.options.returnBasis==='history'||p.dates[t]>SOURCE.date.slice(0,7);
      const assumptions=returnAssumptions({forward_history:p.historyInput},p.dates[t-1],p.options.returnBasis);
      const hybrid=hasViews&&(p.options.returnBasis!=='history'||assumptions.basis==='history')?modelMeans(D,trainRows,p.options,assumptions):null;
      for(let j=0;j<p.rows.length;j++){
        const row=p.rows[j],train=row.returns.slice(0,t),beta=F.beta(train,b),baseline=mean(train),market=beta*bm;
        const predictions={historical_mean:baseline,market_only:market};
        if(hybrid){const active=t>=36&&row.coverage.observed>1-1e-8?mean(train.map((v,i)=>Math.log1p(v)+row.historicalMer/12-beta*(Math.log1p(b[i])+ref.historicalMer/12)-(1-beta)*Math.log1p(SOURCE.cash)/12)):0;predictions.hybrid=hybrid.annual[j]/12+p.options.recentCarry*active;}
        for(const [model,estimate] of Object.entries(predictions)){
          const residual=sorted(train.map(x=>x-baseline)),observed=row.returns[t],lo=estimate+quantile(residual,.1),hi=estimate+quantile(residual,.9),prob=residual.filter(v=>v+estimate>0).length/residual.length;
          records.push({id:row.id,model,origin:p.dates[t-1],date:p.dates[t],trainMonths:t,estimate,observed,coverage:observed>=lo&&observed<=hi,brier:(prob-(observed>0?1:0))**2});
        }
      }
    }
    const rows=p.rows.map(r=>({id:r.id,models:['historical_mean','market_only','hybrid'].map(model=>{
      const eligible=new Set(records.filter(v=>v.model==='hybrid').map(v=>v.date));
      const x=records.filter(v=>v.id===r.id&&v.model===model&&eligible.has(v.date));if(!x.length)return {model,observations:0};
      return {model,observations:x.length,rmse:Math.sqrt(mean(x.map(v=>(v.observed-v.estimate)**2))),mae:mean(x.map(v=>Math.abs(v.observed-v.estimate))),brier:mean(x.map(v=>v.brier)),coverage:mean(x.map(v=>Number(v.coverage))),start:x[0].date,end:x.at(-1).date};
    })}));
    return {rows,records,longHorizonCalibrated:false,method:'Prévision du mois suivant, avec au moins 24 mois antérieurs. Les trois modèles utilisent les mêmes mois de test. Les repères historiques sont recalculés à chaque date avec les seuls prix alors disponibles; les repères FP 2026 sont utilisés seulement après avril 2026. Macro actuelle désactivée. Poids et frais actuels : ce rejeu ne valide pas la sélection passée des portefeuilles.',limits:'Test trop court pour valider les probabilités à 2, 5 ou 10 ans. Aucune supériorité prévisionnelle démontrée.'};
  }
  const CRITERIA={historical:[['annualReturn',1,'Rendement'],['sharpe',1,'Sharpe'],['maxDrawdown',1,'Recul maximal'],['cvar',-1,'CVaR'],['mer',-1,'Frais']],forward:[['medianAnnual',1,'Rendement médian'],['p10',1,'Scénario P10'],['lossProbability',-1,'Perte finale'],['drawdown90',-1,'Recul pendant l’horizon'],['beatProbability',1,'Surperformance / VFV'],['mer',-1,'Frais']]};
  function global(rows,scope='historical'){
    const candidates=rows.filter(r=>!r.isBenchmark),criteria=CRITERIA[scope]||CRITERIA.historical,used=criteria.filter(([k])=>candidates.every(r=>finite(r[k])));
    const dominates=(a,b)=>used.length>=3&&used.every(([k,s])=>s*(a[k]-b[k])>=-1e-10)&&used.some(([k,s])=>s*(a[k]-b[k])>1e-10);
    const comparisons=candidates.map(r=>({id:r.id,dominatedBy:candidates.filter(o=>o.id!==r.id&&dominates(o,r)).map(o=>o.id),strengths:used.filter(([k,s])=>candidates.every(o=>s*(r[k]-o[k])>=-1e-10)).map(c=>c[2])}));
    const remaining=[...candidates],rank=new Map();let layer=1;
    while(remaining.length){const front=remaining.filter(r=>!remaining.some(o=>o.id!==r.id&&dominates(o,r)));if(!front.length)break;front.forEach(r=>rank.set(r.id,layer));for(let i=remaining.length-1;i>=0;i--)if(front.includes(remaining[i]))remaining.splice(i,1);layer++;}
    return {available:used.length>=3,front:comparisons.filter(c=>!c.dominatedBy.length).map(c=>c.id),comparisons,ranks:rank,criteria:used.map(c=>c[2]),missing:criteria.filter(c=>!used.includes(c)).map(c=>c[2]),method:'Classement global par dominance multicritère, sans score pondéré : un candidat ne précède un autre que s’il est au moins aussi bon sur tous les critères et meilleur sur au moins un. Plusieurs compromis peuvent partager le premier rang.'};
  }
  function ranking(rows,goal){
    if(goal==='global')return global(rows,'forward').ranks;
    const key={growth:'medianAnnual',balance:'projectedSharpe',protection:'drawdown90'}[goal];if(!key)return new Map();
    const list=rows.filter(r=>!r.isBenchmark&&finite(r[key])).sort((a,b)=>(a[key]-b[key])*(goal==='protection'?1:-1));let rank=0,last=null;
    return new Map(list.map((r,i)=>{if(last===null||Math.abs(r[key]-last)>1e-10)rank=i+1;last=r[key];return [r.id,rank];}));
  }
  function run(D,H,M,options,years,ids){
    const p=prepare(D,H,M,options);if(!p.available)return p;
    const forecast=simulate(p,years,{ids}),s=sensitivity(p,years,ids),v=walkForward(p,D);
    return {...forecast,sensitivity:s,validation:v,unavailable:p.unavailable};
  }
  return {VERSION,PATHS,HORIZONS,BENCHMARKS,SOURCE,defaults,returnAssumptions,prepare,simulate,sensitivity,walkForward,blackLitterman,cholesky,global,ranking,run};
});
