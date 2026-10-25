"use strict";
const fs=require('node:fs'),path=require('node:path');
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function validate(c,D){
 if(c.kind!=='qualitative_investment_judgment'||c.probabilities_calibrated!==false||c.benchmark!=='VFV'||!D.results.VFV)throw Error('Invalid qualitative horizon method');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(c.date)||!/^\d{4}-\d{2}-\d{2}$/.test(c.data_as_of)||c.data_as_of>D.assumptions.as_of||c.date<c.data_as_of)throw Error('Invalid horizon opinion dates');
 if(JSON.stringify(c.horizons?.map(h=>h.years))!==JSON.stringify([2,5,10]))throw Error('Expected 2, 5 and 10 year opinions');
 const allowed=new Set([...(D.robust_order||[]),...(D.recommended_order||[]),...D.custom_order.filter(k=>!['10','11'].includes(k))]);
 for(const h of c.horizons)if(h.order.length!==5||new Set(h.order).size!==5||h.order.some(id=>!allowed.has(id))||!h.reason)throw Error('Invalid horizon portfolios');
 for(const key of ['scope','method','limitations'])if(typeof c[key]!=='string'||!c[key].trim())throw Error('Missing horizon disclosure');
 return c;
}
function render(html,D,root){
 html=html.replace(/<!-- fnb-horizon:start -->[\s\S]*?<!-- fnb-horizon:end -->\n?/g,'');
 const file=path.join(root,'data/fnb-horizon-ranking.json');if(!fs.existsSync(file))return html;
 const c=validate(JSON.parse(fs.readFileSync(file,'utf8')),D),label=id=>D.results[id].name||D.results[id].label;
 const sections=c.horizons.map(h=>'<section data-horizon-top="'+h.years+'"><h4>'+h.years+' ans</h4><ol>'+h.order.map((id,i)=>'<li'+(i===0?' class="horizon-first"':'')+'><button class="stats-open" data-open-portfolio="'+esc(id)+'">'+esc(label(id))+'</button></li>').join('')+'</ol></section>').join('');
 const reasons=c.horizons.map(h=>'<p><b>'+h.years+' ans.</b> '+esc(h.reason)+'</p>').join('');
 const content='<!-- fnb-horizon:start --><section class="horizon-panel" aria-labelledby="horizonRankingTitle"><div class="section-head"><h3 id="horizonRankingTitle">Top 5 · 2, 5 et 10 ans</h3><span class="small">Avis du '+esc(c.date)+'</span></div><p class="horizon-note">Sélection qualitative pour chercher à battre le S&amp;P 500 en CAD (VFV). Ce top est distinct des projections calculées ci-dessous.</p><div class="horizon-columns">'+sections+'</div><details class="horizon-ranking"><summary>Pourquoi ces choix ?</summary>'+reasons+'<p>Données au '+esc(c.data_as_of)+'. '+esc(c.scope)+'</p><p>'+esc(c.method)+'</p><p>'+esc(c.limitations)+'</p></details></section><!-- fnb-horizon:end -->\n';
 const target=/(<section\b[^>]*\bid="allPortfolios"[^>]*>)/;
 if(!target.test(html))throw Error('Horizon ranking target missing');
 return html.replace(target,(_,before)=>before+content);
}
module.exports=render;module.exports.validate=validate;
