"use strict";
const fs=require("node:fs"),path=require("node:path"),U=require("../js/fnb-frontier-utils.js");
module.exports=function overlay(html,root){
 html=html.replace(/<!-- fnb-extra:start -->[\s\S]*?<!-- fnb-extra:end -->/g,"");
 const file=path.join(root,"data/fnb-frontier-universe.json");if(!fs.existsSync(file))return html;
 const extra=JSON.parse(fs.readFileSync(file,"utf8")),base=JSON.parse(html.match(/<script[^>]*id="analysis"[^>]*>([\s\S]*?)<\/script>/)[1]);
 if(extra.as_of!==base.assumptions.as_of||JSON.stringify(extra.dates)!==JSON.stringify(base.dates))return html;
 U.extend(base,extra);
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const rows=Object.entries(extra.funds).map(([id,f])=>'<tr><th scope="row">'+esc(id)+'<br><small>'+esc(f.label.name)+'</small></th><td>'+esc(f.method)+'<br><small>Performances : '+esc(f.source_dates.prices)+' · positions : '+esc(f.source_dates.holdings)+' · secteurs : '+esc(f.source_dates.sectors)+'</small></td><td><a href="'+esc(f.source_url)+'" target="_blank" rel="noopener noreferrer">Émetteur ↗</a></td></tr>').join("");
 const section='<!-- fnb-extra:start --><section class="section source-table"><h2>Sources et dates · FNB supplémentaires</h2><p class="method-summary">'+Object.keys(extra.funds).length+' FNB supplémentaires pour la frontière efficiente · mêmes '+extra.dates.length+' mois en CAD · données recueillies le '+esc(extra.retrieved_at)+'. VEQT et XEQT restent des références exclues des positions du laboratoire.</p><div class="table-wrap" tabindex="0"><table><thead><tr><th>FNB</th><th>Données utilisées</th><th>Source</th></tr></thead><tbody>'+rows+'</tbody></table></div></section><script type="application/json" id="frontierExtra">'+JSON.stringify(extra).replace(/</g,"\\u003c")+'</script><!-- fnb-extra:end -->';
 const start=html.indexOf('<section id="methods"'),footer=html.indexOf('<footer',start);
 if(footer<0)throw Error("Methods footer missing");
 const end=html.lastIndexOf("</div></section>",footer);
 if(end<start)throw Error("Methods container missing");
 return html.slice(0,end)+section+html.slice(end);
};
