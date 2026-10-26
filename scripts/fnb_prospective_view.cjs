'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),U=require('../js/fnb-frontier-utils.js');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=(v,d=0)=>new Intl.NumberFormat('fr-CA',{style:'percent',minimumFractionDigits:d,maximumFractionDigits:d}).format(v);
const range=(a,b,d=0)=>pct(Math.min(a,b),d)+(Math.abs(a-b)<10**(-d)/100?'':' à '+pct(Math.max(a,b),d));
function validate(c,packet){
  if(c.schema_version!==1||c.kind!=='dated_research_proposals'||c.currency!=='CAD'||!c.total_return||c.benchmark!=='VFV'||c.rebalance!=='january_targets'||c.registered!==false||c.paths<25000)throw Error('Invalid prospective research conventions');
  if(JSON.stringify(c.portfolios?.map(q=>q.years))!=='[2,10]'||c.evaluation?.length!==10)throw Error('Two dated research candidates required');
  const variants=['central','volatility','lower','higher','correlation'];
  if(JSON.stringify(c.evaluation.map(v=>v.basis+'/'+v.variant).sort())!==JSON.stringify(['history','planning'].flatMap(b=>variants.map(v=>b+'/'+v)).sort()))throw Error('Incomplete sensitivity grid');
  if(c.limits.innovation_momentum_cap!==.30||packet.limits.innovationMomentumCap!==.30)throw Error('Confirmed combined style limit missing');
  if(packet.prepared.options.recentCarry!==0||packet.planning.options.recentCarry!==0||packet.prepared.initialVol!==packet.planning.initialVol)throw Error('Research assumptions must remain paired');
  const validMetric=m=>m&&m.paths===c.paths&&['beatProbability','lossProbability','tieProbability'].every(k=>Number.isFinite(m[k])&&m[k]>=0&&m[k]<=1)&&[.2,.3,.4].every(t=>Number.isFinite(m.drawdownProbability?.[String(t)])&&m.drawdownProbability[String(t)]>=0&&m.drawdownProbability[String(t)]<=1)&&m.simulationInterval95?.length===2&&m.simulationInterval95[0]<=m.beatProbability&&m.beatProbability<=m.simulationInterval95[1]&&m.p10<=m.median&&m.median<=m.p90;
  for(const q of c.portfolios){
    const w=packet.ids.map(t=>q.weights[t]||0);
    if(packet.limits.innovationMomentumIds.reduce((s,t)=>s+(q.weights[t]||0),0)>.30+1e-9)throw Error('Innovation and momentum exceed 30%');
    if(Object.keys(q.weights).some(t=>!packet.ids.includes(t)||['VEQT','XEQT'].includes(t))||Object.keys(q.weights).length>8||Object.values(q.weights).some(v=>!Number.isFinite(v)||v<.02)||!U.feasible(w,packet.limits)||w.some((v,i)=>v>packet.limits.caps[i]+1e-9)||!q.limits.valid)throw Error('Research candidate violates its frozen limits');
    const metrics=c.evaluation.map(v=>v.horizons?.[q.years]?.[String(q.years)]);
    if(!metrics.every(validMetric)||!validMetric(q.history)||!validMetric(q.planning))throw Error('Invalid paired research probabilities');
    const central=c.evaluation.filter(v=>v.variant==='central').map(v=>v.horizons[q.years][String(q.years)]);
    if(central.length!==2||JSON.stringify(central)!==JSON.stringify([q.history,q.planning]))throw Error('Central research estimates mismatch');
    if(q.centralThreshold!==central.every(m=>m.simulationInterval95[0]>=.5)||q.robustThreshold!==metrics.every(m=>m.simulationInterval95[0]>=.5))throw Error('Unsupported 50% claim');
    if(Math.abs(q.probabilityRange[0]-Math.min(...metrics.map(m=>m.beatProbability)))>1e-12||Math.abs(q.probabilityRange[1]-Math.max(...metrics.map(m=>m.beatProbability)))>1e-12)throw Error('Incorrect research sensitivity range');
  }
  return c;
}
function render(D,root){
  const file=path.join(root,'data/fnb-prospective-proposals.json');if(!fs.existsSync(file))return '';
  const c=JSON.parse(fs.readFileSync(file,'utf8'));
  if(!/^data\/fnb-prospective-history\/[\w.-]+\.json$/.test(c.source))throw Error('Invalid research snapshot');
  const bytes=fs.readFileSync(path.join(root,c.source));
  if(crypto.createHash('sha256').update(bytes).digest('hex')!==c.source_sha256)throw Error('Frozen research source changed');
  validate(c,JSON.parse(bytes));
  const date=new Intl.DateTimeFormat('fr-CA',{day:'numeric',month:'long',year:'numeric',timeZone:'America/Toronto'}).format(new Date(c.evaluated_at));
  const stale=c.as_of!==D.dates.at(-1);
  const qualified=c.portfolios.filter(q=>q.centralThreshold);
  const introduction=qualified.length===2?'Les deux projets dépassent 50 % dans les bases centrales, mais restent sensibles aux hypothèses.':qualified.length===1?qualified[0].name+' dépasse 50 % dans les bases centrales. L’autre projet reste non validé.':'La recherche n’a pas validé le seuil de 50 % avec toutes tes limites.';
  const canonical=q=>JSON.stringify(Object.entries(q.weights).sort(([a],[b])=>a.localeCompare(b)));
  const same=c.portfolios.every(q=>canonical(q)===canonical(c.portfolios[0]));
  const weightsFor=q=>'<details class="prospective-project-weights'+(same?' prospective-common-weights':'')+'" data-prospective-allocation="'+q.years+'"><summary>Voir '+(same?'l’allocation commune · ':'')+'8 FNB et leurs pondérations</summary><table><thead><tr><th>FNB</th><th>Poids</th></tr></thead><tbody>'+Object.entries(q.weights).sort((a,b)=>b[1]-a[1]).map(([t,w])=>'<tr data-prospective-fund="'+esc(t)+'"><th><a href="'+esc(c.source_urls[t])+'" target="_blank" rel="noopener noreferrer" title="'+esc(c.fund_names[t])+'">'+esc(t)+'</a></th><td>'+pct(w,1)+'</td></tr>').join('')+'</tbody></table><p>RFG pondéré : '+pct(q.limits.mer,2)+'. Huit FNB; limites vérifiées sur les expositions de l’étude.</p></details>';
  const cards=c.portfolios.map(q=>{
    const status=stale?'Étude datée · à réévaluer':q.robustThreshold?'Seuil maintenu dans les tests':q.centralThreshold?'Au-dessus de 50 % · fragile':'Seuil de 50 % non validé';
    return '<article class="prospective-project" data-prospective-project="'+q.years+'"><div class="prospective-project-heading"><h4>'+esc(same?'Horizon · '+q.years+' ans':q.name)+'</h4><span>'+q.years+' ans</span></div><p class="prospective-project-status">'+status+'</p><div class="prospective-project-main"><span>Battre VFV · bases centrales</span><strong data-prospective-probability>'+range(q.history.beatProbability,q.planning.beatProbability)+'</strong></div><p class="prospective-project-sensitivity">Si les hypothèses changent : <b>'+range(...q.probabilityRange)+'</b>.</p><p>Recul d’au moins 30 % avant l’échéance : <b>'+range(q.history.drawdownProbability['0.3'],q.planning.drawdownProbability['0.3'])+'</b>.</p>'+(same?'':weightsFor(q))+'</article>';
  }).join('');
  return '<section class="prospective-projects" aria-labelledby="prospectiveProjectsTitle"><div class="section-head"><h3 id="prospectiveProjectsTitle">Recherche · objectif battre le S&amp;P 500</h3><span class="small">Étude du '+esc(date)+'</span></div><p>'+esc(introduction)+(same?' La même allocation ressort aux deux horizons.':'')+' Plafond innovation + momentum : 30 % maximum.</p><div class="prospective-project-grid">'+cards+'</div>'+(same?weightsFor(c.portfolios[0]):'')+'<details class="prospective-project-method"><summary>Limites, hypothèses et fiabilité</summary><p>Étude datée, indépendante des réglages du comparateur ci-dessous. Données communes jusqu’à '+esc(c.as_of)+'. '+(stale?'Actualiser l’étude avant de retenir ces poids. ':'')+'Propositions de recherche, distinctes des portefeuilles enregistrés.</p><p>Exposition marquée aux petites capitalisations, au momentum et à l’innovation. Les simulations ne démontrent pas une surperformance durable ni une meilleure protection.</p><p>Limites de l’étude : huit FNB, au moins 2 % par position, sans levier ni vente à découvert. FEQT ≤50 %, FINN ≤15 %, autres FNB ≤35 %, XIT et ZEB ≤10 %, ZEO et or ≤5 %, crypto totale ≤3 %. Innovation + momentum combinés (FINN, FCMO, VMO et XMI) ≤30 %. Aucune position VEQT/XEQT. Géographie ±10 points et secteurs ±7 points autour de VEQT; aucun secteur au-dessus de 35 %. Expositions contrôlées sur la poche actions aux poids cibles. Les poids dérivent entre les rééquilibrages; les compositions des fonds peuvent évoluer.</p><p>'+esc(c.method)+'</p><p>'+esc(c.sensitivity)+'</p><p>'+esc(c.uncertainty)+'</p><p>'+esc(c.validation)+'</p><p>'+esc(c.source_note)+'</p><p>'+esc(c.selection)+'</p><p><a href="../data/fnb-prospective-proposals.json" target="_blank">Résultats et pondérations JSON ↗</a> · <a href="https://www.cfainstitute.org/insights/professional-learning/refresher-readings/2026/backtesting-and-simulation" target="_blank" rel="noopener noreferrer">Interpréter simulations et tests de sensibilité ↗</a></p></details></section>';
}
module.exports=render;module.exports.validate=validate;
