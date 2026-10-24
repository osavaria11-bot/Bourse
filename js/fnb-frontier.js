(() => {
 "use strict";
 const U=window.SavyFrontierUtils,script=document.currentScript,workerUrl=new URL("fnb-frontier-worker.js?v=20261021-feqt50",script.src);
 const $=id=>document.getElementById(id),number=(v,d=2)=>v===null||!Number.isFinite(v)?"—":new Intl.NumberFormat("fr-CA",{minimumFractionDigits:d,maximumFractionDigits:d}).format(v);
 const pct=(v,d=1)=>v===null||!Number.isFinite(v)?"—":number(v*100,d)+" %",esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const delta=v=>v===null||!Number.isFinite(v)?"—":(v>0?"+":"")+number(v,3),finite=v=>typeof v==="number"&&Number.isFinite(v);
 let D,root,prepared,solution,weights,selectedIds,cap=.5,sample="split",mode="risk",priority=.5,profile="seed",key,worker,generation=0,loading=false,plot,chartTimer,pending,initialized=false;
 const cache=new Map(),labels={seed:"Proposition adaptée aux contraintes choisies",sharpe:"Sharpe maximal",information:"IR maximal / VEQT",compromise:"Compromis Sharpe / IR",custom:"Simulation libre",frontier:"Point de la frontière"};
 const seedWeights=()=>D.results.proposal?.weights||{VEQT:1};
 const savedWeights=()=>Object.fromEntries(selectedIds.map((id,i)=>[id,weights[i]]));
 function save(){if(!prepared||!weights)return;try{localStorage.setItem(key,JSON.stringify({ids:selectedIds,cap,sample,mode,priority,weights:savedWeights()}));}catch{}}
 function fundControls(){
  $("frontierFundChoices").innerHTML=D.optimization.eligible_funds.map(id=>`<label><input type="checkbox" data-frontier-include="${esc(id)}" ${selectedIds.includes(id)?"checked":""}><span><b>${esc(id)}</b><small>${esc(D.fund_labels[id]?.description||"Actions")}</small></span></label>`).join("");
 }
 function table(){
  $("frontierWeightsTitle").textContent="Allocation interactive · "+selectedIds.length+" FNB";
  $("frontierWeights").innerHTML=selectedIds.map((id,i)=>`<tr data-frontier-fund="${esc(id)}"><th scope="row"><label for="frontierWeight${i}"><span><b>${esc(id)}</b><small>${esc(D.fund_labels[id]?.description||"FNB d’actions")}</small></span><output id="frontierWeightLabel${i}"></output></label><input id="frontierWeight${i}" data-frontier-weight="${i}" type="range" min="0" max="${prepared.limits.caps[i]*100}" step="0.1" aria-label="Poids de ${esc(id)} en pourcentage"></th><td data-frontier-delta="sharpe"></td><td data-frontier-delta="information"></td></tr>`).join("");
  $("frontierSources").innerHTML=selectedIds.map(id=>`<tr><th scope="row">${esc(id)}<small>${esc(D.fund_labels[id]?.name||id)}</small></th><td>${esc(D.data_methods[id]||"Voir la source du fonds.")} <a href="${esc(D.source_urls[id])}" target="_blank" rel="noopener noreferrer">Source ↗</a><br><small>Performances : ${esc(D.source_dates[id]?.prices||"—")} · positions : ${esc(D.source_dates[id]?.holdings||"—")} · secteurs : ${esc(D.source_dates[id]?.sectors||"—")}</small></td></tr>`).join("");
 }
 function dates(){
  const label=list=>list[0]+" → "+list.at(-1)+" · "+list.length+" mois";
  $("frontierDates").textContent="Calibration : "+label(prepared.dates.fit)+(prepared.validation?" · Validation : "+label(prepared.dates.validation):" · Pas de validation séparée")+" · CAD";
  const rf=D.optimization.risk_free;$("frontierRiskFreeNote").textContent="Taux sans risque constant de comparaison : "+pct(prepared.riskFree,2)+" par an"+(rf?.date?", observation du "+rf.date:"")+". Ce taux courant n’est pas une série historique de taux; le laboratoire ne prétend pas reconstituer une décision réellement prise au début de la période.";
 }

 function showExposures(){
  const e=U.exposures(prepared,weights);if(!e||!$("frontierExposures"))return;
  const rows=(title,names,values,reference)=>'<section><h4>'+title+'</h4><table><thead><tr><th>Exposition</th><th>Simulation</th><th>VEQT</th><th>Écart</th></tr></thead><tbody>'+values.map((v,i)=>'<tr><th scope="row">'+esc(names[i])+'</th><td>'+pct(v)+'</td><td>'+pct(reference[i])+'</td><td>'+pct(v-reference[i])+'</td></tr>').join("")+'</tbody></table></section>';
  $("frontierExposureSummary").textContent="Diversification "+(e.valid?"conforme":"hors limites")+" · écart régional max. "+pct(e.maxGeoGap)+" · secteur max. "+pct(e.maxSector);
  $("frontierAssetMix").textContent="Composition réelle : "+[["equity","actions"],["gold","or physique"],["crypto","crypto"],["bond","obligations"],["cash","liquidités"]].filter(([key])=>key==="crypto"||e.assets[key]>.00005).map(([key,label])=>label+" "+pct(e.assets[key])+(key==="crypto"?" / "+pct(prepared.limits.cryptoCap,0)+" maximum":"")).join(" · ")+". Régions et secteurs calculés sur la poche actions.";
  $("frontierExposures").innerHTML=rows("Régions · poche actions",D.geo_names,e.geo,prepared.limits.refGeo)+rows("Secteurs · poche actions",D.sector_names,e.sector,prepared.limits.refSector);
  root.dataset.exposures=JSON.stringify(e);
 }
 function comparisons(){
  if(!$("frontierComparison"))return;
  const choices=[["sharpe","Sharpe maximal",solution.sharpe],["information","IR maximal",solution.information],["compromise","Compromis",U.compromise(solution.pareto,priority)]];
  $("frontierComparison").innerHTML='<table><thead><tr><th>Profil</th><th>Sharpe calibration</th><th>IR calibration</th><th>CAGR validation</th><th>Sharpe validation</th><th>IR validation</th></tr></thead><tbody>'+choices.map(([key,label,p])=>{
   if(!p)return '<tr><th>'+label+'</th><td colspan="5">Ratio positif indisponible</td></tr>';
   const v=prepared.validation?U.metrics(prepared.validation,p.weights):null;
   return '<tr><th><button type="button" data-frontier-profile="'+key+'">'+label+'</button><details><summary>Composition</summary><p>'+prepared.ids.map((id,i)=>p.weights[i]>.00005?esc(id)+" "+pct(p.weights[i]):"").filter(Boolean).join(" · ")+'</p></details></th><td>'+number(p.sharpe)+'</td><td>'+number(p.information)+'</td><td>'+pct(v?.cagr)+'</td><td>'+number(v?.sharpe)+'</td><td>'+number(v?.information)+'</td></tr>';
  }).join("")+(()=>{const v=prepared.validation?.reference;return '<tr><th>VEQT</th><td>'+number(prepared.fit.reference.sharpe)+'</td><td>—</td><td>'+pct(prepared.validation?prepared.validation.benchmark.reduce((p,r)=>p*(1+r),1)**(12/prepared.validation.n)-1:null)+'</td><td>'+number(v?.sharpe)+'</td><td>—</td></tr>';})()+'</tbody></table>';
 }

 function updateMetrics(){
  if(!prepared||!weights||loading)return;
  const m=U.metrics(prepared.fit,weights),test=prepared.validation?U.metrics(prepared.validation,weights):null;
  for(const [id,field,format] of [["Mean","mean",pct],["Vol","vol",pct],["Sharpe","sharpe",number],["IR","information",number]]){
   $("frontier"+id).textContent=format(m[field]);$("frontier"+id+"Test").textContent=test?"Validation : "+format(test[field]):"Sans validation distincte";
  }
  const b=prepared.fit.reference;$("frontierBenchmark").textContent="VEQT · même calibration : moyenne "+pct(b.mean)+" · volatilité "+pct(b.vol)+" · Sharpe "+number(b.sharpe)+". Son IR contre lui-même est non défini.";
  $("frontierActive").textContent="Simulation / VEQT : excédent moyen "+pct(m.excess,2)+"/an · tracking error "+pct(m.tracking,2)+(test?". Validation : "+pct(test.excess,2)+"/an · tracking error "+pct(test.tracking,2):"")+".";
  $("frontierCagr").textContent="CAGR de la simulation : "+pct(m.cagr,2)+(test?"; sur la validation : "+pct(test.cagr,2):"")+".";
  $("frontierSelection").textContent=labels[profile]+" · "+selectedIds.length+" FNB admissibles · "+weights.filter(v=>v>.00005).length+" positions · plafond général "+pct(cap,0)+" · poids total "+pct(weights.reduce((s,v)=>s+v,0),1)+". Simulation locale uniquement.";
  $("frontierTotal").textContent=pct(weights.reduce((s,v)=>s+v,0),1);
  $("frontierPriorityLabel").textContent="Sharpe "+Math.round(priority*100)+" % · IR "+Math.round((1-priority)*100)+" %";
  const marginals=U.marginals(prepared,weights);
  selectedIds.forEach((id,i)=>{
   $("frontierWeight"+i).value=String(weights[i]*100);$("frontierWeightLabel"+i).textContent=pct(weights[i]);
   const row=root.querySelector('[data-frontier-fund="'+id+'"]');row.hidden=weights[i]<.00005&&!$("frontierShowZeros")?.checked;
   for(const metric of ["sharpe","information"]){const cell=row.querySelector('[data-frontier-delta="'+metric+'"]'),v=marginals[i][metric];cell.textContent=delta(v);cell.className=v>1e-8?"positive":v< -1e-8?"negative":"";}
  });
  for(const [id,name] of [["frontierMaxSharpe","sharpe"],["frontierMaxIR","information"],["frontierBalanced","compromise"],["frontierReset","seed"]])$(id).setAttribute("aria-pressed",String(profile===name));
  showExposures();comparisons();root.dataset.weights=JSON.stringify(savedWeights());root.dataset.metrics=JSON.stringify(m);moveMarker(m);save();
 }
 function coordinates(p){return mode==="active"?[p.tracking,p.excess]:mode==="ratios"?[p.sharpe,p.information]:[p.vol,p.mean];}
 function curve(){
  const list=mode==="active"?solution.active:mode==="ratios"?solution.pareto:solution.absolute,out=[];
  for(const p of list){const [x,y]=coordinates(p);if(!finite(x)||!finite(y))continue;if(!out.length||Math.abs(x-coordinates(out.at(-1))[0])>1e-8||Math.abs(y-coordinates(out.at(-1))[1])>1e-8)out.push(p);}
  return out;
 }
 function markerPosition(p){const [x,y]=coordinates(p);return finite(x)&&finite(y)?[plot.x(x),plot.y(y)]:null;}
 function moveMarker(m){
  if(!plot)return;const p=markerPosition(m),node=$("frontierSelectedMarker");
  if(!p){node.setAttribute("visibility","hidden");return;}
  if(p[0]<plot.pad.l||p[0]>plot.W-plot.pad.r||p[1]<plot.pad.t||p[1]>plot.H-plot.pad.b){draw();return;}
  node.removeAttribute("visibility");node.setAttribute("cx",p[0]);node.setAttribute("cy",p[1]);
 }
 function choose(point,name){if(!point||loading)return;weights=[...point.weights];profile=name;updateMetrics();}
 function draw(){
  if(!solution||!prepared||root.hidden||loading)return;cancelAnimationFrame(chartTimer);
  const host=$("frontierPlot"),W=Math.max(270,host.clientWidth),H=W<500?300:355,pad={l:57,r:18,t:20,b:51},line=curve(),current=U.metrics(prepared.fit,weights),reference=prepared.fit.reference;
  const observations=[...solution.cloud,...line,current,...[solution.sharpe,solution.information].filter(Boolean),...(mode==="ratios"?[]:[reference])].map(coordinates).filter(p=>p.every(finite));
  if(!observations.length){host.textContent="Ratios non définis pour cet univers. Choisissez une autre vue.";plot=null;$("frontierTrace").max="0";$("frontierTrace").disabled=true;return;}
  let minX=Math.min(...observations.map(p=>p[0])),maxX=Math.max(...observations.map(p=>p[0])),minY=Math.min(...observations.map(p=>p[1])),maxY=Math.max(...observations.map(p=>p[1]));
  const dx=(maxX-minX)*.12||.05,dy=(maxY-minY)*.13||.05;minX-=dx;maxX+=dx;minY-=dy;maxY+=dy;if(mode!=="ratios")minX=Math.max(0,minX);
  const x=v=>pad.l+8+(v-minX)/(maxX-minX)*(W-pad.l-pad.r-16),y=v=>H-pad.b-8-(v-minY)/(maxY-minY)*(H-pad.t-pad.b-16);
  plot={W,H,pad,x,y,line};const text=(x,y,s,attrs="")=>`<text x="${x}" y="${y}" ${attrs}>${esc(s)}</text>`,fmt=v=>mode==="ratios"?number(v,1):number(v*100,0)+" %";
  let body=`<title>Frontière ${mode==="active"?"active face à VEQT":mode==="ratios"?"de compromis Sharpe et information":"moyenne–variance"}</title><desc>Allocations historiques admissibles, référence VEQT et simulation choisie. Le curseur sous le graphique permet de parcourir les allocations au clavier.</desc><rect x="${pad.l}" y="${pad.t}" width="${W-pad.l-pad.r}" height="${H-pad.t-pad.b}" class="frontier-chart-frame"/>`;
  for(let k=0;k<4;k++){const a=minX+(maxX-minX)*k/3,b=minY+(maxY-minY)*k/3;body+=`<path d="M${pad.l} ${y(b)}H${W-pad.r}" class="frontier-grid"/>`+text(pad.l-7,y(b)+4,fmt(b),'text-anchor="end"')+text(x(a),H-pad.b+20,fmt(a),`text-anchor="${k===0?"start":k===3?"end":"middle"}"`);}
  const xLabel=mode==="active"?"Tracking error annualisée (%)":mode==="ratios"?"Ratio de Sharpe":"Volatilité annualisée (%)",yLabel=mode==="active"?"Excédent moyen / VEQT (%/an)":mode==="ratios"?"Ratio d’information / VEQT":"Moyenne annualisée (%/an)";
  body+=text(pad.l,12,yLabel,'class="frontier-axis-title"')+text((pad.l+W-pad.r)/2,H-4,xLabel,'text-anchor="middle" class="frontier-axis-title"');
  body+=solution.cloud.map(p=>{const q=markerPosition(p);return q?`<circle cx="${q[0]}" cy="${q[1]}" r="2" class="frontier-cloud"/>`:"";}).join("");
  body+=`<path d="${line.map((p,i)=>{const q=markerPosition(p);return (i?"L":"M")+q.join(" ");}).join(" ")}" class="frontier-line"/>`;
  for(const [p,kind] of [[reference,"benchmark"],[solution.sharpe,"sharpe"],[solution.information,"information"]]){
   if(!p)continue;const q=markerPosition(p);if(!q)continue;
   body+=kind==="sharpe"?`<rect x="${q[0]-5}" y="${q[1]-5}" width="10" height="10" class="frontier-mark sharpe"/>`:kind==="information"?`<path d="M${q[0]} ${q[1]-6}l6 11h-12z" class="frontier-mark information"/>`:`<circle cx="${q[0]}" cy="${q[1]}" r="5" class="frontier-mark benchmark"/>`;
  }
  body+='<circle id="frontierSelectedMarker" r="7" class="frontier-mark selected"/>';
  host.innerHTML=`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(xLabel+" et "+yLabel)}">${body}</svg><div class="frontier-tooltip" role="tooltip" hidden></div>`;
  const svg=host.querySelector("svg"),tip=host.querySelector(".frontier-tooltip");let dragging=false,last;
  const nearest=event=>{const box=svg.getBoundingClientRect(),px=(event.clientX-box.left)*W/box.width,py=(event.clientY-box.top)*H/box.height;return line.reduce((best,p)=>{const q=markerPosition(p),distance=(q[0]-px)**2+(q[1]-py)**2;return !best||distance<best.distance?{point:p,distance,px,py}:best;},null);};
  function pointer(event){const nearestPoint=nearest(event);if(!nearestPoint)return;last=nearestPoint;if(dragging){choose(nearestPoint.point,"frontier");$("frontierTrace").value=String(line.indexOf(nearestPoint.point));}tip.textContent="Moyenne "+pct(nearestPoint.point.mean)+" · vol. "+pct(nearestPoint.point.vol)+" · Sharpe "+number(nearestPoint.point.sharpe)+" · IR "+number(nearestPoint.point.information);tip.hidden=false;tip.style.left=Math.max(0,Math.min(W-225,nearestPoint.px-90))+"px";tip.style.top=Math.max(24,nearestPoint.py-55)+"px";}
  svg.addEventListener("pointerdown",e=>{if(e.button!==0)return;dragging=true;svg.setPointerCapture(e.pointerId);pointer(e);});svg.addEventListener("pointermove",e=>{cancelAnimationFrame(chartTimer);chartTimer=requestAnimationFrame(()=>pointer(e));});
  svg.addEventListener("pointerup",e=>{dragging=false;if(svg.hasPointerCapture(e.pointerId))svg.releasePointerCapture(e.pointerId);});svg.addEventListener("pointercancel",()=>{dragging=false;tip.hidden=true;});svg.addEventListener("pointerleave",()=>{if(!dragging)tip.hidden=true;});
  $("frontierTrace").max=String(Math.max(0,line.length-1));$("frontierTrace").disabled=line.length<2;
  $("frontierChartNote").textContent=mode==="ratios"?"Compromis non dominés parmi les allocations calculées, pas une frontière multicritère exhaustive. IR de VEQT non défini : il n’est pas placé à zéro ici.":"Touchez ou faites glisser la frontière, ou utilisez le curseur. Les points gris sont des allocations admissibles, pas la frontière elle-même.";
  moveMarker(current);
 }
 function complete(result,id){
  if(id!==generation)return;solution=result;loading=false;root.setAttribute("aria-busy","false");root.dataset.ready="true";$("frontierContent").hidden=false;$("frontierError").hidden=true;
  for(const button of root.querySelectorAll('.frontier-presets button'))button.disabled=false;
  $("frontierExport").disabled=false;
  $("frontierPriority").disabled=false;
  $("frontierMaxSharpe").disabled=!solution.sharpe;$("frontierMaxIR").disabled=!solution.information;$("frontierBalanced").disabled=!solution.pareto.length;
  const limits=prepared.limits, points=v=>new Intl.NumberFormat("fr-CA",{maximumFractionDigits:2}).format(v*100);
  $("frontierStatus").textContent="FNB cotés au Canada · sur la poche actions : régions à ±"+points(limits.geoTolerance)+" points et secteurs à ±"+points(limits.sectorTolerance)+" points de VEQT, maximum sectoriel "+points(limits.sectorCap)+" %. "+(!solution.sharpe?"Pas d’excédent positif avec un Sharpe fini. ":"")+(!solution.information?"Pas d’excédent positif avec un IR fini face à VEQT. ":"");
  table();dates();draw();updateMetrics();
 }
 function fail(error,id){if(id!==generation)return;loading=false;root.setAttribute("aria-busy","false");root.dataset.ready="error";$("frontierContent").hidden=true;$("frontierError").hidden=false;$("frontierError").textContent=error.message||String(error);$("frontierStatus").textContent="Les autres vues et les portefeuilles enregistrés restent inchangés.";}
 function calculate(){
  const id=++generation;worker?.terminate();clearTimeout(pending);loading=true;root.dataset.ready="false";root.setAttribute("aria-busy","true");$("frontierStatus").textContent="Calcul des frontières et contrôle des allocations…";
  $("frontierExport").disabled=true;
  $("frontierPriority").disabled=true;for(const input of root.querySelectorAll('[data-frontier-weight]'))input.disabled=true;
  $("frontierError").hidden=true;for(const button of root.querySelectorAll('.frontier-presets button'))button.disabled=true;
  pending=setTimeout(()=>{
   try{
    const fresh=!prepared,old=weights&&prepared?Object.fromEntries(prepared.ids.map((name,i)=>[name,weights[i]])):seedWeights();
    prepared=U.prepare(D,{ids:selectedIds,cap,sample});weights=U.allocate(prepared,selectedIds.map(name=>old[name]||0));if(!fresh)profile="custom";
    const modelKey=JSON.stringify({ids:selectedIds,cap,sample}),calculationPrepared=prepared;if(cache.has(modelKey)){complete(cache.get(modelKey),id);return;}
    const done=result=>{if(id!==generation)return;cache.set(modelKey,result);if(cache.size>4)cache.delete(cache.keys().next().value);complete(result,id);};
    const fallback=()=>{if(id!==generation)return;pending=setTimeout(()=>{try{done(U.solve(calculationPrepared));}catch(error){fail(error,id);}},0);};
    if(typeof Worker!=="undefined"){
     try{const currentWorker=new Worker(workerUrl);worker=currentWorker;currentWorker.onmessage=event=>{if(event.data.id!==generation)return;event.data.error?fail(Error(event.data.error),id):done(event.data.result);};currentWorker.onerror=()=>{if(id!==generation)return;currentWorker.terminate();fallback();};currentWorker.postMessage({id,prepared:calculationPrepared});}catch{fallback();}
    }else fallback();
   }catch(error){fail(error,id);}
  },100);
 }
 function reset(){weights=U.allocate(prepared,selectedIds.map(id=>seedWeights()[id]||0));profile="seed";updateMetrics();}
 function bind(){
  $("frontierShowZeros")?.addEventListener("change",updateMetrics);
  $("frontierComparison")?.addEventListener("click",event=>{const name=event.target.dataset.frontierProfile;if(name)choose(name==="compromise"?U.compromise(solution.pareto,priority):solution[name],name);});
  $("frontierAllFunds")?.addEventListener("click",()=>{selectedIds=[...D.optimization.eligible_funds];fundControls();calculate();});
  $("frontierCap").addEventListener("change",event=>{const next=Number(event.target.value);if(selectedIds.length*next<1-1e-9){event.target.value=String(cap);$("frontierError").hidden=false;$("frontierError").textContent="Choisissez au moins "+Math.ceil(1/next)+" FNB pour ce plafond.";return;}cap=next;calculate();});
  $("frontierSample").addEventListener("change",event=>{sample=event.target.value;calculate();});
  $("frontierFundChoices").addEventListener("change",event=>{const ids=[...root.querySelectorAll('[data-frontier-include]:checked')].map(n=>n.dataset.frontierInclude);if(ids.length*cap<1-1e-9){event.target.checked=true;$("frontierError").hidden=false;$("frontierError").textContent="Conservez au moins "+Math.ceil(1/cap)+" FNB pour ce plafond.";return;}selectedIds=ids;calculate();});
  $("frontierWeights").addEventListener("input",event=>{if(!event.target.hasAttribute("data-frontier-weight")||loading)return;weights=U.edit(prepared,weights,Number(event.target.dataset.frontierWeight),Number(event.target.value)/100);profile="custom";updateMetrics();});
  $("frontierMode").addEventListener("change",event=>{mode=event.target.value;draw();save();});
  $("frontierTrace").addEventListener("input",event=>choose(plot?.line[Number(event.target.value)],"frontier"));
  $("frontierMaxSharpe").addEventListener("click",()=>choose(solution.sharpe,"sharpe"));$("frontierMaxIR").addEventListener("click",()=>choose(solution.information,"information"));
  const balanced=()=>choose(U.compromise(solution.pareto,priority),"compromise");$("frontierBalanced").addEventListener("click",()=>{$("frontierPriorityPanel").open=true;balanced();});
  $("frontierPriority").addEventListener("input",event=>{if(loading)return;priority=Number(event.target.value)/100;balanced();});$("frontierReset").addEventListener("click",reset);
  $("frontierExport").addEventListener("click",()=>{if(loading)return;const payload={constraints:{crypto_cap:prepared.limits.cryptoCap,geo_tolerance:prepared.limits.geoTolerance,sector_tolerance:prepared.limits.sectorTolerance,sector_cap:prepared.limits.sectorCap,fund_caps:Object.fromEntries(prepared.ids.map((id,i)=>[id,prepared.limits.caps[i]]))},exposures:U.exposures(prepared,weights),kind:"savy_frontier_local_simulation",exported_at:new Date().toISOString(),currency:"CAD",benchmark:"VEQT",calibration:prepared.dates.fit,validation:prepared.dates.validation,as_of:prepared.asOf,max_fund_weight:cap,rebalance:"monthly",risk_free:prepared.riskFree,weights:savedWeights(),calibration_metrics:U.metrics(prepared.fit,weights),validation_metrics:prepared.validation?U.metrics(prepared.validation,weights):null,warning:"Exploration historique uniquement; aucun portefeuille enregistré ou suivi prospectif modifié."};const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:"application/json"})),a=document.createElement("a");a.href=url;a.download="SAVY_Frontiere_Simulation.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  let width=0;if(typeof ResizeObserver!=="undefined")new ResizeObserver(entries=>{const next=entries[0].contentRect.width;if(next>0&&Math.abs(next-width)>1){width=next;cancelAnimationFrame(chartTimer);chartTimer=requestAnimationFrame(draw);}}).observe($("frontierPlot"));
 }
 function show(data){
  root=$("frontier");if(!root)return;
  if(initialized){requestAnimationFrame(draw);return;}initialized=true;D=U.extend(data,JSON.parse($("frontierExtra")?.textContent||"null"));selectedIds=[...D.optimization.eligible_funds];key="savy:fnb-frontier:v4:"+D.assumptions.as_of+":"+D.optimization.source_digest;
  try{
   const current=JSON.parse(localStorage.getItem(key)),v3=current?null:JSON.parse(localStorage.getItem(key.replace(":v4:",":v3:"))),v2=current||v3?null:JSON.parse(localStorage.getItem(key.replace(":v4:",":v2:"))),saved=current||v3||v2;
   if(saved&&["risk","active","ratios"].includes(saved.mode)&&["split","all"].includes(saved.sample)&&[.25,.35,.4,.5,1].includes(saved.cap)&&finite(saved.priority)&&saved.priority>=0&&saved.priority<=1){
    // Migrate the former default once; a new explicit stricter cap remains usable.
    const nextCap=!current&&saved.cap===.35?.5:saved.cap,check=U.prepare(D,{...saved,cap:nextCap,ids:v2?D.optimization.eligible_funds:saved.ids});
    cap=nextCap;sample=saved.sample;mode=saved.mode;priority=saved.priority;selectedIds=check.ids;prepared=check;weights=U.allocate(prepared,selectedIds.map(id=>saved.weights[id]||0));
   }
  }catch{}
  $("frontierShowZeros")?.setAttribute("checked","");
  if($("frontierShowZeros"))$("frontierShowZeros").checked=true;
  $("frontierCap").value=String(cap);$("frontierSample").value=sample;$("frontierMode").value=mode;$("frontierPriority").value=String(priority*100);fundControls();bind();calculate();
 }
 window.SavyFnbFrontier={show};
})();
