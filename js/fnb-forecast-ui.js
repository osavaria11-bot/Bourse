'use strict';
window.SavyFnbForward=(()=>{
  const F=window.SavyFnbForecast,root=new URL('../',document.currentScript.src),version='20261025-forward-v2';
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number=(v,d=1)=>Number.isFinite(v)?new Intl.NumberFormat('fr-CA',{minimumFractionDigits:d,maximumFractionDigits:d}).format(v):'—';
  const pct=(v,d=1)=>Number.isFinite(v)?number(v*100,d)+' %':'—',prob=v=>pct(v,0),pp=v=>(v>0?'+':'')+number(v*100,1)+' pp';
  const money=v=>new Intl.NumberFormat('fr-CA',{style:'currency',currency:'CAD',currencyDisplay:'narrowSymbol',maximumFractionDigits:0}).format(v);
  const interval=(a,format=pct)=>a?'['+format(a[0])+' ; '+format(a[1])+']':'—';
  const hash=s=>{let n=2166136261;for(let i=0;i<s.length;i++)n=Math.imul(n^s.charCodeAt(i),16777619);return (n>>>0).toString(36);};
  function start(D,H,context){
    const $=id=>document.getElementById(id),label=context.label,cache=new Map();let options=F.defaults(),worker=null,generation=0,pending='',current=null,M={};
    try{M=JSON.parse($('fnbForecastMacro').textContent);}catch{}
    try{const saved=JSON.parse(localStorage.getItem('savy:fnb-forward:v1')||'null');if(saved)options={...options,...saved};}catch{}
    const fingerprint=hash(JSON.stringify([D.universe,Object.values(D.results).map(r=>[r.id,r.weights,r.mer,r.geo_total]),H,M]));
    function fields(){for(const [id,key,scale] of [['forecastEquityView','equityView',100],['forecastViewSE','viewSE',100],['forecastVolScale','volScale',1],['forecastBlock','blockLength',1]])$(id).value=String(options[key]*scale);}
    fields();
    function visible(active){
      for(const id of ['decisionForecastDetails','decisionForecastMethod','decisionForecastStatus'])$(id).hidden=!active;
      for(const id of ['decisionDetails','decisionMethod'])$(id).hidden=active;
      document.querySelectorAll('.decision-perspectives').forEach(el=>el.hidden=active);
    }
    function pause(){
      visible(false);if(worker){worker.terminate();worker=null;}if(pending){generation++;pending='';}
      $('decisionPanel').removeAttribute('aria-busy');
    }
    function selectors(row){
      if(row.isBenchmark)return '<b>'+esc(label(row.id))+'</b><small>'+esc(row.id==='VFV'?'S&P 500 · CAD':row.id)+' · benchmark simulé</small>';
      const selected=context.selected(),chosen=selected.indexOf(row.id);
      return '<div class="decision-selector"><select data-decision-choice="'+chosen+'" aria-label="Candidat '+(chosen+1)+'">'+context.allowed().map(id=>'<option value="'+esc(id)+'"'+(id===row.id?' selected':'')+(selected.includes(id)&&id!==row.id?' disabled':'')+'>'+esc(label(id))+'</option>').join('')+'</select><div class="decision-actions"><button type="button" data-decision-open="'+esc(row.id)+'">Fiche</button><button type="button" data-decision-risk="'+esc(row.id)+'">Risque</button></div></div>';
    }
    function renderResult(a){
      current=a;const ids=context.selected(),ref=context.reference(),rows=a.rows.map(r=>({...r,isBenchmark:r.isBenchmark||r.id===ref}));
      const goal=$('decisionGoal').value,ranking=F.ranking(rows,goal),global=F.global(rows,'forward'),own=rows.filter(r=>!r.isBenchmark),leaders=own.filter(r=>ranking.get(r.id)===1),best=key=>[...own].sort((a,b)=>b[key]-a[key])[0];
      const ordered=[...ids.map(id=>rows.find(r=>r.id===id)).filter(Boolean),...rows.filter(r=>r.isBenchmark&&!ids.includes(r.id)).sort((a,b)=>['VFV','FEQT','VEQT',ref].indexOf(a.id)-['VFV','FEQT','VEQT',ref].indexOf(b.id))];
      $('decisionHead').innerHTML='<tr><th scope="col">Candidats à comparer</th><th scope="col">Rendement annualisé<small>Espérance / médiane</small></th><th scope="col">Valeur future médiane<small>P10–P90 · capital comparé</small></th><th scope="col">Battre le S&P 500<small>VFV · CAD · fréquence simulée</small></th><th scope="col">Recul ≥30 %<small>Pendant '+a.years+' ans · fins de mois</small></th><th scope="col">RFG annuel</th><th scope="col">Rang central<small>Selon l’objectif et les hypothèses</small></th></tr>';
      $('decisionBody').innerHTML=ordered.map(row=>{
        const s=a.sensitivity.rows.find(x=>x.id===row.id),rank=ranking.get(row.id),g=global.comparisons.find(x=>x.id===row.id),limit=context.limit();
        return '<tr data-decision-row="'+esc(row.id)+'"'+(row.isBenchmark?' class="benchmark"':'')+'><th scope="row">'+selectors(row)+(row.coverage.modeled>0?'<small class="decision-warning">Expositions modélisées : '+prob(row.coverage.modeled)+'</small>':'')+'</th><td>'+pct(row.expectedAnnual)+'<small>Médiane '+pct(row.medianAnnual)+'</small></td><td data-forward-value="'+esc(row.id)+'">'+money(context.capital()*(1+row.median))+'<small>'+interval([context.capital()*(1+row.p10),context.capital()*(1+row.p90)],money)+'</small></td><td>'+ (row.id==='VFV'?'Référence':prob(row.benchmarks.VFV?.probability))+(row.id!=='VFV'?'<small>Sensibilité '+interval(s?.beatProbability,prob)+'</small>':'')+'</td><td>'+prob(row.drawdownProbability['0.3'])+'<small>Perte finale ≥30 % : '+prob(row.terminalLoss['0.3'])+'</small>'+(limit!==null&&row.drawdown90>limit?'<small class="decision-warning">Recul P90 au-delà du seuil personnel</small>':'')+'</td><td>'+pct(row.mer,2)+'</td><td class="'+(rank===1?'decision-best':'')+'">'+(rank?'Rang '+rank:'—')+'<small>'+esc(row.isBenchmark?'':goal==='global'?g?.strengths.slice(0,2).join(' · ')||'Compromis':goal==='growth'?'Rendement médian':goal==='balance'?'Sharpe simulé à 1 an':goal==='protection'?'Recul P90':'Sans préférence')+'</small>'+(!row.isBenchmark&&a.comparisons.some(c=>(c.a===row.id||c.b===row.id)&&ids.includes(c.a)&&ids.includes(c.b)&&c.indistinguishable)?'<small>Écart de rendement incertain</small>':'')+'</td></tr>';
      }).join('');
      const missing=ids.filter(id=>!rows.some(r=>r.id===id));
      for(const id of missing){const reason=a.unavailable?.find(r=>r.id===id)?.reason||'Données insuffisantes pour cette projection.';$('decisionBody').insertAdjacentHTML('afterbegin','<tr data-decision-row="'+esc(id)+'"><th>'+selectors({id,isBenchmark:false})+'</th><td colspan="6" class="decision-warning">'+esc(reason)+'</td></tr>');}
      const uncertain=a.comparisons.filter(c=>ids.includes(c.a)&&ids.includes(c.b)&&c.indistinguishable),growth=best('medianAnnual'),beat=best('beatProbability');
      const choice=goal==='global'?'Compromis non dominés : '+global.front.map(label).join(', ')+'. '+(global.front.length>1?'Aucun candidat ne domine les autres sur tous les critères. ':'Ce rang dépend des hypothèses choisies. '):leaders.length?'En tête sur ce critère : '+leaders.map(r=>label(r.id)).join(', ')+'. ':'Compare les résultats sans imposer de préférence. ';
      $('decisionReading').innerHTML='<strong id="decisionResultTitle">Projection conditionnelle à '+a.years+' ans</strong><div class="decision-result-lines"><p data-result-choice><b>Lecture globale</b>'+esc(choice)+(uncertain.length?'<small>Rendements attendus difficiles à départager pour '+uncertain.length+' paire(s), selon l’incertitude des vues.</small>':'')+'</p><p id="decisionHorizonResult"><b>Rendement et référence</b>'+esc(growth?label(growth.id)+' affiche la médiane la plus élevée : '+pct(growth.medianAnnual)+' / an. ':'')+esc(beat?label(beat.id)+' présente la fréquence la plus élevée de dépassement de VFV : '+prob(beat.beatProbability)+'.':'')+'</p><p data-result-risk><b>La baisse en cours de route compte</b>Le risque de recul est distinct d’une perte à l’échéance. Les fréquences dépendent des hypothèses; elles restent non calibrées à '+a.years+' ans.</p></div>';
      $('decisionPeriod').textContent='25 000 trajectoires communes · '+a.years+' ans · CAD nominal, distributions réinvesties et frais inclus · capital comparé '+money(context.capital())+'.';
      $('decisionForecastStatus').textContent=(missing.length?missing.length+' candidat(s) non estimable(s). ':'')+'Probabilités conditionnelles · calibration à long terme non établie · '+(a.coreStart?'proxys de risque '+a.coreStart+' → '+a.coreEnd:'historique récent seulement')+'.';
      $('decisionDataStatus').textContent='Calibration des expositions : '+a.start+' → '+a.end+'. '+a.regimes.reason+(H.status==='stale'?' Sources de stress périmées.':'')+(a.macro.some(s=>s.stale)?' Certaines données macro sont périmées.':'');
      details(a,ordered);$('decisionPanel').dataset.forecastReady='true';$('decisionPanel').dataset.ready='true';$('decisionPanel').removeAttribute('aria-busy');
    }
    function details(a,rows){
      $('decisionForecastMetrics').innerHTML='<h3>Lire les résultats à '+a.years+' ans</h3><p>P10/P90 encadrent 80 % des trajectoires de ce modèle. Ils incluent une incertitude persistante des moyennes Black-Litterman, conditionnelle à l’erreur des vues. Ce ne sont pas des bornes garanties ni des intervalles calibrés sur le futur.</p>'+rows.map(r=>'<details class="forecast-row"><summary>'+esc(label(r.id))+' · médiane '+pct(r.medianAnnual)+' / an</summary><p>Rendement annualisé attendu (moyenne des CAGR) '+pct(r.expectedAnnual)+'; médian '+pct(r.medianAnnual)+'. Cumulé P10 / P50 / P90 : '+pct(r.p10)+' / '+pct(r.median)+' / '+pct(r.p90)+'. Pour 100 000 $ : médiane '+money(r.futureValue)+', espérance '+money(r.expectedFutureValue)+'.</p><p>Rendement final positif : '+prob(r.positiveProbability)+'. Atteindre 8 / 10 / 15 % annualisés : '+[.08,.1,.15].map(t=>prob(r.targets[String(t)])).join(' / ')+'.</p><p>Reculs pendant la période ≥20 / 30 / 40 % : '+[.2,.3,.4].map(t=>prob(r.drawdownProbability[String(t)])).join(' / ')+'. Pertes finales ≥20 / 30 / 40 % : '+[.2,.3,.4].map(t=>prob(r.terminalLoss[String(t)])).join(' / ')+'.</p><p>'+F.BENCHMARKS.map(b=>b+': '+(b===r.id?'même trajectoire':prob(r.benchmarks[b]?.probability)+' de surperformance, écart annualisé moyen '+pp(r.benchmarks[b]?.expectedAnnualGap))).join(' · ')+'.</p><p>Ancrage arithmétique net '+pct(r.meanAnchor)+', plage conditionnelle des moyennes '+interval(r.meanBand)+'. Couverture des données d’exposition : observée '+prob(r.coverage.observed)+', indice reconstruit '+prob(r.coverage.reconstructed)+', modélisée '+prob(r.coverage.modeled)+'. Ce sont des projections futures dans tous les cas.</p>'+fan(r.fan)+'</details>').join('');
      const own=rows.filter(r=>!r.isBenchmark),names={historical_mean:'Moyenne historique',market_only:'Marché seul',hybrid:'Hybride / ancrages 2026'};
      $('decisionForecastValidation').innerHTML='<h3>Validation : ce qui a été testé</h3><p>'+esc(a.validation.method)+'</p><div class="table-wrap" tabindex="0"><table><thead><tr><th>Candidat / modèle</th><th>Mois testés</th><th>RMSE mensuelle</th><th>Brier · gain</th><th>Couverture P10–P90</th></tr></thead><tbody>'+own.flatMap(r=>(a.validation.rows.find(x=>x.id===r.id)?.models||[]).map(m=>'<tr><th>'+esc(label(r.id))+' · '+names[m.model]+'</th><td>'+m.observations+(m.start?'<small>'+m.start+' → '+m.end+'</small>':'')+'</td><td>'+pct(m.rmse,2)+'</td><td>'+number(m.brier,3)+'</td><td>'+prob(m.coverage)+'</td></tr>')).join('')+'</tbody></table></div><p class="decision-warning">'+esc(a.validation.limits)+'</p>';
      $('decisionForecastSensitivity').innerHTML='<h3>Résultats sensibles aux hypothèses</h3><p>'+esc(a.sensitivity.method)+' Les variantes utilisent 2 500 trajectoires appariées chacune; le scénario central en utilise 25 000.</p>'+own.map(r=>{const s=a.sensitivity.rows.find(x=>x.id===r.id);return '<p><b>'+esc(label(r.id))+'</b> · rendement médian annualisé '+interval(s.medianAnnual)+'; battre VFV '+interval(s.beatProbability,prob)+'; recul ≥30 % '+interval(s.drawdown30,prob)+'. Avec crise initiale imposée : médiane '+pct(s.crisis.medianAnnual)+' / an, recul P90 '+pct(s.crisis.drawdown90)+'.</p>';}).join('')+'<p>'+esc(F.global(rows,'forward').method)+'</p>';
      $('decisionForecastFactors').innerHTML='<h3>Sensibilités estimées, primes de style futures nulles</h3>'+own.map(r=>'<p><b>'+esc(label(r.id))+'</b> · '+(r.exposures.length?r.exposures.map(f=>'<span class="'+(f.significant?'':'forecast-muted')+'" title="'+esc('Erreur-type HAC : '+number(f.se,3)+'; estimation conditionnelle, pas exposition certaine')+'">'+esc(f.id)+' '+number(f.value,2)+'</span>').join(' · '):esc(r.factorReason))+'.</p>').join('')+'<p>Growth : ZNQ−VFV, proxy technologique imparfait. Taux : XBB; crédit : XCB−XGB avec écart de duration; change : USD/CAD. Les sensibilités non significatives restent visibles et atténuées. Pas de régression forcée si taille ou colinéarité insuffisante.</p>';
      $('decisionForecastSources').innerHTML='<p><a href="'+a.source.url+'" target="_blank" rel="noopener noreferrer">Ancrages Institut PF / FP Canada 2026 ↗</a> · publiés le '+a.source.date+'. Actions CA 6,3 %, US 6,4 %, développés 6,6 %, émergents 7,5 %, obligations 3,2 %, liquidités 2,4 %, inflation 2,1 %; avant frais. Dans les vues des benchmarks : or / crypto à 0 % de croissance auxiliaire, hypothèse non sourcée; les rendements des portefeuilles résultent du posterior.</p><p>Black-Litterman : prior Π = δΣw, w via VEQT, δ déterminé par sa prime de référence. τ = 12 / nombre de mois, Ω corrélée selon les expositions géographiques et l’erreur-type déclarée. Les moyennes annuelles supposées sont tirées une fois par trajectoire; elles ne deviennent pas certaines à long terme. <a href="https://people.duke.edu/~charvey/Teaching/BA453_2002/GS_The_intuition_behind.pdf" target="_blank" rel="noopener noreferrer">He et Litterman, 1999 ↗</a>.</p><p>Conditions macro disponibles : '+a.macro.map(m=>'<a href="'+esc(m.url)+'" target="_blank" rel="noopener noreferrer">'+esc(m.title)+'</a> '+number(m.value,2)+' '+esc(m.unit)+' ('+esc(m.date)+(m.stale?', périmé':'')+')').join(' · ')+'. Le VIX récent ajuste temporairement la volatilité (ratio au risque US réalisé, borné 0,75–1,5, décroissance sur 12 mois); les autres observations sont du contexte, sans transformation automatique en rendement attendu.</p>'+a.limitations.map(s=>'<p>'+esc(s)+'</p>').join('')+'<p>Sources des proxys de risque : '+Object.entries(H.forward_history?.source_urls||{}).map(([t,url])=>'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+esc(t)+'</a>').join(' · ')+'. '+esc(H.forward_history?.method||'')+'</p>';
    }
    function fan(data){
      const lo=Math.min(0,...data.map(x=>x.p10)),hi=Math.max(.1,...data.map(x=>x.p90)),x=t=>8+t/data.at(-1).year*304,y=v=>66-(v-lo)/(hi-lo)*58;
      const points=k=>data.map(p=>x(p.year)+','+y(p[k])).join(' '),area=[...data.map(p=>x(p.year)+','+y(p.p90)),...data.slice().reverse().map(p=>x(p.year)+','+y(p.p10))].join(' ');
      return '<svg class="forecast-fan" viewBox="0 0 320 78" role="img" aria-label="Évolution des quantiles simulés P10, P50 et P90"><polygon points="'+area+'" fill="currentColor" opacity=".12"/><polyline points="'+points('median')+'" fill="none" stroke="currentColor" stroke-width="1.8"/><text x="8" y="77">0</text><text x="270" y="77">'+data.at(-1).year+' ans</text></svg>';
    }
    function failure(reason){pending='';worker?.terminate();worker=null;$('decisionForecastStatus').textContent=reason;$('decisionBody').textContent='';$('decisionReading').textContent='Projection non disponible pour ces paramètres. '+reason;$('decisionPanel').dataset.forecastReady='error';$('decisionPanel').removeAttribute('aria-busy');}
    function render(){
      visible(true);if(!$('decisionHorizon').value)$('decisionHorizon').value='5';
      const years=Number($('decisionHorizon').value),ids=[...new Set([...context.selected(),context.reference()])],key=F.VERSION+'|'+fingerprint+'|'+JSON.stringify([years,ids,options]);
      if(cache.has(key)){renderResult(cache.get(key));return;}
      try{const saved=JSON.parse(sessionStorage.getItem('savy:forecast:'+hash(key))||'null');if(saved?.key===key&&saved.result?.version===F.VERSION){cache.set(key,saved.result);renderResult(saved.result);return;}}catch{}
      if(pending===key)return;
      if(worker)worker.terminate();const id=++generation;pending=key;current=null;$('decisionPanel').dataset.forecastReady='loading';$('decisionPanel').setAttribute('aria-busy','true');
      $('decisionForecastStatus').textContent='Calcul de 25 000 trajectoires communes à '+years+' ans…';$('decisionReading').innerHTML='<strong>Calcul des projections</strong><p>Rendements, pertes en cours de route et surperformance sont recalculés sur cet horizon.</p>';$('decisionBody').textContent='';
      $('decisionPeriod').textContent='Projection à '+years+' ans en cours de calcul.';$('decisionDataStatus').textContent='Les résultats seront affichés avec leurs hypothèses et leurs limites.';
      const finish=result=>{
        if(id!==generation||$('decisionMode').value!=='forward')return;pending='';worker?.terminate();worker=null;
        if(!result?.available){failure(result?.reason||'Calcul indisponible.');return;}
        cache.set(key,result);if(cache.size>8)cache.delete(cache.keys().next().value);
        try{sessionStorage.setItem('savy:forecast:'+hash(key),JSON.stringify({key,result}));}catch{}
        renderResult(result);
      };
      const request={id,data:D,stress:H,macro:M,options,years,ids};
      try{
        worker=new Worker(new URL('js/fnb-forecast-worker.js?v='+version,root));
        worker.onmessage=e=>{if(e.data.id!==id||id!==generation||$('decisionMode').value!=='forward')return;e.data.error?failure(e.data.error):finish(e.data.result);};
        worker.onerror=()=>{if(id===generation)failure('Le moteur de calcul n’a pas pu être chargé; actualise la page.');};worker.postMessage(request);
      }catch{
        setTimeout(()=>{try{finish(F.run(D,H,M,options,years,ids));}catch(e){failure(e.message);}},0);
      }
    }
    document.addEventListener('click',e=>{
      if(e.target.id==='forecastApply'){
        options={...options,equityView:Number($('forecastEquityView').value)/100,viewSE:Number($('forecastViewSE').value)/100,volScale:Number($('forecastVolScale').value),blockLength:Number($('forecastBlock').value)};
        try{localStorage.setItem('savy:fnb-forward:v1',JSON.stringify(options));}catch{}render();
      }else if(e.target.id==='forecastReset'){options=F.defaults();fields();try{localStorage.removeItem('savy:fnb-forward:v1');}catch{}render();}
    });
    return {render,pause};
  }
  return {start};
})();
