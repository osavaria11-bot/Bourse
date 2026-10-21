"use strict";
window.SavyFnbPerformance=(()=>{
 const U=SavyPerformanceUtils,$=id=>document.getElementById(id),esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const num=(n,d=2)=>n==null?"—":new Intl.NumberFormat("fr-CA",{minimumFractionDigits:d,maximumFractionDigits:d}).format(Math.abs(n)<1e-9?0:n),money=n=>n==null?"—":num(n)+" $",pct=n=>n==null?"—":num(n*100)+" %",date=d=>new Date(d+"T12:00:00Z").toLocaleDateString("fr-CA",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"});
 let data=null,loading=false,loaded=0,cohort="all",reference="VEQT",index=0,rows=[],dates=[],selected=new Set(["savy-2","proposal-2026-10","robust-2026-10-1","robust-2026-10-2","robust-2026-10-3","FEQT","VEQT","VGRO","VBAL"]);
 const root=new URL("../",document.currentScript.src),label=a=>a.kind==="benchmark"?a.id:a.name,ink=a=>a.color==="#142333"?"var(--text)":a.color==="#9ce3cb"?"var(--accent)":a.color;
 function persist(){try{localStorage.setItem("savy-fnb-performance",JSON.stringify({cohort,reference,selected:[...selected]}));}catch{}}
 function restore(){try{const p=JSON.parse(localStorage.getItem("savy-fnb-performance"));if(p){cohort=p.cohort||cohort;if(data.benchmarks.includes(p.reference))reference=p.reference;if(Array.isArray(p.selected))selected=new Set(p.selected.filter(id=>data.accounts.some(a=>a.id===id)));}}catch{}}
 function currentRows(){return data.accounts.filter(a=>a.kind==="benchmark"||cohort==="all"||a.launch_date===cohort).map(a=>({...a,history:a.kind==="benchmark"&&cohort!=="all"?U.rebase(a,cohort):a.history}));}
 function positions(){const a=data.accounts.find(a=>a.id===$("performancePositions").value);if(!a)return;$("performanceWeights").innerHTML='<table><thead><tr><th>FNB · '+esc(date(a.launch_date))+'</th><th>Poids initial</th><th>Clôture $</th><th>Parts initiales</th></tr></thead><tbody>'+a.initial_positions.map(p=>`<tr><th scope="row">${esc(p.ticker)}<small>${esc(p.name)}</small></th><td>${pct(p.weight)}</td><td>${money(p.close)}</td><td>${num(p.units,6)}</td></tr>`).join('')+'</tbody></table>';}
 function readout(i){
  index=Math.max(0,Math.min(dates.length-1,Number(i)||0));$("performanceSlider").value=String(index);const day=dates[index];if(!day)return;
  $("performanceDate").textContent=date(day);const chosen=rows.filter(a=>selected.has(a.id)).map(a=>({a,point:a.history.find(h=>h.date===day)})).filter(p=>p.point).sort((a,b)=>b.point.value-a.point.value);
  $("performanceReadout").innerHTML=chosen.map(({a,point})=>`<span><i class="dot" style="background:${ink(a)}"></i>${esc(label(a))} <b>${money(point.value)}</b></span>`).join('');
  const cursor=$("performanceCursor");if(cursor){const W=Number(cursor.dataset.width),x=dates.length===1?W/2:62+index/(dates.length-1)*(W-80);cursor.setAttribute('x1',x);cursor.setAttribute('x2',x);}
 }
 function chart(){
  if(!dates.length){$("performanceChart").innerHTML='<p class="method-summary">Le graphique apparaîtra dès que toutes les clôtures de lancement auront été validées.</p>';$("performanceReadout").textContent='';$("performanceDate").textContent=cohort==='all'?'En attente de clôture':'Lancement prévu · '+date(cohort);return;}
  if(!data)return;const host=$("performanceChart"),W=Math.max(260,host.clientWidth||800),H=245,p={l:62,r:18,t:16,b:32},w=W-p.l-p.r,h=H-p.t-p.b,chosen=rows.filter(a=>selected.has(a.id)&&a.history.length);
  let lo=10000,hi=10000;for(const a of chosen)for(const p of a.history){lo=Math.min(lo,p.value);hi=Math.max(hi,p.value);}const pad=Math.max(100,(hi-lo)*.12),min=lo-pad,max=hi+pad;
  const x=i=>dates.length===1?W/2:p.l+i/(dates.length-1)*w,y=v=>H-p.b-(v-min)/(max-min)*h,text=(x,y,s,attr='')=>`<text x="${x}" y="${y}" fill="var(--muted)" font-size="10" ${attr}>${esc(s)}</text>`;
  let body='';for(let i=0;i<=4;i++){const v=min+(max-min)*i/4;body+=`<line x1="${p.l}" x2="${W-p.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)"/>`+text(p.l-7,y(v)+4,num(v,0),'text-anchor="end"');}
  const ticks=dates.length===1?[0]:[...new Set(Array.from({length:W<450?2:4},(_,i)=>Math.round(i*(dates.length-1)/(W<450?1:3))))];
  for(const i of ticks)body+=text(x(i),H-8,date(dates[i]),`text-anchor="${i===0&&dates.length>1?'start':i===dates.length-1&&dates.length>1?'end':'middle'}"`);
  const indices=new Map(dates.map((d,i)=>[d,i]));for(const a of chosen){const path=a.history.map((v,i)=>(i?'L':'M')+x(indices.get(v.date)).toFixed(2)+','+y(v.value).toFixed(2)).join(' ');body+=`<g class="performance-series" data-performance-id="${esc(a.id)}"><title>${esc(label(a))}</title><path d="${path}" fill="none" stroke="${ink(a)}" stroke-width="${a.id===reference?3:1.8}" ${a.kind==='benchmark'?'stroke-dasharray="5 3"':''}/>${a.history.length===1?`<circle cx="${x(indices.get(a.history[0].date))}" cy="${y(a.history[0].value)}" r="4" fill="${ink(a)}"/>`:''}</g>`;}
  body+=`<line id="performanceCursor" data-width="${W}" x1="0" x2="0" y1="${p.t}" y2="${H-p.b}" stroke="var(--muted)" stroke-dasharray="3 4"/>`;
  if(!chosen.length)body+=text(W/2,H/2,'Choisir des portefeuilles pour les comparer.','text-anchor="middle"');
  host.innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Croissance quotidienne de dix mille dollars canadiens">${body}</svg>`;host.querySelector('svg').addEventListener('pointermove',e=>{const box=e.currentTarget.getBoundingClientRect(),px=(e.clientX-box.left)/box.width*W;readout(dates.length===1?0:Math.round((px-p.l)/w*(dates.length-1)));});readout(index);
 }
 function render(){
  rows=currentRows();dates=[...new Set(rows.flatMap(a=>a.history.map(p=>p.date)))].sort();index=Math.max(0,dates.length-1);
  $("performanceBenchmark").value=reference;$("performanceGap").textContent="Écart / "+reference;
  $("performanceChoices").innerHTML=rows.map(a=>`<label><input type="checkbox" data-performance-choice="${esc(a.id)}" ${selected.has(a.id)?'checked':''}><i class="dot" style="background:${ink(a)}"></i>${esc(label(a))}</label>`).join('');
  $("performanceCount").textContent='('+rows.filter(a=>selected.has(a.id)).length+')';
  const ref=data.accounts.find(a=>a.id===reference),ranks=U.ranking(rows),own=rows.filter(a=>a.kind!=='benchmark'&&a.history.length),leader=[...own].sort((a,b)=>U.metrics(b.history).total-U.metrics(a.history).total)[0];
  const same=cohort!=="all",ties=leader?own.filter(a=>Math.abs(U.metrics(a.history).total-U.metrics(leader.history).total)<1e-9).length:0,beaten=own.filter(a=>U.gap(a,ref)>1e-9).length;
  $("performanceKpis").innerHTML=[["Capital initial par compte","10 000 $ CA"],[same?'Premier au classement':'Classements par lancement',same?(ties>1?ties+' ex æquo':leader?label(leader):'En attente'):'Voir le tableau'],["SAVY devant "+reference,beaten+' / '+own.length],["Clôture validée",data.as_of?date(data.as_of):'En attente']].map(([k,v])=>`<div class="kpi"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('');
  const order=[...rows].sort((a,b)=>a.kind==='benchmark'?(b.kind==='benchmark'?data.benchmarks.indexOf(a.id)-data.benchmarks.indexOf(b.id):1):b.kind==='benchmark'?-1:a.launch_date.localeCompare(b.launch_date)||(ranks.get(a.id)||99)-(ranks.get(b.id)||99)||a.id.localeCompare(b.id,"fr",{numeric:true}));
  $("performanceBody").innerHTML=order.map(a=>{const m=U.metrics(a.history),base=ref.history.find(h=>h.date===(a.kind==='benchmark'&&cohort!=='all'?cohort:a.launch_date)),last=ref.history.find(h=>h.date===a.history.at(-1)?.date),gap=base&&last?m.total-(last.value/base.value-1):null;return `<tr class="${a.kind==='benchmark'?'benchmark':''}"><td>${ranks.get(a.id)||'—'}</td><th scope="row"><i class="dot" style="background:${ink(a)}"></i>${esc(label(a))}<small>${esc(date(a.kind==='benchmark'&&cohort!=='all'?cohort:a.launch_date))}${a.history.length?'':' · en attente de clôture'}</small></th><td>${money(m.value)}</td><td>${money(m.gain)}</td><td>${pct(m.total)}</td><td>${pct(m.day)}</td><td>${pct(m.week)}</td><td>${pct(m.month)}</td><td>${gap==null?'—':num(gap*100)+' pts'}</td></tr>`;}).join('');
  $("performanceChartNote").textContent=(cohort==='all'?'Chaque compte démarre à 10 000 $ à sa propre date. Classements par date; écarts au benchmark depuis le lancement de chaque compte.':'Même clôture de départ pour ce groupe et ses quatre benchmarks. Distributions réinvesties; valeurs après clôture uniquement.')+(dates.length===1?' Première séance : les variations seront mesurées dès la prochaine clôture.':'');
  $("performanceSlider").max=String(Math.max(0,dates.length-1));$("performanceSlider").disabled=dates.length<2;chart();persist();
 }
 function download(name,body,type){const url=URL.createObjectURL(new Blob([body],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 async function show(){
  if(!$("performance"))return;
  if(location.pathname.includes('/fnb-history/')){$("performanceStatus").innerHTML='Archive de backtest figée. <a href="'+new URL('reports/portefeuilles-fnb.html',root).href+'">Ouvrir le suivi courant ↗</a>';return;}
  if(data&&Date.now()-loaded<600000){requestAnimationFrame(chart);return;}if(loading)return;loading=true;$("performanceRetry").hidden=true;
  try{
   const response=await fetch(new URL('data/fnb-performance.json',root),{cache:'no-cache'});if(!response.ok)throw Error('Clôtures indisponibles');data=U.validate(await response.json());loaded=Date.now();restore();
   const cohorts=[...new Set(data.accounts.filter(a=>a.kind!=='benchmark').map(a=>a.launch_date))].sort();if(cohort!=='all'&&!cohorts.includes(cohort))cohort=cohorts[0];
   $("performanceCohort").innerHTML=cohorts.map(d=>`<option value="${d}">${esc(date(d))}</option>`).join('')+'<option value="all">Tous les lancements</option>';$("performanceCohort").value=cohort;
   $("performancePositions").innerHTML=data.accounts.map(a=>`<option value="${esc(a.id)}">${esc(label(a))} · ${esc(date(a.launch_date))}</option>`).join('');positions();
   $("performanceLedger").href='https://github.com/osavaria11-bot/Bourse/tree/main/data/fnb-performance/days';$("performanceContent").hidden=false;
   $("performanceStatus").textContent=data.as_of?'Suivi depuis le 19 octobre 2026 · clôture du '+date(data.as_of)+' · actualisation automatique après les marchés.':'Comptes enregistrés pour le 19 octobre 2026 · en attente de toutes les clôtures de lancement.';
   try{const s=await fetch(new URL('data/fnb-performance-status.json',root),{cache:'no-cache'});if(s.ok&&(await s.json()).status==='retrying')$("performanceStatus").textContent+=' Source en attente; dernière clôture validée conservée.';}catch{}
   render();$("performance").dataset.ready='true';
  }catch(e){$("performanceStatus").textContent='Le suivi n’a pas pu être chargé. Les investissements et leur historique restent conservés.';$("performanceRetry").hidden=false;}finally{loading=false;}
 }
 document.addEventListener('change',e=>{const el=e.target;if(!data)return;if(el.id==='performanceBenchmark'){reference=el.value;selected.add(reference);render();}if(el.id==='performanceCohort'){cohort=el.value;render();}if(el.dataset.performanceChoice){el.checked?selected.add(el.dataset.performanceChoice):selected.delete(el.dataset.performanceChoice);render();}if(el.id==='performancePositions')positions();});
 document.addEventListener('input',e=>{if(e.target.id==='performanceSlider')readout(e.target.value);});
 document.addEventListener('click',e=>{const id=e.target.closest('button')?.id;if(id==='performanceRetry'){loaded=0;show();}if(!data)return;if(id==='performanceRobust'){const robust=data.accounts.filter(a=>a.id.startsWith('robust-'));cohort=robust.at(-1)?.launch_date||'all';selected=new Set([...robust.map(a=>a.id),...data.benchmarks]);$("performanceCohort").value=cohort;render();}if(id==='performanceAll'){rows.forEach(a=>selected.add(a.id));render();}if(id==='performanceNone'){rows.forEach(a=>selected.delete(a.id));render();}if(id==='performanceJson')download('SAVY_Suivi_permanent.json',JSON.stringify(data,null,2),'application/json');if(id==='performanceCsv'){const allDates=[...new Set(data.accounts.flatMap(a=>a.history.map(p=>p.date)))].sort(),cell=v=>'"'+String(v??'').replaceAll('"','""')+'"';const lines=[['Date',...data.accounts.map(a=>label(a)+' · '+a.launch_date)],...allDates.map(d=>[d,...data.accounts.map(a=>a.history.find(p=>p.date===d)?.value??'')])];download('SAVY_Suivi_quotidien.csv','\uFEFF'+lines.map(r=>r.map(cell).join(',')).join('\n'),'text/csv;charset=utf-8');}});
 let resize;addEventListener('resize',()=>{cancelAnimationFrame(resize);if(data&&!$("performance").hidden)resize=requestAnimationFrame(chart);});
 return{show};
})();
