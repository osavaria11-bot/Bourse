'use strict';
window.SavyFnbForward=(()=>{
  const F=window.SavyFnbForecast,root=new URL('../',document.currentScript.src),version='20261025-readable-v3';
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
    fields();$('forecastReturnBasis').value=options.returnBasis;$('forecastRecentCarry').value=String(options.recentCarry);
    function visible(active){
      $('decisionPanel').dataset.mode=active?'forward':'historical';
      $('forecastReturnField').hidden=!active;$('forecastBasisNote').hidden=!active;
      for(const id of ['decisionForecastDetails','decisionForecastMethod','decisionForecastStatus'])$(id).hidden=!active;
      for(const id of ['decisionDetails','decisionMethod'])$(id).hidden=active;
      document.querySelectorAll('.decision-perspectives').forEach(el=>el.hidden=active);
    }
    function pause(){
      visible(false);if(worker){worker.terminate();worker=null;}if(pending){generation++;pending='';}
      $('decisionPanel').removeAttribute('aria-busy');
    }
    function selectors(row){
      if(row.isBenchmark)return '<b>'+esc(label(row.id))+'</b>';
      const selected=context.selected(),chosen=selected.indexOf(row.id);
      return '<div class="decision-selector"><select data-decision-choice="'+chosen+'" aria-label="Candidat '+(chosen+1)+'">'+context.allowed().map(id=>'<option value="'+esc(id)+'"'+(id===row.id?' selected':'')+(selected.includes(id)&&id!==row.id?' disabled':'')+'>'+esc(label(id))+'</option>').join('')+'</select><div class="decision-actions"><button type="button" data-decision-open="'+esc(row.id)+'">Fiche</button><button type="button" data-decision-risk="'+esc(row.id)+'">Risque</button></div></div>';
    }
    function renderResult(a){
      current=a;const ids=context.selected(),ref=context.reference(),rows=a.rows.map(r=>({...r,isBenchmark:r.isBenchmark||r.id===ref})),own=rows.filter(r=>!r.isBenchmark);
      const ordered=[...ids.map(id=>rows.find(r=>r.id===id)).filter(Boolean),...rows.filter(r=>r.isBenchmark&&!ids.includes(r.id)).sort((a,b)=>['VFV','FEQT','VEQT',ref].indexOf(a.id)-['VFV','FEQT','VEQT',ref].indexOf(b.id))];
      const veqt=rows.find(r=>r.id==='VEQT');
      $('decisionHead').innerHTML='<tr><th scope="col">Portefeuille</th><th scope="col" title="'+a.start+' → '+a.end+'">Passé simulé<small>'+a.start.slice(0,4)+'–'+a.end.slice(0,4)+' · par an</small></th><th scope="col">Projection<small>par an · médiane</small></th><th scope="col">Après '+a.years+' ans<small>pour '+money(context.capital())+'</small></th><th scope="col">Battre le S&P 500<small>chance simulée</small></th><th scope="col">Baisse de 30 %<small>risque pendant le placement</small></th></tr>';
      $('decisionBody').innerHTML=ordered.map(row=>{
        const gap=veqt?row.medianAnnual-veqt.medianAnnual:null;
        return '<tr data-decision-row="'+esc(row.id)+'"'+(row.isBenchmark?' class="benchmark"':'')+'><th scope="row">'+selectors(row)+'<small>Frais '+pct(row.mer,2)+' / an'+(row.coverage.modeled>0?' · données reconstruites':'')+'</small></th>'+
          '<td data-forward-past="'+esc(row.id)+'">'+pct(row.pastAnnual)+'</td>'+
          '<td data-forward-return="'+esc(row.id)+'" class="forecast-return">'+pct(row.medianAnnual)+'<small>'+(row.id==='VEQT'?'Référence mondiale':Number.isFinite(gap)?pp(gap)+' / an vs VEQT':'')+'</small></td>'+
          '<td data-forward-value="'+esc(row.id)+'" class="forecast-wealth">'+money(context.capital()*(1+row.median))+'<small>'+money(context.capital()*(1+row.p10))+' à '+money(context.capital()*(1+row.p90))+'</small></td>'+
          '<td>'+ (row.id==='VFV'?'Référence':prob(row.benchmarks.VFV?.probability))+'</td><td>'+prob(row.drawdownProbability['0.3'])+'</td></tr>';
      }).join('');
      const missing=ids.filter(id=>!rows.some(r=>r.id===id));
      for(const id of missing){const reason=a.unavailable?.find(r=>r.id===id)?.reason||'Données insuffisantes.';$('decisionBody').insertAdjacentHTML('afterbegin','<tr data-decision-row="'+esc(id)+'"><th>'+selectors({id,isBenchmark:false})+'</th><td colspan="5">'+esc(reason)+'</td></tr>');}
      const leader=[...own].sort((a,b)=>b.medianAnnual-a.medianAnnual)[0],overlaps=leader?a.comparisons.filter(c=>(c.a===leader.id||c.b===leader.id)&&ids.includes(c.a)&&ids.includes(c.b)&&c.indistinguishable):[];
      const allClose=own.length>1&&overlaps.length===own.length-1;
      const carry=a.options.recentCarry;
      const headline=carry>0?'Scénario : '+prob(carry)+' de l’avance récente conservée au départ.':own.length===1?label(own[0].id)+' face aux références.':allClose?'Rendements proches : pas de gagnant clair.':leader?label(leader.id)+' a la projection de rendement la plus élevée.':'Compare les scénarios ci-dessous.';
      const note=carry>0?'Cette hypothèse diminue de moitié tous les deux ans.':own.length===1?'Compare le rendement projeté et le risque de baisse.':allClose?'Les écarts sont plus petits que l’incertitude du modèle.':overlaps.length?'L’écart avec certains candidats reste incertain.':'Le résultat dépend de la base de rendement choisie.';
      $('decisionReading').innerHTML='<strong id="decisionResultTitle">Projection sur '+a.years+' ans</strong><p data-result-choice><b>'+esc(headline)+'</b> '+esc(note)+'</p>';
      const source=a.returnSource;
      $('forecastBasisNote').textContent=source.basis==='history'?'Base : marchés en CAD de '+source.start+' à '+source.end+'. L’avance récente des portefeuilles est traitée séparément, dans « Pourquoi ces projections ? ».':'Base : repères prudents de planification 2026. Ces taux visent le long terme; leur application à '+a.years+' ans est une hypothèse.';
      const warnings=[...(missing.length?[missing.length+' candidat(s) non calculable(s).']:[]),...(source.reason?[source.reason]:[]),...(a.options.recentCarry>0?own.filter(r=>!r.activeAvailable).map(r=>'Avance récente non estimable pour '+label(r.id)+'.'):[]),...(H.status==='stale'?['Données de marché en retard.']:[])];
      $('decisionForecastStatus').hidden=!warnings.length;$('decisionForecastStatus').textContent=warnings.join(' ');
      $('decisionPeriod').textContent='Passé : '+a.start+' → '+a.end+' · Projections en CAD, distributions réinvesties et frais inclus.';
      $('decisionDataStatus').textContent='Les fourchettes couvrent 80 % des trajectoires simulées. Une baisse pendant le placement peut survenir même si le rendement final est positif.';
      details(a,ordered);$('decisionPanel').dataset.forecastReady='true';$('decisionPanel').dataset.ready='true';$('decisionPanel').removeAttribute('aria-busy');
    }
    function details(a,rows){
      const source=a.returnSource,own=rows.filter(r=>!r.isBenchmark),names={historical_mean:'Moyenne récente',market_only:'Marché seul',hybrid:source.basis==='history'?'Marchés historiques + expositions':'Repères prudents + expositions'};
      $('decisionForecastMetrics').innerHTML='<p>La projection centrale est la médiane : la moitié des trajectoires se termine au-dessus, l’autre en dessous. Les probabilités dépendent des hypothèses choisies.</p>'+rows.map(r=>'<details class="forecast-row"><summary>'+esc(label(r.id))+'</summary><div class="forecast-detail-grid"><p><b>Rendement à '+a.years+' ans</b>Moyenne annuelle '+pct(r.expectedAnnual)+'; médiane '+pct(r.medianAnnual)+'. Rendement total : '+pct(r.median)+', avec une fourchette de '+pct(r.p10)+' à '+pct(r.p90)+'.</p><p><b>Objectifs de rendement annuel</b>Atteindre 8 / 10 / 15 % : '+[.08,.1,.15].map(t=>prob(r.targets[String(t)])).join(' / ')+'. Terminer avec un gain : '+prob(r.positiveProbability)+'.</p><p><b>Valeur de 100 000 $</b>Médiane '+money(r.futureValue)+'; moyenne '+money(r.expectedFutureValue)+'.</p><p><b>Comparaison aux benchmarks</b>'+F.BENCHMARKS.map(b=>b+' : '+(b===r.id?'référence':prob(r.benchmarks[b]?.probability)+' de chance de le battre; écart moyen '+pp(r.benchmarks[b]?.expectedAnnualGap)+' / an')).join('<br>')+'.</p></div><div class="table-wrap"><table><thead><tr><th>Perte</th><th>Pendant le placement</th><th>À la fin seulement</th></tr></thead><tbody>'+[.2,.3,.4].map(t=>'<tr><th>'+pct(t,0)+'</th><td>'+prob(r.drawdownProbability[String(t)])+'</td><td>'+prob(r.terminalLoss[String(t)])+'</td></tr>').join('')+'</tbody></table></div>'+fan(r.fan)+'</details>').join('');
      const example=own[0];
      $('decisionForecastExplanation').innerHTML='<h3>D’où vient la projection ?</h3>'+
        '<p>'+(example?esc(label(example.id))+' : '+pct(example.pastAnnual)+' / an en backtest, contre une projection de '+pct(example.medianAnnual)+' / an. ':'')+'</p>'+
        '<ol><li><b>Passé simulé :</b> les poids actuels appliqués aux marchés récents.</li><li><b>Base de rendement :</b> '+esc(source.basis==='history'?'les marchés depuis '+source.start+' en CAD.':'les repères prudents de planification 2026.')+'</li><li><b>Avance récente conservée :</b> 0 % par défaut, modifiable ci-dessous.</li></ol>'+
        '<p>Une exposition plus faible aux actions réduit l’effet des variations du marché sur la projection.</p>'+
        '<p>Le repère de 10 % du S&P 500 est historique et en USD. Ici, les scénarios sont en CAD. <a href="https://www.spglobal.com/spdji/en/documents/additional-material/sp-500-brochure.pdf" target="_blank" rel="noopener noreferrer">Source S&P ↗</a></p>';
      $('decisionForecastValidation').innerHTML='<h3>Les prévisions ont-elles prouvé leur efficacité ?</h3><p>'+esc(a.validation.method)+'</p><div class="table-wrap" tabindex="0"><table><thead><tr><th>Candidat / modèle</th><th>Mois testés</th><th>Erreur mensuelle</th><th>Brier · gain</th><th>Couverture 80 %</th></tr></thead><tbody>'+own.flatMap(r=>(a.validation.rows.find(x=>x.id===r.id)?.models||[]).map(m=>'<tr><th>'+esc(label(r.id))+' · '+names[m.model]+'</th><td>'+m.observations+(m.start?'<small>'+m.start+' → '+m.end+'</small>':'')+'</td><td>'+pct(m.rmse,2)+'</td><td>'+number(m.brier,3)+'</td><td>'+prob(m.coverage)+'</td></tr>')).join('')+'</tbody></table></div><p>'+esc(a.validation.limits)+'</p>';
      $('decisionForecastSensitivity').innerHTML='<h3>Si les hypothèses changent</h3>'+own.map(r=>{const s=a.sensitivity.rows.find(x=>x.id===r.id);return '<p><b>'+esc(label(r.id))+'</b> · rendement annuel médian de '+pct(s.medianAnnual[0])+' à '+pct(s.medianAnnual[1])+'. Chance de battre VFV : '+prob(s.beatProbability[0])+' à '+prob(s.beatProbability[1])+'.</p>';}).join('')+'<p>'+esc(a.sensitivity.method)+'</p>';
      $('decisionForecastFactors').innerHTML='<h3>Expositions estimées</h3>'+own.map(r=>'<p><b>'+esc(label(r.id))+'</b> · '+(r.exposures.length?r.exposures.map(f=>'<span class="'+(f.significant?'':'forecast-muted')+'" title="Erreur-type robuste : '+number(f.se,3)+'">'+esc(f.id)+' '+number(f.value,2)+'</span>').join(' · '):esc(r.factorReason))+'.</p>').join('');
      $('decisionForecastSources').innerHTML='<h3>Base des rendements</h3>'+(source.basis==='history'?'<p>Rendements annualisés de proxys en CAD, '+source.start+' → '+source.end+' ('+source.months+' mois) : États-Unis '+pct(source.net.US)+'; Canada '+pct(source.net.CA)+'; développés '+pct(source.net.DEV)+'; émergents '+pct(source.net.EM)+'; obligations '+pct(source.net.XBB)+'. Ces résultats historiques servent d’hypothèse; ils ne constituent pas une prévision.</p><p>'+esc(source.feeAdjustment.method)+' Sources des frais : '+Object.entries(source.feeAdjustment.proxies).map(([t,f])=>'<a href="'+f.url+'" target="_blank" rel="noopener noreferrer">'+t+'</a>').join(' · ')+'.</p>':'<p><a href="'+a.source.url+'" target="_blank" rel="noopener noreferrer">Institut PF / FP Canada 2026 ↗</a> : actions CA 6,3 %, US 6,4 %, développés 6,6 %, émergents 7,5 %, obligations 3,2 %, liquidités 2,4 %. Repères avant frais pour dix ans ou plus.</p>')+
        '<h3>Moteur de simulation</h3><p>25 000 trajectoires centrales communes aux portefeuilles et aux benchmarks; variantes de sensibilité à 2 500 trajectoires. Black-Litterman, bootstrap joint par blocs, sensibilités QR/HAC. Le nombre de simulations ne garantit pas la fiabilité des probabilités.</p><p>Prior Π = δΣw via VEQT; τ = 12 / n; erreurs des vues corrélées par région. L’erreur-type des vues est une hypothèse modifiable. <a href="https://people.duke.edu/~charvey/Teaching/BA453_2002/GS_The_intuition_behind.pdf" target="_blank" rel="noopener noreferrer">Méthode Black-Litterman ↗</a>.</p>'+a.limitations.map(s=>'<p>'+esc(s)+'</p>').join('')+'<p>'+esc(a.regimes.reason)+'</p><p>Conditions macro utilisées : '+a.macro.map(m=>esc(m.title)+' '+number(m.value,2)+' '+esc(m.unit)+' ('+m.date+(m.stale?', périmé':'')+')').join(' · ')+'. Seul le VIX ajuste temporairement la volatilité.</p>';
    }
    function fan(data){
      const lo=Math.min(0,...data.map(x=>x.p10)),hi=Math.max(.1,...data.map(x=>x.p90)),x=t=>8+t/data.at(-1).year*304,y=v=>66-(v-lo)/(hi-lo)*58;
      const points=k=>data.map(p=>x(p.year)+','+y(p[k])).join(' '),area=[...data.map(p=>x(p.year)+','+y(p.p90)),...data.slice().reverse().map(p=>x(p.year)+','+y(p.p10))].join(' ');
      return '<svg class="forecast-fan" viewBox="0 0 320 78" role="img" aria-label="Évolution des quantiles simulés P10, P50 et P90"><polygon points="'+area+'" fill="currentColor" opacity=".12"/><polyline points="'+points('median')+'" fill="none" stroke="currentColor" stroke-width="1.8"/><text x="8" y="77">0</text><text x="270" y="77">'+data.at(-1).year+' ans</text></svg>';
    }
    function failure(reason){pending='';worker?.terminate();worker=null;$('decisionForecastStatus').textContent=reason;$('decisionBody').textContent='';$('decisionReading').textContent='Projection non disponible pour ces paramètres. '+reason;$('decisionPanel').dataset.forecastReady='error';$('decisionPanel').removeAttribute('aria-busy');}
    function render(){
      visible(true);if(!$('decisionHorizon').value)$('decisionHorizon').value='2';
      const years=Number($('decisionHorizon').value),ids=[...new Set([...context.selected(),context.reference()])],key=F.VERSION+'|'+fingerprint+'|'+JSON.stringify([years,ids,options]);
      if(cache.has(key)){renderResult(cache.get(key));return;}
      try{const saved=JSON.parse(sessionStorage.getItem('savy:forecast:'+hash(key))||'null');if(saved?.key===key&&saved.result?.version===F.VERSION){cache.set(key,saved.result);renderResult(saved.result);return;}}catch{}
      if(pending===key)return;
      if(worker)worker.terminate();const id=++generation;pending=key;current=null;$('decisionPanel').dataset.forecastReady='loading';$('decisionPanel').setAttribute('aria-busy','true');
      $('decisionForecastStatus').textContent='Calcul des scénarios à '+years+' ans…';$('decisionReading').innerHTML='<strong>Calcul des projections</strong><p>Le tableau se met à jour pour cet horizon.</p>';$('decisionBody').textContent='';
      $('decisionPeriod').textContent='Projection à '+years+' ans en cours de calcul.';$('decisionDataStatus').textContent='';
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
      }else if(e.target.id==='forecastReset'){options=F.defaults();fields();$('forecastReturnBasis').value=options.returnBasis;$('forecastRecentCarry').value=String(options.recentCarry);try{localStorage.removeItem('savy:fnb-forward:v1');}catch{}render();}
    });
    $('forecastRecentCarry').addEventListener('change',()=>{options={...options,recentCarry:Number($('forecastRecentCarry').value)};try{localStorage.setItem('savy:fnb-forward:v1',JSON.stringify(options));}catch{}render();});
    $('forecastReturnBasis').addEventListener('change',()=>{options={...options,returnBasis:$('forecastReturnBasis').value};try{localStorage.setItem('savy:fnb-forward:v1',JSON.stringify(options));}catch{}render();});
    return {render,pause};
  }
  return {start};
})();
