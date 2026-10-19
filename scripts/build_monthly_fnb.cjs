"use strict";
// Render every financial value from the same validated monthly snapshot.
const fs=require("node:fs"),path=require("node:path");
const root=path.resolve(process.argv[2]||path.join(__dirname,"..")),file=path.join(root,"reports/portefeuilles-fnb.html");
const D=JSON.parse(fs.readFileSync(path.join(root,"data/fnb-analysis.json"),"utf8")),R=D.results,O=D.optimization;
D.preference_ranking=require('./fnb_preferences.cjs')(D);
let html=fs.readFileSync(file,"utf8");
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const num=(v,n=2)=>v===null?"—":new Intl.NumberFormat("fr-CA",{minimumFractionDigits:n,maximumFractionDigits:n}).format(v);
const pct=(v,n=1)=>v===null?"—":num(v*100,n)+" %";
const own=[...(D.proposal_order||[]),...D.custom_order],label=k=>k==="proposal"?"Proposition · "+O.month:D.custom_order.includes(k)?"Nº "+k+" · "+R[k].short_name:k;
const fund=t=>{const f=D.fund_labels[t];if(!f)throw Error("Missing label "+t);return `<span class="fund-ticker">${esc(t)}</span><a class="fund-name" href="${esc(f.source_url)}" target="_blank" rel="noopener noreferrer">${esc(f.name)}</a><span class="fund-description">${esc(f.description)}</span>`;};
const table=(headers,rows)=>'<div class="table-wrap" tabindex="0"><table><thead><tr>'+headers.map(h=>'<th scope="col">'+h+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
function card(k){const q=R[k],hold=D.lookthrough.results[k],props=k==="proposal";
 const metrics=[[pct(q.cagr),"Rendement annualisé"],[pct(q.vol),"Volatilité"],[num(q.sharpe),"Sharpe"],[num(q.beta),"Bêta / VEQT"]].map(([v,l])=>`<div><b>${v}</b><span>${l}</span></div>`).join('');
 const allocations=Object.entries(q.weights).sort((a,b)=>b[1]-a[1]).map(([t,w])=>`<tr><th scope="row" data-fund="${esc(t)}">${fund(t)}</th><td>${pct(w)}</td></tr>`);
 const positions=hold.top10.map((p,i)=>`<tr data-holding="${esc(p.id)}"><td>${i+1}</td><th scope="row">${esc(p.name)}</th><td>${pct(p.weight,2)}</td></tr>`);
 const assets=[["equity","Actions"],["bond","Obligations"],["gold","Or"],["crypto","Crypto"],["cash","Liquidités / autres"]].filter(([key])=>q[key]>.000001).map(([key,n])=>`<span>${n} ${pct(q[key])}</span>`).join('');
 return `<article${k!=="2"?' hidden':''} class="portfolio-card${props?' proposed-card':''}" data-fiche="${k}"><header><div class="eyebrow">${props?'PROPOSITION SÉPARÉE · '+esc(O.month):'Nº '+k}</div><h3>${esc(q.name||q.label)}</h3><p class="portfolio-style">${esc(q.style_label||q.description)}</p></header><div class="actions"><button data-open-exposure="${k}">Voir les expositions</button></div><div class="mini-metrics">${metrics}</div>${table(["FNB","Poids cible"],allocations)}<div class="asset-mix">${assets}</div>${props?'<p class="method-summary">'+esc(O.allocation_type)+'</p>':''}<section class="holdings-section" aria-label="Actions sous-jacentes"><div class="section-head"><h4>10 premières actions</h4><span class="holdings-count">≈ ${num(hold.stock_count,0)} sociétés</span></div><p class="holdings-date">Poids du portefeuille total · positions du ${hold.date_min} au ${hold.date_max}</p>${table(["#","Action","Poids"],positions)}<p class="method-summary">Total des 10 premières : ${pct(hold.top10_weight,2)}. Estimation aux poids cibles; les doublons sont regroupés par société.</p><details><summary>Calcul et sources</summary><p class="method-summary">${esc(D.lookthrough.method)}</p><ul class="holdings-sources">${hold.sources.map(s=>`<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.fund)}</a> · ${esc(s.date)}</li>`).join('')}</ul></details></section></article>`;
}
const cards=own.map(card).join('');
// The card grid ends immediately before the methods view.
const start=html.indexOf('<div class="portfolio-grid">'),end=html.indexOf('<section id="methods"');
if(start<0||end<start)throw Error("Portfolio template not found");
html=html.slice(0,start)+'<div class="portfolio-grid">'+cards+'</div></section>\n'+html.slice(end);
for(const id of ["summaryFocus","sectorFocus","ficheFocus"]){
 const list=id==="sectorFocus"?D.order:own;
 const opts=(id==="ficheFocus"?'<option value="all">Tous · 11 existants + proposition</option>':'')+list.map(k=>`<option value="${k}"${k==="2"?' selected':''}>${esc(id==="ficheFocus"&&D.custom_order.includes(k)?'Nº '+k+' — '+R[k].name:label(k))}</option>`).join('');
 html=html.replace(new RegExp('(<select id="'+id+'"[^>]*>)[\\s\\S]*?(</select>)'),(_,a,b)=>a+opts+b);
}
// A checked proposal is independently selectable in each of the existing charts.
html=html.replace(/<label class="choice-card[^>]*for="(?:risk|growth)-series-proposal"[\s\S]*?<\/label>/g,"");
for(const chart of ["risk","growth"]){
 const choice=`<label class="choice-card is-selected" for="${chart}-series-proposal"><input id="${chart}-series-proposal" type="checkbox" data-series="proposal" data-chart="${chart}" checked aria-label="Afficher la proposition mensuelle"><span class="choice-title"><strong><span class="dot" style="background:${R.proposal.color}"></span>Proposition</strong><span class="choice-name">${esc(O.month)}</span></span></label>`;
 html=html.replace(new RegExp('(<label class="choice-card[^>]*for="'+chart+'-series-1")'),choice+'$1');
}
html=html.replace(/(<input[^>]+id="monthSlider"[^>]*>)/,tag=>tag.replace(/max="[^"]+"/,'max="'+D.dates.length+'"').replace(/value="[^"]+"/,'value="'+D.dates.length+'"'));
const dateLabel=new Intl.DateTimeFormat('fr-CA',{year:'numeric',month:'long',timeZone:'UTC'});
const period=dateLabel.format(new Date(D.dates[0]+'-01T12:00:00Z'))+' – '+dateLabel.format(new Date(D.assumptions.as_of+'T12:00:00Z'));
html=html.replace(/(<header class="report-header">[\s\S]*?<p>)[\s\S]*?(<\/p>)/,(_,a,b)=>a+esc(period)+' · '+D.dates.length+' mois · CAD'+b);
html=html.replace(/11 portefeuilles · \d+ mois/g,'11 portefeuilles + proposition · '+D.dates.length+' mois');
html=html.replace(/Positions de juin à octobre 2026\./g,'Positions datées des dernières publications officielles; dates dans chaque fiche.');
html=html.replace(/(<h2 id="preferenceTitle">)[^<]*(<\/h2>)/,'$1Mon classement actualisé$2');
html=html.replace(/(<p class="preference-caption">)[\s\S]*?(<\/p>)/,'$1Proposition et portefeuilles nº 1 à 9$2');
html=html.replace(/(<ol class="preference-list">)[\s\S]*?(<\/ol>)/,(_,a,b)=>a+D.preference_ranking.entries.map(e=>`<li class="preference-item" data-preference="${e.id}"><span class="preference-rank">${e.rank}</span><div><button class="stats-open" data-open-portfolio="${e.id}">${esc(label(e.id))}</button><p>${esc(e.reason)}</p></div></li>`).join('')+b);
html=html.replace(/(<aside[^>]*class="section preference-panel"[\s\S]*?<p class="all-overview-note">)[\s\S]*?(<\/p>)/,(_,a,b)=>a+esc(D.preference_ranking.criteria)+b);
const v=O.validation;
html=html.replace(/<!-- fnb-monthly:start -->[\s\S]*?<!-- fnb-monthly:end -->/g,"");
// Research details live in Data; the proposition is a normal comparison row.
const sourceRows=Object.keys(D.fund_labels).sort().map(t=>{const dates=D.source_dates[t];return `<tr><th scope="row" data-fund="${esc(t)}">${fund(t)}</th><td>${esc(D.data_methods[t])}<br><small>Performances : ${esc(dates.prices)} · positions : ${esc(dates.holdings)} · secteurs : ${esc(dates.sectors)}</small></td><td><a href="${esc(D.source_urls[t])}" target="_blank" rel="noopener noreferrer">Émetteur ↗</a></td></tr>`;});
const method=`<section id="methods" data-dashboard-view hidden aria-label="Données et méthode"><div class="methods-grid"><section class="section"><h2>Hypothèses communes</h2><ul class="method-list"><li>${D.dates.length} rendements mensuels en CAD · ${esc(period)}. Seuls les mois complétés sont ajoutés.</li><li>Distributions réinvesties; rééquilibrage des allocations cibles au début de janvier. Rendements acquis conservés.</li><li>Performances nettes des frais des fonds; courtage et fiscalité personnelle exclus du backtest.</li><li>Taux sans risque de comparaison : ${pct(O.risk_free.rate,2)} par an, Banque du Canada au ${esc(O.risk_free.date)}. Ce taux constant n’est pas une série historique de taux.</li><li>Les positions et expositions sont les derniers instantanés disponibles, à des dates différentes. Les pays non publiés restent explicites. Leurs poids ne représentent pas les expositions historiques.</li><li>GICS rapproché entre émetteurs; les fractions de liquidités internes et les autres actifs sont présentés séparément.</li></ul></section><section class="section"><h2>Recherche et contrôles mensuels</h2><ul class="method-list"><li>Univers suivi : ${O.eligible_funds.length} FNB d’actions cotés au Canada, en CAD. Aucun emprunt, levier, FNB obligataire, d’or ou de crypto dans la proposition.</li><li>Fenêtre d’estimation : ${O.constraints.lookback_months} mois au maximum, ${O.constraints.minimum_training_months} au minimum. Moyennes ramenées à ${pct(O.constraints.mean_shrinkage,0)} vers VEQT; covariance ramenée à ${pct(O.constraints.covariance_shrinkage,0)} vers la diagonale.</li><li>Maximum huit FNB, ${pct(.35,0)} par fonds, ${pct(.15,0)} pour FINN et ${pct(.05,0)} pour les FNB sectoriels ZEB et ZEO. Tolérance de 10 points par région et secteur face à VEQT; maximum 35 % par secteur.</li><li>Le rejeu chronologique utilise seulement les rendements antérieurs pour chaque choix. L’univers de fonds et les expositions restent ceux connus aujourd’hui : biais de sélection possible. Le suivi après publication est affiché séparément.</li><li>Les 11 portefeuilles initiaux ne sont jamais remplacés. Les anciennes versions, recommandations et performances publiées sont archivées.</li></ul></section><div class="section source-table"><h2>Sources et dates</h2>${table(["FNB","Données utilisées","Source"],sourceRows)}<div class="actions"><button id="monthlyCsvSource">Rendements CSV</button><button id="analysisJsonSource">Données JSON</button></div><p class="method-summary">Modèle ${esc(O.model_version)} · données et paramètres complets dans l’export JSON. Les résultats historiques ne prédisent pas les rendements futurs.</p></div></div></section>`;
const methodsStart=html.indexOf('<section id="methods"'),footer=html.indexOf('<footer',methodsStart);
if(methodsStart<0||footer<methodsStart)throw Error("Methods template not found");
const research=`<section class="section monthly-research"><h2>Recherche mensuelle · ${esc(O.month)}</h2><p class="method-summary">${esc(O.reasons.join(' '))}</p><p class="method-summary">Validation chronologique : Sharpe ${num(v.metrics.sharpe)} contre ${num(v.benchmark.sharpe)} pour VEQT. ${esc(v.note)}</p><button id="monthlyCharts">Comparer la proposition aux benchmarks</button><details class="monthly-details"><summary>Archives des recommandations</summary><div id="monthlyHistory">Chargement des archives…</div></details><p id="monthlyStatus" class="method-summary" role="status">Recherche automatique au début de chaque mois.</p></section>`;
html=html.slice(0,methodsStart)+method.replace('<div class="section source-table">',research+'<div class="section source-table">')+html.slice(footer);
html=require('./fnb_performance_view.cjs')(html);
html=html.replace(/fnb-dashboard\.(js|css)\?v=[^"']+/g,'fnb-dashboard.$1?v=20261019-performance');
// Remove any archived data from the serialized payload before replacing it.
html=html.replace(/(<script[^>]*id="analysis"[^>]*>)[\s\S]*?(<\/script>)/,(_,a,b)=>a+JSON.stringify(D).replace(/</g,"\\u003c")+b);
fs.writeFileSync(file,html);
fs.writeFileSync(path.join(root,"data/fnb-analysis.json"),JSON.stringify(D)+'\n');
console.log("Monthly report rendered:",O.month,D.order.length,"series;",D.dates.length,"months.");
