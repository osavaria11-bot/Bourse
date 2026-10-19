"use strict";
// Rebuild the compact overview and look-through cards from the dated issuer snapshot.
const fs=require("node:fs"),path=require("node:path"),{consolidate}=require("./fnb_holdings.cjs");
const root=path.resolve(__dirname,".."),reportPath=path.join(root,"reports/portefeuilles-fnb.html");
let html=fs.readFileSync(reportPath,"utf8");
const dataPattern=/(<script[^>]*id="analysis"[^>]*>)([\s\S]*?)(<\/script>)/;
const D=JSON.parse(html.match(dataPattern)[2]),snapshot=JSON.parse(fs.readFileSync(path.join(root,"data/fnb-holdings.json"),"utf8"));
const results=Object.fromEntries(D.custom_order.map(k=>[k,consolidate(D.results[k].weights,snapshot.funds)]));
const lookthrough={retrieved_at:snapshot.retrieved_at,method:"Poids cibles des FNB × poids officiels des actions. Classes et doublons regroupés par émetteur; nombre estimatif. Or, obligations, crypto, liquidités et dérivés exclus.",results};
fs.writeFileSync(path.join(root,"data/fnb-lookthrough.json"),JSON.stringify(lookthrough,null,2)+"\n");
D.lookthrough=lookthrough;
const preferences=[
 ["5","Noyau mondial, Nasdaq mesuré et 5 % d’or : mon compromis préféré."],
 ["2","Sept FNB complémentaires; mon premier choix sans poche d’or."],
 ["4","Diversification défensive, avec 5 % d’or et moins de Nasdaq."],
 ["1","Simple, à cinq FNB; biais canadien marqué vers les dividendes."],
 ["8","Noyau mondial et momentum; un niveau de risque supérieur."],
 ["6","Bon historique; plus de paris sectoriels et d’incertitude."],
 ["7","Croissance plus concentrée : banques, énergie et gestion active."],
 ["3","Défensif; moins adapté à l’objectif de croissance recherché."],
 ["9","Plus offensif; le supplément de risque me convainc moins."],
];
D.preference_ranking={date:snapshot.retrieved_at,criteria:"Préférence de construction à long terme : diversification, robustesse, concentration et frais, puis résultats historiques. Ce classement n’est pas un tri du Sharpe et ne prédit pas les rendements. Les nº 10 et 11 sont exclus.",entries:preferences.map(([id,reason],i)=>({id,rank:i+1,reason}))};
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const num=(v,n=0)=>new Intl.NumberFormat("fr-CA",{minimumFractionDigits:n,maximumFractionDigits:n}).format(v),pct=(v,n=2)=>num(v*100,n)+" %";
const label=k=>"Nº "+k+" · "+D.results[k].short_name;
const sort=(key,title)=>'<th scope="col" aria-sort="none"><button data-all-sort="'+key+'">'+title+' ↕</button></th>';
const benchmarks=["VBAL","VGRO","VEQT","FBAL","FGRO","FEQT"].map(k=>'<label class="choice-card"><input type="checkbox" data-overview-benchmark="'+k+'"'+(["VBAL","VGRO","VEQT"].includes(k)?' checked':'')+'>'+k+'</label>').join("");
const columns=[["cagr","Rend. ann."],["vol","Volatilité"],["beta","Bêta"],["sharpe","Sharpe"],["information","Information"],["treynor","Treynor"],["tracking_error","Écart de suivi"],["vol_diff","Δ vol."],["max_drawdown","Recul max."],["mer","RFG"],["stocks","Actions ≈"]];
const ranking=D.preference_ranking.entries.map(e=>'<li class="preference-item" data-preference="'+e.id+'"><span class="preference-rank">'+e.rank+'</span><div><button class="stats-open" data-open-portfolio="'+e.id+'">'+esc(label(e.id))+'</button><p>'+esc(e.reason)+'</p></div></li>').join("");
const overview='<section id="allPortfolios" data-dashboard-view aria-label="Vue d’ensemble des portefeuilles"><div class="all-layout"><section class="section all-comparison"><div class="section-head"><h2>Tous les portefeuilles</h2><span class="small">11 portefeuilles · 40 mois</span></div><div class="benchmark-controls all-benchmarks"><span>Comparables</span>'+benchmarks+'</div><div class="table-wrap all-table" tabindex="0" aria-label="Comparaison complète, défilement horizontal"><table><thead><tr>'+sort("rank","Rang")+'<th scope="col">Portefeuille</th>'+columns.map(([key,title])=>sort(key,title)).join("")+'<th scope="col">Top 10 actions</th></tr></thead><tbody id="allPortfolioBody"></tbody></table></div><p class="all-overview-note">Clique un nom pour sa fiche. Fais défiler le tableau pour tous les ratios. Bêta, information, Treynor, écart de suivi et Δ vol. utilisent la référence choisie.</p><p class="all-overview-note">Actions ≈ : émetteurs uniques estimés. Top 10 : poids des dix premières actions dans le portefeuille total. Positions de juin à octobre 2026.</p></section><aside class="section preference-panel" aria-labelledby="preferenceTitle"><h2 id="preferenceTitle">Mon classement</h2><p class="preference-caption">Du préféré au moins préféré · nº 1 à 9</p><ol class="preference-list">'+ranking+'</ol><p class="all-overview-note">Diversification, robustesse et frais avant le seul historique. Une préférence de construction, sans garantie de surperformance.</p></aside></div></section>';
html=html.replace(/<!-- fnb-overview:start -->[\s\S]*?<!-- fnb-overview:end -->\s*/g,"");
html=html.replace(/<nav class="nav"[^>]*>[\s\S]*?<\/nav>/,'<nav class="nav" aria-label="Vues du dashboard"><a class="active" href="#allPortfolios" data-tab="allPortfolios" aria-current="page">Vue d’ensemble</a><a href="#overview" data-tab="overview">Dashboard</a><a href="#exposures" data-tab="exposures">Répartition</a><a href="#portfolios" data-tab="portfolios">Fiches et poids</a><a href="#methods" data-tab="methods">Données</a></nav>');
html=html.replace(/<section id="overview"([^>]*)>/,'<!-- fnb-overview:start -->'+overview+'<!-- fnb-overview:end -->\n<section id="overview"$1>');
html=html.replace(/<section id="overview"[^>]*>/,tag=>/\bhidden\b/.test(tag)?tag:tag.slice(0,-1)+' hidden>');
html=html.replace(/(<article\b[^>]*data-fiche="(\d+)"[^>]*>)([\s\S]*?)(<\/article>)/g,(full,open,k,body,close)=>{
 const h=results[k];if(!h)return full;
 body=body.replace(/<!-- fnb-holdings:start -->[\s\S]*?<!-- fnb-holdings:end -->/g,"");
 const rows=h.top10.map((p,i)=>'<tr data-holding="'+esc(p.id)+'"><td>'+num(i+1)+'</td><th scope="row">'+esc(p.name)+'</th><td>'+pct(p.weight)+'</td></tr>').join("");
 const sources=h.sources.map(s=>'<li><a href="'+esc(s.url)+'" target="_blank" rel="noopener noreferrer">'+esc(s.fund)+'</a> · '+s.date+'</li>').join("");
 const card='<section class="holdings-section" aria-label="Actions sous-jacentes de '+esc(label(k))+'"><div class="section-head"><h4>10 premières actions</h4><span class="holdings-count">≈ '+num(h.stock_count)+' sociétés</span></div><p class="holdings-date">Poids du portefeuille total · positions du '+h.date_min+' au '+h.date_max+'</p><div class="table-wrap"><table><thead><tr><th scope="col">#</th><th scope="col">Action</th><th scope="col">Poids</th></tr></thead><tbody>'+rows+'</tbody><tfoot><tr><th colspan="2" scope="row">Total des 10 premières</th><td>'+pct(h.top10_weight)+'</td></tr></tfoot></table></div><details><summary>Calcul et sources</summary><p class="method-summary">Poids cibles × positions officielles. Actions communes à plusieurs FNB et classes d’actions regroupées par société. Nombre estimatif : noms harmonisés, dates différentes et arrondis des émetteurs. Or, obligations, crypto, liquidités et dérivés exclus du comptage; les poids restent calculés sur le portefeuille total.</p><ul class="holdings-sources">'+sources+'</ul></details></section>';
 return open+body+'<!-- fnb-holdings:start -->'+card+'<!-- fnb-holdings:end -->'+close;
});
html=html.replace(/fnb-dashboard\.(js|css)\?v=[^"']+/g,'fnb-dashboard.$1?v=20261019-ensemble');
html=html.replace(dataPattern,(_,open,body,close)=>open+JSON.stringify(D).replace(/</g,"\\u003c")+close);
fs.writeFileSync(reportPath,html);
console.log("Overview rebuilt:",D.custom_order.length,"portfolios,",D.preference_ranking.entries.length,"ranked,",Object.keys(snapshot.funds).length,"source funds.");
