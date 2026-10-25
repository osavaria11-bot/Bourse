'use strict';
window.SavyFnbDecision=(()=>{
  const U=window.SavyFnbDecisionUtils,P=typeof SavyPerformanceUtils==='undefined'?null:SavyPerformanceUtils,storage='savy:fnb-decision:v1';
  const root=new URL('../',document.currentScript.src);
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=(v,d=2)=>Number.isFinite(v)?new Intl.NumberFormat('fr-CA',{minimumFractionDigits:d,maximumFractionDigits:d}).format(Math.abs(v)<1e-10?0:v):'—';
  const pct=(v,d=1)=>Number.isFinite(v)?num(v*100,d)+' %':'—',pp=v=>Number.isFinite(v)?(v>0?'+':'')+num(v*100,1)+' pp':'—';
  const money=v=>Number.isFinite(v)?new Intl.NumberFormat('fr-CA',{style:'currency',currency:'CAD',currencyDisplay:'narrowSymbol',maximumFractionDigits:0}).format(v):'—';
  const shortDate=day=>new Date(day+'T12:00:00Z').toLocaleDateString('fr-CA',{day:'numeric',month:'short',timeZone:'UTC'});
  const periodLabel=(start,end)=>start.slice(0,7)===end.slice(0,7)?Number(start.slice(-2))+'–'+shortDate(end):shortDate(start)+' → '+shortDate(end);
  function start(D,daily,stress,actions){
    const $=id=>document.getElementById(id);if(!$('decisionPanel'))return;
    const label=id=>D.results[id]?.name||(id==='VFV'?'S&P 500 · VFV':D.results[id]?.short_name||id);
    let selected=[],analysis=null,signature='',sensKey='',sens=[],recorded=null,recordError='',loading=false;
    try{recorded=P.validate(JSON.parse($('fnbRecordedInput')?.textContent||'null'));}catch{recordError='Suivi enregistré indisponible.';}
    try{
      const p=JSON.parse(localStorage.getItem(storage)||'{}');
      if(['historical','forward'].includes(p.mode))$('decisionMode').value=p.mode;
      if(U.GOALS[p.goal])$('decisionGoal').value=p.goal;
      if(['2','5','10'].includes(p.horizon))$('decisionHorizon').value=p.horizon;
      if(Number.isFinite(p.loss)&&p.loss>0&&p.loss<=100)$('decisionLoss').value=String(p.loss);
      if(Array.isArray(p.selected))selected=p.selected;
      if(Number.isFinite(p.capital)&&p.capital>=1&&p.capital<=1e9){$('capitalInput').value=String(p.capital);$('capitalInput').dispatchEvent(new Event('input',{bubbles:true}));}
    }catch{}
    $('decisionCapital').value=$('capitalInput').value;
    const reference=()=>$('referenceSelect').value;
    const capital=()=>actions.capital();
    const limit=()=>{const raw=$('decisionLoss').value.trim().replace(/%/g,'').replace(',','.');return /^\d+(?:\.\d+)?$/.test(raw)&&Number(raw)>0&&Number(raw)<=100?Number(raw)/100:null;};
    const persist=()=>{try{localStorage.setItem(storage,JSON.stringify({mode:$('decisionMode').value,goal:$('decisionGoal').value,horizon:$('decisionHorizon').value,loss:limit()===null?null:limit()*100,capital:capital(),selected}));}catch{}};
    const historicalHead=$('decisionHead').innerHTML;
    const forward=window.SavyFnbForward.start(D,stress,{selected:()=>selected,reference,capital,limit,label,allowed:()=>U.candidates(D,reference()),open:actions.open});
    function model(){
      selected=U.choices(D,reference(),selected);const key=selected.join('|')+'|'+reference();
      if(key!==signature){signature=key;analysis=U.analyse(D,selected,reference(),daily,stress);sensKey='';}
      return analysis;
    }
    function afterPublication(row){
      const r=U.recorded(D,row.id,reference(),recorded);
      if(!r.available)return '<span>—</span><small>'+esc(r.reason)+'</small>';
      return '<span data-decision-recorded="'+esc(row.id)+'">'+pct(r.total,2)+'</span><small title="'+esc(r.start+' → '+r.end)+'">'+esc(periodLabel(r.start,r.end))+' · '+r.observations+' séances</small><small>Écart / '+esc(reference())+' : '+pp(r.gap)+'</small>';
    }
    function threshold(row){
      const t=U.tolerance(row,limit());
      if(t.status==='unset')return '';
      if(t.status==='exceeded')return '<small class="decision-warning" title="'+esc(t.breaches.map(b=>b.name).join(' · '))+'">Seuil dépassé dans '+t.breaches.length+' mesure(s) / scénario(s)</small>';
      return '<small>'+esc(t.status==='unavailable'?'Seuil non évaluable':'Pas de dépassement parmi les estimations disponibles')+(t.missing?' · '+t.missing+' scénario(s) incomplet(s)':'')+'</small>';
    }
    function table(a){
      const goal=$('decisionGoal').value,g=U.GOALS[goal],rank=U.ranks(a.rows,goal),allowed=U.candidates(D,reference());
      $('decisionBody').innerHTML=a.rows.map(row=>{
        const chosen=selected.indexOf(row.id),first=rank.get(row.id)===1,global=goal==='global'?window.SavyFnbForecast.global(a.rows):null;
        const title=row.isBenchmark?'<b>'+esc(label(row.id))+'</b><small>Référence commune</small>':'<div class="decision-selector"><select data-decision-choice="'+chosen+'" aria-label="Candidat '+(chosen+1)+'">'+allowed.map(id=>'<option value="'+esc(id)+'"'+(id===row.id?' selected':'')+(selected.includes(id)&&id!==row.id?' disabled':'')+'>'+esc(label(id))+'</option>').join('')+'</select><div class="decision-actions"><button type="button" data-decision-open="'+esc(row.id)+'">Fiche</button><button type="button" data-decision-risk="'+esc(row.id)+'">Risque</button></div></div>';
        const value=(key,formatted,note='')=>'<td data-decision-value="'+key+'" class="'+(g?.key===key?'decision-highlight ':'')+(first&&g?.key===key?'decision-best':'')+'">'+formatted+(note?'<small>'+note+'</small>':'')+'</td>';
        return '<tr data-decision-row="'+esc(row.id)+'"'+(row.isBenchmark?' class="benchmark"':'')+'><th scope="row">'+title+(global&&!row.isBenchmark?'<small>Points forts : '+esc(global.comparisons.find(r=>r.id===row.id)?.strengths.slice(0,2).join(' / ')||'Compromis')+'</small>':'')+threshold(row)+'</th>'+value('annualReturn',pct(row.annualReturn,1))+value('sharpe',num(row.sharpe))+value('maxDrawdown',pct(row.maxDrawdown,1),Number.isFinite(row.maxDrawdown)?money(row.maxDrawdown*capital()):'Non estimable')+value('cvar',pct(row.cvar,2),row.cvar===null?'Échantillon insuffisant':money(row.cvar*capital())+(row.tailFragile?' · fragile':''))+value('mer',pct(row.mer,2))+'<td>'+afterPublication(row)+'</td></tr>';
      }).join('');
      document.querySelectorAll('[data-decision-metric]').forEach(th=>th.classList.toggle('decision-highlight',th.dataset.decisionMetric===g?.key));
    }
    function reading(a){
      const goal=$('decisionGoal').value,g=U.GOALS[goal],own=a.rows.filter(r=>!r.isBenchmark),rank=U.ranks(a.rows,goal),leaders=own.filter(r=>rank.get(r.id)===1);
      const years=Number($('decisionHorizon').value),h=U.horizon(a,years);
      let choice='Compare les rendements, les pertes et les frais sur la même période.';
      if(goal==='global'){
        const bestReturn=[...own].filter(r=>Number.isFinite(r.annualReturn)).sort((a,b)=>b.annualReturn-a.annualReturn)[0],cheapest=[...own].filter(r=>Number.isFinite(r.mer)).sort((a,b)=>a.mer-b.mer)[0];
        choice=own.length===1?'Un seul candidat pour ce mandat : compare-le à '+reference()+'.':(bestReturn?label(bestReturn.id)+' a le rendement passé le plus élevé. ':'')+(cheapest?label(cheapest.id)+' a les frais les plus bas.':'');
      }else if(g&&leaders.length)choice=(goal==='protection'?'Perte estimée la plus faible':goal==='balance'?'Sharpe passé le plus élevé':'Rendement passé le plus élevé')+' : '+leaders.map(r=>label(r.id)).join(', ')+'. Ce critère seul ne suffit pas pour choisir.';
      let horizonText='Choisis un horizon pour afficher un rejeu historique sur cette durée.';
      if(h)horizonText=h.available?'Sur les '+years+' dernières années : '+h.results.map(r=>label(r.id)+' '+pct(r.total,1)).join(' · ')+'. Rendements cumulés; ce n’est pas une projection.':h.reason+' Aucune projection dans ce mode; choisis Prospectif.';
      let risk='';if(limit()!==null){const n=own.filter(r=>U.tolerance(r,limit()).status==='exceeded').length;risk='<p data-result-risk>'+n+' candidat(s) sur '+own.length+' dépassent ton seuil de '+pct(limit())+' dans au moins une mesure ou un scénario disponible. Ce seuil ne borne pas les pertes futures.</p>';}
      $('decisionReading').innerHTML='<strong id="decisionResultTitle">'+esc(h?'Lecture sur '+years+' ans':goal==='global'?'Comparaison globale du passé':'Lecture du comparatif')+'</strong><div class="decision-result-lines"><p data-result-choice>'+esc(choice)+'</p><p id="decisionHorizonResult">'+esc(horizonText)+'</p>'+risk+'</div>';
      const short=a.rows.filter(r=>!r.isBenchmark).map(r=>U.recorded(D,r.id,reference(),recorded)),expected=P?.expectedSession(),stale=recorded?.as_of&&expected&&recorded.as_of<expected,riskStale=daily?.status==='stale'||(expected&&daily?.as_of<expected);
      $('decisionDataStatus').textContent=(a.rows.some(r=>r.tailFragile)?'Estimations de pertes fragiles : historique de queue limité. ':'')+(riskStale?'Données de risque en retard. ':'')+(stale?'Suivi enregistré en retard. ':'')+(recordError?recordError+' ':'')+(short.some(s=>s.available&&s.short)?'Le suivi réel depuis publication reste trop court pour conclure.':'');
    }
    function protection(a){
      $('decisionProtection').innerHTML='<h3>Protection face à '+esc(reference())+'</h3><div class="table-wrap" tabindex="0"><table><thead><tr><th>Portefeuille</th><th>Bêta</th><th>Downside Beta</th><th>Downside Capture</th><th>Risque actif / TE</th><th>Choc mondial −20 % · écart</th></tr></thead><tbody>'+a.rows.filter(r=>!r.isBenchmark).map(row=>{
        const c=row.risk,f=window.SavyFnbFactors.compare(D,row.id,reference()),world=row.scenarios.find(s=>s.id==='world20');
        return '<tr><th>'+esc(label(row.id))+'</th><td>'+num(c.beta)+'</td><td>'+num(c.downside?.beta)+(c.downside?.fragile?' · fragile':'')+'</td><td>'+pct(c.capture?.ratio,1)+(c.capture?.fragile?' · fragile':'')+'</td><td>'+pct(f?.trackingError,2)+'</td><td>'+pp(world?.gap)+'</td></tr>';
      }).join('')+'</tbody></table></div><p>Bêtas, capture et TE : '+esc(D.dates[0])+' → '+esc(D.dates.at(-1))+'; backtest mensuel rééquilibré en janvier. La capture peut être négative si le portefeuille gagne pendant les mois baissiers. Les signes et le nombre de mois sont détaillés dans Risque de perte.</p><p>Le choc mondial −20 % est une projection linéaire fondée sur le bêta. Un écart favorable dans ce scénario mesure cet effet de marché; il ne démontre pas une diversification. Les scénarios historiques combinant plusieurs méthodes ne permettent pas toujours d’isoler les effets sectoriels, factoriels et de change.</p><h3>Concentration et positions communes</h3>'+a.rows.filter(r=>!r.isBenchmark).map(r=>{const o=U.overlap(D,r.id);return '<p><b>'+esc(label(r.id))+'</b> · '+o.funds+' FNB; premier fonds '+pct(o.maxFund,1)+'; dix premières sociétés '+pct(o.top10,1)+'. Parmi ces dix sociétés, '+o.sharedTop.length+' sont présentes dans plusieurs FNB'+(o.sharedTop.length?' : '+esc(o.sharedTop.slice(0,3).map(p=>p.name+' ('+p.funds.join(', ')+')').join(' · ')):'')+'.</p>';}).join('')+'<p>Positions consolidées des derniers instantanés officiels. Ce relevé des dix premières sociétés est partiel; il ne mesure pas tous les chevauchements du portefeuille.</p>';
    }
    function diagnostics(a){
      const goal=$('decisionGoal').value,key=signature+'|'+goal;
      if(key!==sensKey){sens=U.sensitivity(D,a,goal);sensKey=key;}
      $('decisionSensitivity').innerHTML='<h3>Sensibilité du classement</h3>'+(sens.length?'<div class="table-wrap" tabindex="0"><table><thead><tr><th>Candidat</th><th>Fenêtres de comparaison · rang</th><th>Transferts de poids ≤2 pp</th><th>Plage du critère</th></tr></thead><tbody>'+sens.map(s=>'<tr><th>'+esc(label(s.id))+'</th><td>'+s.windows.map(w=>w.observations+(a.basis==='daily'?' séances':' mois')+' : '+(w.rank??'—')).join(' · ')+'</td><td>'+(s.weightRank?'Rang '+s.weightRank[0]+' à '+s.weightRank[1]+' · '+s.weightVariants+' variantes':'Non estimable')+'</td><td>'+(s.weightMetric?(goal==='balance'?num(s.weightMetric[0])+' à '+num(s.weightMetric[1]):pct(s.weightMetric[0],2)+' à '+pct(s.weightMetric[1],2)):'—')+'</td></tr>').join('')+'</tbody></table></div><p>Rangs parmi les candidats sélectionnés, référence exclue. Fenêtres imbriquées, sans validation indépendante. Perturbations locales à poids quotidiens constants, avec les mêmes séries CAD; elles ne sont pas de nouvelles recommandations.</p>':'<p>Choisir un objectif pour examiner la sensibilité des rangs. Aucune note de robustesse composite n’est calculée.</p>');
      $('decisionSources').innerHTML='<h3>Ce qui est estimable</h3>'+a.rows.filter(r=>!r.isBenchmark).map(row=>{
        const c=row.risk,unavailable=row.scenarios.filter(s=>!s.available),ci=a.basis==='daily'&&row.cvar!==null?c.interval:null;
        return '<p><b>'+esc(label(row.id))+'</b> · '+row.blocks+' blocs de 21 séances; queue de 5 % ≈ '+num(row.tailObservations,1)+' observations.'+(ci?' Intervalle bootstrap 95 % de la CVaR : ['+pct(ci.cvar[0],2)+' ; '+pct(ci.cvar[1],2)+'].':' CVaR / intervalle non estimables sur ce comparatif.')+(unavailable.length?' Scénarios incomplets : '+esc(unavailable.map(s=>s.name).join(', '))+'.':'')+'</p>';
      }).join('')+'<p>Le bootstrap rééchantillonne l’historique par blocs; il ne crée pas de crises absentes. Sources de risque au '+esc(daily?.as_of||'—')+'; scénarios au '+esc(stress?.as_of||'—')+'. Les parts observées, reconstruites et modélisées de chaque scénario sont détaillées dans Risque de perte.</p>';
    }
    function renderCards(){
      for(const host of document.querySelectorAll('[data-decision-card]')){
        if(host.closest('[data-fiche]').hidden)continue;
        const id=host.dataset.decisionCard,a=U.analyse(D,[id],reference(),daily,stress),row=a.rows.find(r=>r.id===id);if(!row){host.textContent=a.reason;continue;}
        const c=row.risk,b=a.rows.find(r=>r.isBenchmark),o=U.overlap(D,id),f=window.SavyFnbFactors.compare(D,id,reference());
        const risks=c.top?.[0],significant=f.available?f.factors.filter(x=>x.id!=='market'&&x.significant).map(x=>x.name):[];
        const tracked=U.recorded(D,id,reference(),recorded);
        host.innerHTML='<p><b>Pourquoi l’envisager ?</b> '+esc(D.results[id].style_label||D.results[id].description)+'. Dans le comparatif '+esc(a.start)+' → '+esc(a.end)+' : rendement annualisé '+pct(row.annualReturn,1)+' contre '+pct(b?.annualReturn,1)+' pour '+esc(reference())+'; Sharpe '+num(row.sharpe)+' contre '+num(b?.sharpe)+'.</p>'+
          '<p><b>Quel risque accepter ?</b> '+(risks?'Premier contributeur à la variance : '+esc(risks.id)+' ('+pct(risks.share,1)+'). ':'Contribution à la variance non estimable. ')+o.funds+' FNB; premier fonds '+pct(o.maxFund,1)+'; dix premières sociétés '+pct(o.top10,1)+'. '+(row.flags.length?esc(row.flags.join(' · '))+'. ':'')+'</p>'+
          '<p><b>D’où vient la protection ?</b> Bêta '+num(c.beta)+'; Downside Beta '+num(c.downside?.beta)+' ('+(c.downside?.observations??0)+' mois baissiers'+(c.downside?.fragile?', fragile':'')+'); capture '+pct(c.capture?.ratio,1)+'. '+(significant.length?'Écarts factoriels estimés significatifs dans ce modèle : '+esc(significant.join(', '))+'. ':'Aucun écart de style statistiquement établi dans le modèle disponible. ')+'Ces constats ne suffisent pas à isoler une diversification durable.</p>'+
          '<p><b>Quand réévaluer ?</b> Si les expositions s’éloignent de tes limites, si les sources deviennent incomplètes, ou si la protection et la performance après publication se dégradent durablement. '+(tracked.available?'Suivi enregistré depuis le '+esc(tracked.start)+' : '+pct(tracked.total,2)+'; '+tracked.observations+' séances'+(tracked.short?', encore trop court pour conclure.':'.'):esc(tracked.reason))+' Une alerte demande une revue, sans ordre automatique de vente.</p><div class="decision-actions"><button type="button" data-decision-risk="'+esc(id)+'">Examiner les risques et sources</button><button type="button" data-tab="performance">Voir le suivi au départ commun</button></div>';
      }
    }
    function render(){
      $('decisionLossMoney').textContent=limit()===null?'':money(limit()*capital());
      const invalid=$('decisionLoss').value.trim()!==''&&limit()===null;$('decisionLossError').hidden=!invalid;$('decisionLoss').setAttribute('aria-invalid',String(invalid));
      const a=model();
      if($('decisionMode').value==='forward'){forward.render();renderCards();persist();return;}
      forward.pause();$('decisionHead').innerHTML=historicalHead;
      if(!a.available){$('decisionPeriod').textContent=a.reason;for(const id of ['decisionBody','decisionReading','decisionDataStatus','decisionProtection','decisionSensitivity','decisionSources'])$(id).textContent='';renderCards();$('decisionPanel').dataset.ready='true';return;}
      $('decisionPeriod').textContent=a.start+' → '+a.end+' · '+(a.basis==='daily'?'Backtest quotidien des poids actuels.':'Backtest mensuel, rééquilibrage annuel.')+' CAD, distributions et frais inclus.';
      table(a);reading(a);if($('decisionDetails').open){protection(a);diagnostics(a);}renderCards();persist();
      $('decisionPanel').dataset.ready='true';
    }
    async function refreshRecorded(){
      if(loading)return;loading=true;
      try{
        const response=await fetch(new URL('data/fnb-performance.json',root),{cache:'no-cache'});if(!response.ok)throw Error('Unavailable');
        const next=P.validate(await response.json());
        if(recorded&&next.as_of<recorded.as_of)throw Error('Older snapshot');
        recorded=next;recordError='';
      }catch{recordError=recorded?'Actualisation du suivi indisponible; dernière clôture enregistrée conservée.':'Suivi enregistré indisponible.';}
      finally{loading=false;render();}
    }
    document.addEventListener('change',e=>{
      const el=e.target;
      if(el.hasAttribute('data-decision-choice')){selected[Number(el.dataset.decisionChoice)]=el.value;signature='';render();}
      else if(['decisionMode','decisionGoal','decisionHorizon','referenceSelect'].includes(el.id))render();
      else if(['ficheFocus','sectorFocus','summaryFocus'].includes(el.id))renderCards();
    });
    document.addEventListener('input',e=>{
      if(e.target.id==='decisionCapital'){
        const valid=actions.parseCapital(e.target.value)!==null;$('decisionCapital').setAttribute('aria-invalid',String(!valid));$('decisionCapitalError').hidden=valid;
        if(valid){$('capitalInput').value=e.target.value;$('capitalInput').dispatchEvent(new Event('input',{bubbles:true}));}
      }
      if(e.target.id==='capitalInput'){$('decisionCapital').value=e.target.value;const valid=actions.parseCapital(e.target.value)!==null;$('decisionCapital').setAttribute('aria-invalid',String(!valid));$('decisionCapitalError').hidden=valid;render();}
      if(e.target.id==='decisionLoss')render();
    });
    document.addEventListener('click',e=>{
      // Prepare the disclosure in the same interaction, before the browser's
      // deferred toggle event (which may be throttled in an embedded report).
      if($('decisionMode').value!=='forward'&&e.target.closest('#decisionDetails>summary')){const a=model();if(a.available){protection(a);diagnostics(a);}}
      const b=e.target.closest('button');if(!b)return;
      if(['recommendedCharts','robustCharts'].includes(b.id)){selected=(b.id==='robustCharts'?D.robust_order:D.recommended_order).slice(0,3);signature='';render();}
      if(b.dataset.decisionOpen)actions.open(b.dataset.decisionOpen,reference(),'portfolios');
      if(b.dataset.decisionRisk)actions.open(b.dataset.decisionRisk,reference(),'exposures');
      if(b.dataset.openPortfolio||b.dataset.decisionOpen)renderCards();
    });
    document.addEventListener('toggle',e=>{if($('decisionMode').value!=='forward'&&e.target.id==='decisionDetails'&&e.target.open){const a=model();protection(a);diagnostics(a);}if(e.target.matches?.('.decision-card')&&e.target.open)renderCards();},true);
    const visible=()=>document.visibilityState==='visible'&&(!$('decision').hidden||!$('allPortfolios').hidden||!$('portfolios').hidden);
    setInterval(()=>{if(visible())refreshRecorded();},300000);
    document.addEventListener('visibilitychange',()=>{if(visible())refreshRecorded();});
    render();refreshRecorded();
  }
  return {start};
})();
