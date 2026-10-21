"use strict";
window.SavyFnbPerformance=(()=>{
 const U=SavyPerformanceUtils,$=id=>document.getElementById(id),esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const num=(n,d=2)=>n==null?"—":new Intl.NumberFormat("fr-CA",{minimumFractionDigits:d,maximumFractionDigits:d}).format(Math.abs(n)<1e-9?0:n),money=n=>n==null?"—":num(n)+" $",pct=n=>n==null?"—":num(n*100)+" %",date=d=>new Date(d+"T12:00:00Z").toLocaleDateString("fr-CA",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"});
 let data=null,loading=false,loaded=0,reference="VEQT",focus="",index=0,rows=[],dates=[],selected=new Set();
 const storage="savy-fnb-common-v1",root=new URL("../",document.currentScript.src),label=a=>a.kind==="benchmark"?a.id:a.name,ink=a=>a.color==="#142333"?"var(--text)":a.color==="#9ce3cb"?"var(--accent)":a.color;
 const simulated=a=>a.series_type==='simulation';
 function persist(){try{localStorage.setItem(storage,JSON.stringify({reference,focus,selected:[...selected],known:data.accounts.map(a=>a.id)}));}catch{}}
 function restore(){
  selected=new Set(data.accounts.map(a=>a.id));
  try{const p=JSON.parse(localStorage.getItem(storage));if(!p)return;
   if(data.benchmarks.includes(p.reference))reference=p.reference;
   if(data.accounts.some(a=>a.id===p.focus&&a.kind!=='benchmark'))focus=p.focus;
   if(Array.isArray(p.selected)){const known=new Set(p.known||[]);selected=new Set(data.accounts.filter(a=>p.selected.includes(a.id)||!known.has(a.id)).map(a=>a.id));}
   if(focus)selected=new Set([focus,reference]);
  }catch{}
 }
 function follow(id){const a=data.accounts.find(a=>a.id===id&&a.kind!=='benchmark');focus=a?.id||'';if(a){selected=new Set([a.id,reference]);$("performancePositions").value=a.id;positions();}render();}
 function positions(){
  const a=data.accounts.find(a=>a.id===$("performancePositions").value);if(!a)return;
  if(!a.history.length){$("performanceWeights").textContent=a.unavailable_reason;return;}
  $("performanceWeights").innerHTML='<table><thead><tr><th>FNB · '+esc(date(data.inception))+'</th><th>Poids de départ</th><th>Clôture $</th><th>Parts au départ commun</th></tr></thead><tbody>'+a.initial_positions.map(p=>`<tr><th scope="row">${esc(p.ticker)}<small>${esc(p.name)}</small></th><td>${pct(p.weight)}</td><td>${money(p.close)}</td><td>${num(p.units,6)}</td></tr>`).join('')+'</tbody></table>';
 }
 function readout(i){
  index=Math.max(0,Math.min(dates.length-1,Number(i)||0));$("performanceSlider").value=String(index);const day=dates[index];if(!day)return;
  $("performanceDate").textContent=date(day);const chosen=rows.filter(a=>selected.has(a.id)).map(a=>({a,point:a.history.find(h=>h.date===day)})).filter(p=>p.point).sort((a,b)=>b.point.value-a.point.value);
  $("performanceReadout").innerHTML=chosen.map(({a,point})=>`<span><i class="dot" style="background:${ink(a)}"></i>${esc(label(a))} <b>${money(point.value)}</b></span>`).join('');
  const cursor=$("performanceCursor");if(cursor){const W=Number(cursor.dataset.width),x=dates.length===1?W/2:62+index/(dates.length-1)*(W-80);cursor.setAttribute('x1',x);cursor.setAttribute('x2',x);}
 }
 function chart(){
  if(!dates.length){$("performanceChart").innerHTML='<p class="method-summary">En attente des clôtures du départ commun.</p>';$("performanceReadout").textContent='';return;}
  const host=$("performanceChart"),W=Math.max(260,host.clientWidth||800),H=245,p={l:62,r:18,t:16,b:32},w=W-p.l-p.r,h=H-p.t-p.b,chosen=rows.filter(a=>selected.has(a.id)&&a.history.length);
  let lo=10000,hi=10000;for(const a of chosen)for(const point of a.history){lo=Math.min(lo,point.value);hi=Math.max(hi,point.value);}const pad=Math.max(100,(hi-lo)*.12),min=lo-pad,max=hi+pad;
  const x=i=>dates.length===1?W/2:p.l+i/(dates.length-1)*w,y=v=>H-p.b-(v-min)/(max-min)*h,text=(x,y,s,attr='')=>`<text x="${x}" y="${y}" fill="var(--muted)" font-size="10" ${attr}>${esc(s)}</text>`;
  let body='';for(let i=0;i<=4;i++){const v=min+(max-min)*i/4;body+=`<line x1="${p.l}" x2="${W-p.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)"/>`+text(p.l-7,y(v)+4,num(v,0),'text-anchor="end"');}
  const ticks=dates.length===1?[0]:[...new Set(Array.from({length:W<450?2:4},(_,i)=>Math.round(i*(dates.length-1)/(W<450?1:3))))];
  for(const i of ticks)body+=text(x(i),H-8,date(dates[i]),`text-anchor="${i===0&&dates.length>1?'start':i===dates.length-1&&dates.length>1?'end':'middle'}"`);
  const indices=new Map(dates.map((d,i)=>[d,i]));for(const a of chosen){const path=a.history.map((v,i)=>(i?'L':'M')+x(indices.get(v.date)).toFixed(2)+','+y(v.value).toFixed(2)).join(' ');body+=`<g class="performance-series" data-performance-id="${esc(a.id)}"><title>${esc(label(a)+(simulated(a)?' · simulation depuis le départ commun':''))}</title><path d="${path}" fill="none" stroke="${ink(a)}" stroke-width="${a.id===reference?3:1.8}" ${a.kind==='benchmark'?'stroke-dasharray="5 3"':''}/>${a.history.length===1?`<circle cx="${x(indices.get(a.history[0].date))}" cy="${y(a.history[0].value)}" r="4" fill="${ink(a)}"/>`:''}</g>`;}
  body+=`<line id="performanceCursor" data-width="${W}" x1="0" x2="0" y1="${p.t}" y2="${H-p.b}" stroke="var(--muted)" stroke-dasharray="3 4"/>`;
  if(!chosen.length)body+=text(W/2,H/2,'Choisir des portefeuilles pour les comparer.','text-anchor="middle"');
  host.innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Croissance quotidienne de dix mille dollars depuis le départ commun">${body}</svg>`;host.querySelector('svg').addEventListener('pointermove',e=>{const box=e.currentTarget.getBoundingClientRect(),px=(e.clientX-box.left)/box.width*W;readout(dates.length===1?0:Math.round((px-p.l)/w*(dates.length-1)));});readout(index);
 }
 function render(){
  rows=data.accounts;dates=[...new Set(rows.flatMap(a=>a.history.map(p=>p.date)))].sort();index=Math.max(0,dates.length-1);
  $("performanceBenchmark").value=reference;$("performanceGap").textContent="Écart / "+reference;$("performanceFocus").value=focus;
  $("performanceChoices").innerHTML=rows.map(a=>`<label><input type="checkbox" data-performance-choice="${esc(a.id)}" ${selected.has(a.id)?'checked':''}><i class="dot" style="background:${ink(a)}"></i>${esc(label(a))}${simulated(a)?' · simulé':''}</label>`).join('');
  $("performanceCount").textContent='('+rows.filter(a=>selected.has(a.id)).length+')';
  const ref=data.accounts.find(a=>a.id===reference),ranks=U.ranking(rows),own=rows.filter(a=>a.kind!=='benchmark'&&a.history.length),leader=[...own].sort((a,b)=>U.metrics(b.history).total-U.metrics(a.history).total)[0];
  const ties=leader?own.filter(a=>Math.abs(U.metrics(a.history).total-U.metrics(leader.history).total)<1e-9).length:0,beaten=own.filter(a=>U.gap(a,ref)>1e-9).length;
  $("performanceKpis").innerHTML=[["Départ commun",date(data.inception)],["Premier au classement",ties>1?ties+' ex æquo':leader?label(leader):'En attente'],["SAVY devant "+reference,beaten+' / '+own.length],["Clôture validée",date(data.as_of)]].map(([k,v])=>`<div class="kpi"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('');
  const order=[...rows].sort((a,b)=>a.kind==='benchmark'?(b.kind==='benchmark'?data.benchmarks.indexOf(a.id)-data.benchmarks.indexOf(b.id):1):b.kind==='benchmark'?-1:(ranks.get(a.id)||99)-(ranks.get(b.id)||99)||a.id.localeCompare(b.id,"fr",{numeric:true}));
  $("performanceBody").innerHTML=order.map(a=>{const m=U.metrics(a.history),gap=U.gap(a,ref);return `<tr data-performance-row="${esc(a.id)}" class="${a.kind==='benchmark'?'benchmark':''}"><td>${ranks.get(a.id)||'—'}</td><th scope="row"><i class="dot" style="background:${ink(a)}"></i>${esc(label(a))}<small>${a.history.length?(simulated(a)?'Simulation depuis le '+esc(date(data.inception)):'Depuis le '+esc(date(data.inception))):esc(a.unavailable_reason)}</small></th><td>${money(m.value)}</td><td>${money(m.gain)}</td><td>${pct(m.total)}</td><td>${pct(m.day)}</td><td>${pct(m.week)}</td><td>${pct(m.month)}</td><td>${gap==null?'—':num(gap*100)+' pts'}</td></tr>`;}).join('');
  const followed=data.accounts.find(a=>a.id===focus);
  $("performanceChartNote").textContent=(followed?label(followed)+' / '+reference+' · ':'')+'10 000 $ CA chacun à la clôture du '+date(data.inception)+'. Les ajouts ultérieurs sont simulés depuis cette même date avec leurs pondérations figées.'+(dates.length===1?' Les variations commenceront à la prochaine clôture.':'');
  $("performanceSlider").max=String(Math.max(0,dates.length-1));$("performanceSlider").disabled=dates.length<2;chart();persist();
 }
 function download(name,body,type){const url=URL.createObjectURL(new Blob([body],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 async function show(){
  if(!$("performance"))return;
  if(location.pathname.includes('/fnb-history/')){$("performanceStatus").innerHTML='Archive figée. <a href="'+new URL('reports/portefeuilles-fnb.html',root).href+'">Ouvrir la comparaison courante ↗</a>';return;}
  if(data&&Date.now()-loaded<600000){requestAnimationFrame(chart);return;}if(loading)return;loading=true;$("performanceRetry").hidden=true;
  try{
   const response=await fetch(new URL('data/fnb-comparison.json',root),{cache:'no-cache'});if(!response.ok)throw Error('Comparaison indisponible');data=U.validateComparison(await response.json());loaded=Date.now();restore();
   $("performanceStart").textContent=date(data.inception);
   $("performanceFocus").innerHTML='<option value="">Sélection libre des courbes</option>'+data.accounts.filter(a=>a.kind!=='benchmark').map(a=>`<option value="${esc(a.id)}">${esc(label(a))}</option>`).join('');
   $("performancePositions").innerHTML=data.accounts.map(a=>`<option value="${esc(a.id)}">${esc(label(a))}${simulated(a)?' · simulation':''}</option>`).join('');if(focus)$("performancePositions").value=focus;positions();
   $("performanceRecorded").href=new URL('data/fnb-performance.json',root).href;
   $("performanceLedger").href='https://github.com/osavaria11-bot/Bourse/tree/main/data/fnb-performance/days';$("performanceContent").hidden=false;
   const unavailable=data.accounts.filter(a=>!a.history.length).length;
   $("performanceStatus").textContent='Départ commun le '+date(data.inception)+' · clôture du '+date(data.as_of)+' · actualisation après les marchés.'+(unavailable?' '+unavailable+' historique(s) incomplet(s), signalés dans le tableau.':'');
   render();$("performance").dataset.ready='true';
  }catch(e){$("performanceStatus").textContent='La comparaison commune n’a pas pu être chargée. Réessayer pour afficher les dernières données validées.';$("performanceRetry").hidden=false;}finally{loading=false;}
 }
 document.addEventListener('change',e=>{const el=e.target;if(!data)return;if(el.id==='performanceFocus')follow(el.value);if(el.id==='performanceBenchmark'){reference=el.value;if(focus)selected=new Set([focus,reference]);else selected.add(reference);render();}if(el.dataset.performanceChoice){focus="";el.checked?selected.add(el.dataset.performanceChoice):selected.delete(el.dataset.performanceChoice);render();}if(el.id==='performancePositions')positions();});
 document.addEventListener('input',e=>{if(e.target.id==='performanceSlider')readout(e.target.value);});
 document.addEventListener('click',e=>{const id=e.target.closest('button')?.id;if(id==='performanceRetry'){loaded=0;show();}if(!data)return;
  if(id==='performanceRobust'){focus="";selected=new Set([...rows.filter(a=>a.id.startsWith('robust-')).map(a=>a.id),...data.benchmarks]);render();}
  if(id==='performanceAll'){focus="";selected=new Set(rows.map(a=>a.id));render();}if(id==='performanceNone'){focus="";selected.clear();render();}
  if(id==='performanceJson')download('SAVY_Depart_Commun.json',JSON.stringify(data,null,2),'application/json');
  if(id==='performanceCsv'){const cell=v=>'"'+String(v??'').replaceAll('"','""')+'"',lines=[['Date',...rows.map(a=>label(a)+(simulated(a)?' · simulation':''))],...dates.map(d=>[d,...rows.map(a=>a.history.find(p=>p.date===d)?.value??'')])];download('SAVY_Suivi_quotidien_depart_commun.csv','\uFEFF'+lines.map(r=>r.map(cell).join(',')).join('\n'),'text/csv;charset=utf-8');}
 });
 let resize;addEventListener('resize',()=>{cancelAnimationFrame(resize);if(data&&!$("performance").hidden)resize=requestAnimationFrame(chart);});
 return{show};
})();
