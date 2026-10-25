(()=>{
 'use strict';
 const U=window.MarketBreadthUtils,host=document.getElementById('marketBreadth');if(!host||!U)return;
 const ink={20:'var(--chart)',50:'var(--benchmark)',100:'#83719A',200:'#427D78'},dash={20:'',50:'7 3',100:'3 3',200:''};
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const num=v=>v===null||!Number.isFinite(v)?'—':new Intl.NumberFormat('fr-CA',{maximumFractionDigits:1}).format(v);
 const percent=v=>num(v)+(v===null||!Number.isFinite(v)?'':' %');
 const date=d=>d?new Date(d+'T12:00:00Z').toLocaleDateString('fr-CA',{day:'numeric',month:'short',year:'numeric',timeZone:'America/Toronto'}):'Non disponible';
 const periods={'1M':'1 mois','3M':'3 mois','6M':'6 mois','1Y':'1 an','3Y':'3 ans','5Y':'5 ans','10Y':'10 ans',ALL:'Tout'};
 let data=null,period='10Y',sma='ALL',market='ALL',loaded=0,loading=false,lastWidth=0;
 try{const p=JSON.parse(localStorage.getItem('savy:breadth-view:v1')||'{}');if(periods[p.period])period=p.period;if(['ALL','20','50','100','200'].includes(p.sma))sma=p.sma;if(['ALL',...U.IDS].includes(p.market))market=p.market;}catch{}
 const selected=()=>sma==='ALL'?U.WINDOWS:[Number(sma)];
 function remember(){try{localStorage.setItem('savy:breadth-view:v1',JSON.stringify({period,sma,market}));}catch{}}
 host.innerHTML=`<div class="portal-section-heading"><div><h2>Participation des marchés</h2><p class="meta">Pourcentage des titres au-dessus de leur propre moyenne mobile simple.</p></div><button class="button quiet" id="breadthReload">Actualiser</button></div><div class="breadth-selectors"><label>Marché<select id="breadthMarketChoice"><option value="ALL">Les quatre marchés</option><option value="sp500">S&P 500</option><option value="tsx">TSX Composite</option><option value="europe">Europe</option><option value="emerging">Marchés émergents</option></select></label><label>Courbe SMA<select id="breadthSmaChoice"><option value="ALL">Les quatre SMA</option>${U.WINDOWS.map(w=>`<option value="${w}">${w} séances</option>`).join('')}</select></label><span class="meta">RSI 14 séances · seuils 30 / 70</span></div><div class="breadth-controls" role="group" aria-label="Historique de participation">${Object.entries(periods).map(([key,label])=>`<button data-breadth-period="${key}" aria-pressed="${key===period}">${label}</button>`).join('')}</div><p class="meta" id="breadthStatus" role="status">Chargement des historiques…</p><div class="breadth-grid" id="breadthGrid"></div><details class="portal-method breadth-method"><summary>Univers, calcul et limites de l’historique</summary><p>Chaque courbe compte les titres dont la clôture ajustée dépasse strictement leur propre SMA de 20, 50, 100 ou 200 séances locales. Chaque titre compte une voix. Le dénominateur est le nombre de titres avec une fenêtre complète, affiché pour chaque observation. La clôture locale réelle peut avoir au plus 3 jours calendaires de décalage pour tenir compte des marchés fermés. Aucun prix n’est répété pour allonger une fenêtre SMA.</p><p>Les univers proviennent des positions actions officielles des FNB IVV, XIC, IEUR et EEM : S&P 500, S&P/TSX Capped Composite, MSCI Europe IMI et MSCI Emerging Markets. Un FNB peut utiliser un échantillonnage; il s’agit d’estimations sur les titres divulgués.</p><p>L’historique sur dix ans est reconstitué sur les composantes actuelles : il comporte un biais de survivance. Avant la première cotation indiquée par Yahoo, un titre est exclu de la cohorte historique. Une date de première cotation inconnue reste dans le dénominateur de couverture. Il ne s’agit pas de la composition officielle de l’indice à chaque date passée. La cohorte et les effectifs varient dans le temps. Une valeur est masquée si moins de 90 % de cette cohorte a les données nécessaires. Les relevés quotidiens déjà acceptés sont conservés; le backfill reconstitué est identifié séparément.</p><p>Le panneau du bas affiche le RSI 14 séances de Wilder, lissé avec un facteur de 1/14. S&P 500 et TSX : cours des indices; Europe et émergents : cours ajustés des FNB IEUR et EEM, représentatifs en USD. Ce RSI porte sur le prix, distinct du pourcentage de participation. Les lignes 30 et 70 sont des repères usuels; elles ne garantissent pas un retournement. Une série parfaitement constante est affichée à 50.</p><p>Cours quotidiens ajustés des distributions et fractionnements : Yahoo Finance, en devise locale. Positions : iShares / BlackRock. Mise à jour après clôture et reprise le matin. Les données manquantes restent des trous; les historiques des membres officiels ne sont pas inventés.</p></details>`;
 host.querySelector('#breadthMarketChoice').value=market;host.querySelector('#breadthSmaChoice').value=sma;
 function reading(m,p){
  const el=host.querySelector(`[data-breadth-reading="${m.id}"]`);if(!el)return;
  if(!p){el.textContent='Aucune observation valide.';return;}
  const r=U.rsiAt(m,p.date);
  el.textContent=date(p.date)+' · '+selected().map(w=>`SMA ${w} j : ${percent(p.values[w])} (${p.above[w]}/${p.eligible[w]} titres)`).join(' · ')+` · RSI 14 : ${num(r?.value??null)}`+(r&&r.date!==p.date?' au '+date(r.date):'')+' · cohorte à cette date : '+p.universe+' titres';
 }
 function chart(m){
  const box=host.querySelector(`[data-breadth-chart="${m.id}"]`);if(!box)return;
  const rows=U.range(m.history,period);
  if(!rows.length){box.innerHTML='<p class="chart-placeholder">Historique indisponible : '+esc(m.error||'collecte en attente')+'</p>';return;}
  const W=Math.max(280,box.clientWidth||500),H=306,p={l:37,r:12,t:12},bottom=179,rsiTop=211,rsiBottom=275,n=rows.length;
  const first=Date.parse(rows[0].date),last=Date.parse(rows.at(-1).date),span=last-first;
  const xDate=d=>p.l+(span?(Date.parse(d)-first)/span:.5)*(W-p.l-p.r),x=i=>xDate(rows[i].date);
  const y=v=>bottom-v/100*(bottom-p.t),ry=v=>rsiBottom-v/100*(rsiBottom-rsiTop);
  let body='<title>'+esc(m.name+' : participation SMA et RSI 14, historique quotidien')+'</title>';
  for(const v of [0,25,50,75,100])body+=`<line x1="${p.l}" x2="${W-p.r}" y1="${y(v)}" y2="${y(v)}" class="breadth-grid-line"/><text x="${p.l-6}" y="${y(v)+4}" text-anchor="end" class="breadth-axis">${v} %</text>`;
  for(const i of [...new Set([0,Math.floor((n-1)/2),n-1])])body+=`<text x="${x(i)}" y="${H-7}" text-anchor="${i===0?'start':i===n-1?'end':'middle'}" class="breadth-axis">${esc(new Date(rows[i].date+'T12:00:00Z').toLocaleDateString('fr-CA',{month:'short',year:'2-digit',timeZone:'America/Toronto'}))}</text>`;
  for(const w of selected()){
   let path='',open=false;for(const row of rows){const v=row.values[w];if(v===null){open=false;continue;}path+=(open?'L':'M')+xDate(row.date).toFixed(2)+','+y(v).toFixed(2)+' ';open=true;}
   body+=`<path data-breadth-sma="${w}" d="${path}" fill="none" stroke="${ink[w]}" stroke-width="${w===200?2.3:1.7}" stroke-dasharray="${dash[w]}"/>`;
  }
  body+=`<text x="${p.l}" y="200" class="breadth-rsi-title">${esc('RSI 14 · '+(m.rsi_symbol||m.proxy))}</text><rect x="${p.l}" y="${ry(70)}" width="${W-p.l-p.r}" height="${ry(30)-ry(70)}" class="breadth-rsi-band"/>`;
  for(const v of [30,70])body+=`<line data-rsi-threshold="${v}" x1="${p.l}" x2="${W-p.r}" y1="${ry(v)}" y2="${ry(v)}" class="breadth-rsi-threshold"/><text x="${p.l-6}" y="${ry(v)+3}" text-anchor="end" class="breadth-axis">${v}</text>`;
  const rsi=(m.rsi_history||[]).filter(v=>v.date>=rows[0].date&&v.date<=rows.at(-1).date);
  let rsiPath='',rsiOpen=false;for(const v of rsi){if(v.value===null){rsiOpen=false;continue;}rsiPath+=(rsiOpen?'L':'M')+xDate(v.date).toFixed(2)+','+ry(v.value).toFixed(2)+' ';rsiOpen=true;}
  body+=`<path data-breadth-rsi="14" d="${rsiPath}" class="breadth-rsi-line"/>`;
  if(!rsi.length)body+=`<text x="${p.l+8}" y="247" class="breadth-axis">RSI indisponible pour cette période</text>`;
  body+=`<line class="breadth-cursor" x1="0" x2="0" y1="${p.t}" y2="${rsiBottom}" visibility="hidden"/>`;
  box.innerHTML=`<svg viewBox="0 0 ${W} ${H}" tabindex="0" role="img" aria-label="${esc(m.name+' : participation SMA, puis RSI 14 avec seuils 30 et 70. Flèches gauche et droite pour parcourir les dates.')}" >${body}</svg>`;
  const svg=box.querySelector('svg');let index=n-1;
  const show=i=>{index=Math.max(0,Math.min(n-1,i));const line=svg.querySelector('.breadth-cursor');line.setAttribute('x1',x(index));line.setAttribute('x2',x(index));line.setAttribute('visibility','visible');reading(m,rows[index]);};
  svg.addEventListener('pointermove',e=>{const r=svg.getBoundingClientRect(),point=U.nearest(rows,((e.clientX-r.left)/r.width*W-p.l)/(W-p.l-p.r));show(rows.indexOf(point));});
  svg.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();show(e.key==='Home'?0:e.key==='End'?n-1:index+(e.key==='ArrowLeft'?-1:1));}});
  svg.addEventListener('pointerleave',()=>{svg.querySelector('.breadth-cursor').setAttribute('visibility','hidden');reading(m,U.latest(m,selected()));});reading(m,U.latest(m,selected()));
 }
 function render(){
  if(!data)return;
  host.querySelector('#breadthStatus').textContent='Historique '+(data.history_years||'disponible')+' ans · reconstitution sur les composantes actuelles déjà cotées · couverture minimale 90 % de la cohorte · biais de survivance.';
  const markets=data.markets.filter(m=>market==='ALL'||m.id===market),grid=host.querySelector('#breadthGrid');grid.dataset.single=String(markets.length===1);
  grid.innerHTML=markets.map(m=>{
   const latest=U.latest(m,selected()),rsi=latest?U.rsiAt(m,latest.date):null,first=m.history.find(p=>selected().every(w=>p.values[w]!==null));
   return `<article class="breadth-card" data-breadth-market="${m.id}"><header><div><h3>${esc(m.name)}</h3><p class="meta">${esc(m.index)} · univers ${esc(m.proxy)}</p></div><span class="breadth-date">${date(latest?.date)}</span></header><div class="breadth-latest">${selected().map(w=>`<span><i style="background:${ink[w]}"></i>SMA ${w} j <b>${percent(latest?.values[w]??null)}</b></span>`).join('')}<span class="breadth-rsi-value">RSI 14 <b>${num(rsi?.value??null)}</b></span></div><div class="breadth-chart" data-breadth-chart="${m.id}"></div><p class="breadth-reading" data-breadth-reading="${m.id}" aria-live="polite"></p><p class="meta breadth-coverage">${latest?`Couverture SMA ${selected().at(-1)} : ${latest.eligible[selected().at(-1)]}/${latest.universe} titres de la cohorte · univers actuel ${latest.current_universe||m.universe_size||latest.universe} · clôtures locales antérieures : ${latest.lagged?.[selected().at(-1)]||0} (≤ 3 j) · composition du ${date(latest.composition_date)}`:'Couverture indisponible'}${m.status==='current'?'':' · '+esc(m.error||'Dernier relevé conservé')}</p><p class="meta breadth-history-start">Première observation commune valide : ${date(first?.date)} · trous = couverture insuffisante.</p><p class="meta breadth-rsi-source">${esc(m.rsi_label||'RSI en attente')} · RSI au ${date(m.rsi_history?.at(-1)?.date)}${m.rsi_status==='stale'?' · dernier relevé conservé':''}</p><a class="breadth-source" href="${esc(m.product)}" target="_blank" rel="noopener noreferrer">Positions officielles · ${esc(m.proxy)} ↗</a></article>`;
  }).join('');markets.forEach(chart);
 }
 async function load(force=false){
  if(loading||!force&&data&&Date.now()-loaded<300000)return;loading=true;
  try{const response=await fetch('data/market-breadth.json?v=20261024-technical-risk',{cache:'no-cache'});if(!response.ok)throw Error('relevé non disponible');data=U.normalize(await response.json());loaded=Date.now();render();}
  catch(error){host.querySelector('#breadthStatus').textContent='Données de participation indisponibles : '+error.message+'. '+(data?'Dernier relevé conservé.':'');}finally{loading=false;}
 }
 host.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.id==='breadthReload')load(true);if(b.dataset.breadthPeriod){period=b.dataset.breadthPeriod;host.querySelectorAll('[data-breadth-period]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));remember();render();}});
 host.addEventListener('change',e=>{if(e.target.id==='breadthSmaChoice'){sma=e.target.value;remember();render();}if(e.target.id==='breadthMarketChoice'){market=e.target.value;remember();render();}});
 document.addEventListener('savy:navigate',e=>{if(e.detail.page==='marches'&&e.detail.tab==='breadth')load();});
 document.getElementById('refreshButton')?.addEventListener('click',()=>{if(!host.closest('[hidden]'))load(true);});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!host.closest('[hidden]'))load();});
 if(typeof ResizeObserver!=='undefined'){let resizePaint;new ResizeObserver(()=>{const width=host.clientWidth;if(width>0&&Math.abs(width-lastWidth)>1){lastWidth=width;cancelAnimationFrame(resizePaint);resizePaint=requestAnimationFrame(()=>{if(data&&host.clientWidth>0)data.markets.filter(m=>market==='ALL'||m.id===market).forEach(chart);});}}).observe(host);}
 setInterval(()=>{if(!document.hidden&&!host.closest('[hidden]'))load();},300000);
 if(!host.closest('[hidden]'))load();
})();
