"use strict";
const SavyFnb = (() => {
  function relativeMetrics(portfolio, benchmark, riskFree = .0238) {
    const p = portfolio.monthly, b = benchmark.monthly, n = p.length;
    if (n < 2 || n !== b.length) throw new Error("Périodes incompatibles");
    const mean = values => values.reduce((a, v) => a + v, 0) / n;
    const mp = mean(p), mb = mean(b), active = p.map((v, i) => v - b[i]), ma = mean(active);
    const variance = b.reduce((s, v) => s + (v - mb) ** 2, 0) / (n - 1);
    const covariance = p.reduce((s, v, i) => s + (v - mp) * (b[i] - mb), 0) / (n - 1);
    const tracking = Math.sqrt(active.reduce((s, v) => s + (v - ma) ** 2, 0) / (n - 1)) * Math.sqrt(12);
    const beta = variance > 1e-15 ? covariance / variance : null;
    return {beta, tracking_error: tracking, information: tracking > 1e-12 ? ma * 12 / tracking : null,
      treynor: beta !== null && Math.abs(beta) > 1e-12 ? (mp * 12 - riskFree) / beta : null,
      vol_diff: portfolio.vol - benchmark.vol, cagr_gap: portfolio.cagr - benchmark.cagr};
  }
  function parseCapital(raw) {
    const clean = String(raw).trim().replace(/(?:CAD|\$)/gi, "").replace(/[\s\u00a0\u202f]/g, "");
    if (!/^\+?\d+(?:[.,]\d{1,2})?$/.test(clean)) return null;
    const value = Number(clean.replace(",", "."));
    return Number.isFinite(value) && value >= 1 && value <= 1e9 ? value : null;
  }
  function start(document) {
    try {document.documentElement.dataset.theme = window.parent !== window ? window.parent.document.documentElement.dataset.theme : JSON.parse(localStorage.getItem("savy:preferences:v2") || "{}").theme || "dark";} catch {document.documentElement.dataset.theme = "dark";}

    const D = JSON.parse(document.getElementById("analysis").textContent), R = D.results;
    const ids = D.order, custom = D.custom_order, benchmarks = ["VBAL", "VGRO", "VEQT", "FBAL", "FGRO", "FEQT"];
    const $ = id => document.getElementById(id), escape = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
    const number = (v, digits = 2) => v === null || !Number.isFinite(v) ? "—" : new Intl.NumberFormat("fr-CA", {minimumFractionDigits:digits, maximumFractionDigits:digits}).format(v);
    const pct = (v, digits = 1) => v === null || !Number.isFinite(v) ? "—" : number(v * 100, digits) + " %";
    const money = v => new Intl.NumberFormat("fr-CA", {style:"currency", currency:"CAD", currencyDisplay:"narrowSymbol", maximumFractionDigits:0}).format(v);
    const short = k => custom.includes(k) ? "Nº " + k : k;
    const name = k => custom.includes(k) ? short(k) + " · " + R[k].short_name : k;
    const fundNote = k => D.fund_labels?.[k] ? '<span class="fund-name">' + escape(D.fund_labels[k].name) + '</span><span class="fund-description">' + escape(D.fund_labels[k].description) + '</span>' : "";
    const dot = k => '<span class="dot" style="background:' + R[k].color + '"></span>';
    const text = (x, y, s, attrs = "") => `<text x="${x}" y="${y}" ${attrs}>${escape(s)}</text>`;
    const line = (x1, y1, x2, y2, attrs = "") => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--grid)" ${attrs}/>`;
    const svg = (body, W, H, title) => `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escape(title)}" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${H}" fill="var(--surface)"/>${body}</svg>`;
    let capital = 10000, reference = "VEQT", summary = "2", focus = "2", axis = "vol", month = D.dates.length, sortKey = null, descending = true, activeView = "allPortfolios", allSort = null, allDescending = true;
    const relative = k => relativeMetrics(R[k], R[reference], D.assumptions.risk_free);
    const metric = (k, key) => ["beta", "treynor", "information", "tracking_error", "vol_diff", "cagr_gap"].includes(key) ? relative(k)[key] : R[k][key];
    const selectedIds = chart => [...document.querySelectorAll('#' + (chart === "risk" ? "compass" : "capital") + ' [data-series]:checked')].map(n => n.dataset.series);
    const dateLabel = i => new Date(D.wealth_dates[i] + "T12:00:00Z").toLocaleDateString("fr-CA", {year:"numeric", month:"long", day:"numeric", timeZone:"America/Toronto"});
    const width = id => Math.max(260, Math.round($(id).clientWidth || 600));
    function syncSelection() {
      for (const [chart, section] of [["risk", "compass"], ["growth", "capital"]]) {
        const chosen = selectedIds(chart), root = $(section);
        root.querySelector("[data-selection-status]").textContent = chosen.length + " affichés";
        root.querySelectorAll("[data-series]").forEach(input => input.closest("label").classList.toggle("is-selected", input.checked));
        root.querySelector("[data-custom-count]").textContent = chosen.filter(k => custom.includes(k)).length;
        $(chart === "risk" ? "riskDownload" : "growthDownload").disabled = !chosen.length;
        root.querySelector(".empty-chart").hidden = chosen.length > 0;
      }
    }
    function setPreset(key, chart) {
      const sets = {all:ids, none:[], comparables:["2","10","11","VBAL","VGRO","VEQT"], balanced:["10","VBAL","FBAL"], growth:["11","VGRO","FGRO"], equity:["2","VEQT","FEQT"]};
      if (!sets[key]) return;
      $(chart === "risk" ? "compass" : "capital").querySelectorAll("[data-series]").forEach(input => {input.checked = sets[key].includes(input.dataset.series);});
      refreshCharts();
    }
    function drawSummary() {
      const q = R[summary], values = [["Rendement annualisé", pct(q.cagr)], ["Volatilité", pct(q.vol)], ["Sharpe", number(q.sharpe)], ["Bêta / " + reference, number(relative(summary).beta)]];
      $("summaryMetrics").innerHTML = values.map(([label, value]) => `<div class="kpi"><span>${escape(label)}</span><strong>${value}</strong></div>`).join("");
      document.querySelectorAll("[data-reference-label]").forEach(n => {n.textContent = reference;});
    }
    function drawRisk() {
      const W = width("riskSvg"), H = 300, p = {l:48,r:22,t:26,b:45}, w = W - p.l - p.r, h = H - p.t - p.b;
      const vals = ids.map(k => axis === "vol" ? R[k].vol : relative(k).beta).filter(Number.isFinite);
      const low = Math.min(...vals), high = Math.max(...vals), pad = (high - low) * .16 || .1;
      const xmin = Math.max(0, low - pad), xmax = high + pad, ymin = Math.min(...ids.map(k => R[k].cagr)) - .025, ymax = Math.max(...ids.map(k => R[k].cagr)) + .025;
      const x = v => p.l + (v - xmin) / (xmax - xmin) * w, y = v => H - p.b - (v - ymin) / (ymax - ymin) * h;
      let body = text(p.l, 13, "Rendement annualisé", 'fill="var(--muted)" font-size="10"');
      for (let i = 0; i <= 4; i++) {const v = ymin + i / 4 * (ymax - ymin); body += line(p.l,y(v),W-p.r,y(v)) + text(p.l-7,y(v)+4,pct(v,0),'text-anchor="end"');}
      for (let i = 0; i <= 4; i++) {const v = xmin + i / 4 * (xmax - xmin);body += text(x(v),H-p.b+20,axis === "vol" ? pct(v,1) : number(v,2),'text-anchor="middle"');}
      const rx = x(axis === "vol" ? R[reference].vol : 1), ry = y(R[reference].cagr);
      body += line(rx,p.t,rx,H-p.b,'stroke-dasharray="4 4" stroke="#9CAEBB"') + line(p.l,ry,W-p.r,ry,'stroke-dasharray="4 4" stroke="#9CAEBB"');
      body += text(W/2,H-5,axis === "vol" ? "Volatilité annualisée" : "Bêta / " + reference,'text-anchor="middle"');
      const chosen = new Set(selectedIds("risk")), boxes = [];
      for (const k of [...ids].sort((a,b) => Number(chosen.has(b))-Number(chosen.has(a)))) {
        const q = R[k], xx = x(axis === "vol" ? q.vol : relative(k).beta), yy = y(q.cagr), label = short(k), tw = label.length * 6;
        let best = [9,-10], score = Infinity;
        for (const [dx,dy] of [[9,-10],[-tw-9,-10],[9,18],[-tw-9,18],[9,-25],[-tw-9,30]]) {
          const box = {x:xx+dx,y:yy+dy-10,w:tw,h:13};let s = box.x<p.l || box.x+tw>W-p.r || box.y<15 || box.y+13>H-p.b ? 1000 : 0;
          for (const b of boxes) if (box.x<b.x+b.w+2 && box.x+tw+2>b.x && box.y<b.y+b.h+2 && box.y+13+2>b.y) s+=100;
          if (s<score) {score=s;best=[dx,dy];}
        }
        if (chosen.has(k)) boxes.push({x:xx+best[0],y:yy+best[1]-10,w:tw,h:13});
        const desc = name(k) + " · rendement " + pct(q.cagr) + " · volatilité " + pct(q.vol) + " · bêta / " + reference + " " + number(relative(k).beta);
        body += `<g class="risk-point" data-portfolio="${k}" tabindex="0" role="button" aria-label="${escape(desc)}"><title>${escape(desc)}</title><circle cx="${xx}" cy="${yy}" r="5" fill="${q.color}" stroke="var(--surface)" stroke-width="1.5"/>${text(xx+best[0],yy+best[1],label,`fill="${q.color}" font-weight="700"`)}</g>`;
      }
      $("riskSvg").innerHTML = svg(body,W,H,"Boussole risque et rendement");
    }
    function showMonth(i) {
      month = Math.max(0,Math.min(D.dates.length,Math.round(Number(i)||0)));$("monthSlider").value = String(month);$("monthLabel").textContent = dateLabel(month);
      $("growthReadout").innerHTML = [...ids].sort((a,b)=>R[b].wealth[month]-R[a].wealth[month]).map(k=>`<div class="readout-item" data-portfolio="${k}"><span title="${escape(name(k))}">${dot(k)}${escape(name(k))}</span><b>${money(R[k].wealth[month]*capital/10000)}</b></div>`).join("");
      const cross = $("growthCross"), W = width("growthSvg");
      if (cross) {const x=62+month/D.dates.length*(W-78);cross.setAttribute("x1",x);cross.setAttribute("x2",x);cross.setAttribute("opacity",selectedIds("growth").length?"1":"0");}
    }
    function drawGrowth() {
      const W=width("growthSvg"),H=300,p={l:62,r:16,t:22,b:45},w=W-p.l-p.r,h=H-p.t-p.b,scale=capital/10000;
      const ymax=Math.ceil(Math.max(...ids.flatMap(k=>R[k].wealth))/2500)*2500, ymin=7500;
      const x=i=>p.l+i/D.dates.length*w,y=v=>H-p.b-(v-ymin)/(ymax-ymin)*h;let body="";
      for(let i=0;i<=4;i++){const v=ymin+i/4*(ymax-ymin);body+=line(p.l,y(v),W-p.r,y(v))+text(p.l-7,y(v)+4,money(v*scale),'text-anchor="end"');}
      const ticks=W<440?[0,19,40]:[0,7,19,31,40];
      for(const i of ticks){const label=new Date(D.wealth_dates[i]+"T12:00:00Z").toLocaleDateString("fr-CA",{month:"short",year:"2-digit",timeZone:"UTC"});body+=text(x(i),H-p.b+23,label,`text-anchor="${i===0?'start':i===40?'end':'middle'}"`);}
      for(const k of ids){const q=R[k],path=q.wealth.map((v,i)=>(i?"L":"M")+x(i).toFixed(2)+","+y(v).toFixed(2)).join(" ");body+=`<path class="wealth-line" data-portfolio="${k}" d="${path}" fill="none" stroke="${q.color}" stroke-width="${k===reference?2.8:2}" ${benchmarks.includes(k)?'stroke-dasharray="6 3"':''}><title>${escape(name(k)+" · "+money(q.end*scale))}</title></path>`;}
      body+=`<line id="growthCross" x1="0" x2="0" y1="${p.t}" y2="${H-p.b}" stroke="#8395A4" stroke-dasharray="3 3" opacity="0"/>`;
      const host=$("growthSvg"),tip=$("growthTip");host.innerHTML=svg(body,W,H,"Évolution du capital");tip.hidden=true;
      const chart=host.querySelector("svg");
      const inspect=event=>{const rect=chart.getBoundingClientRect();if(!rect.width)return null;const px=(event.clientX-rect.left)*W/rect.width;if(px<p.l||px>W-p.r)return null;const i=Math.max(0,Math.min(D.dates.length,Math.round((px-p.l)/w*D.dates.length)));showMonth(i);return i;};
      chart.addEventListener("pointermove",event=>{const i=inspect(event);if(i===null||event.pointerType==="touch"||!selectedIds("growth").length){tip.hidden=true;return;}tip.innerHTML='<strong>'+escape(dateLabel(i))+'</strong>'+selectedIds("growth").sort((a,b)=>R[b].wealth[i]-R[a].wealth[i]).slice(0,8).map(k=>'<div>'+escape(name(k))+' <b>'+money(R[k].wealth[i]*scale)+'</b></div>').join("");tip.style.left="auto";tip.style.right="8px";tip.hidden=false;});
      chart.addEventListener("pointerdown",inspect);chart.addEventListener("pointerleave",()=>{tip.hidden=true;});showMonth(month);
    }
    function statsRows() {
      const keys=["cagr","vol","beta","sharpe","information","treynor","tracking_error","vol_diff","end","mer"], chosen=new Set([...selectedIds("risk"),...selectedIds("growth")]);
      let order=custom.filter(k=>$("tableScope").value==="all"||chosen.has(k));
      if(sortKey)order.sort((a,b)=>((metric(a,sortKey)??-Infinity)-(metric(b,sortKey)??-Infinity))*(descending?-1:1));
      order.push(...benchmarks.filter(k=>chosen.has(k)));
      $("statsBody").innerHTML=order.map(k=>`<tr class="${benchmarks.includes(k)?'benchmark':''}"><th scope="row">${custom.includes(k)?`<button class="stats-open" data-open-portfolio="${k}">`:''}${dot(k)}${escape(name(k))}${custom.includes(k)?'</button>':fundNote(k)}</th>${keys.map(key=>`<td>${key==='end'?money(R[k].end*capital/10000):['beta','sharpe','information'].includes(key)?number(metric(k,key)):pct(metric(k,key),key==='mer'?2:1)}</td>`).join("")}</tr>`).join("");
      document.querySelectorAll("[data-sort]").forEach(n=>n.closest("th").setAttribute("aria-sort",n.dataset.sort===sortKey?(descending?"descending":"ascending"):"none"));
      renderAllPortfolios();
    }
    function renderAllPortfolios() {
      const body=$("allPortfolioBody");if(!body)return;
      const ranking=new Map((D.preference_ranking?.entries||[]).map(e=>[e.id,e.rank]));
      const selected=[...document.querySelectorAll("[data-overview-benchmark]:checked")].map(n=>n.dataset.overviewBenchmark);
      const keys=["cagr","vol","beta","sharpe","information","treynor","tracking_error","vol_diff","max_drawdown","mer"];
      let order=[...custom];
      if(allSort)order.sort((a,b)=>{const va=allSort==="rank"?(ranking.get(a)??99):allSort==="stocks"?(D.lookthrough?.results[a]?.stock_count??0):metric(a,allSort),vb=allSort==="rank"?(ranking.get(b)??99):allSort==="stocks"?(D.lookthrough?.results[b]?.stock_count??0):metric(b,allSort);return((va??-Infinity)-(vb??-Infinity))*(allDescending?-1:1);});
      order.push(...selected);
      body.innerHTML=order.map(k=>{const own=custom.includes(k),holdings=D.lookthrough?.results[k];return `<tr class="${own?'':'benchmark'}"><td class="rank-cell">${ranking.has(k)?ranking.get(k):'—'}</td><th scope="row">${own?`<button class="stats-open" data-open-portfolio="${k}">`:''}${dot(k)}${escape(name(k))}${own?'</button>':fundNote(k)}</th>${keys.map(key=>`<td>${['beta','sharpe','information'].includes(key)?number(metric(k,key)):pct(metric(k,key),key==='mer'?2:1)}</td>`).join('')}<td>${holdings?'≈ '+number(holdings.stock_count,0):'—'}</td><td>${holdings?pct(holdings.top10_weight):'—'}</td></tr>`;}).join("");
      document.querySelectorAll("[data-all-sort]").forEach(n=>n.closest("th").setAttribute("aria-sort",n.dataset.allSort===allSort?(allDescending?"descending":"ascending"):"none"));
    }
    function drawGeo() {
      const W=Math.max(320,width("geoSvg")),H=168,l=12,r=12,bar=W-l-r,colors=["#285E96","#3C8F81","#81A4BA","#9A89BD","#C09B48","#A67BA2","#576979"];let body="";
      for(const [row,k] of [focus,reference].entries()){const yy=22+row*77;body+=text(l,yy,name(k),'font-weight="600"');let xx=l;R[k].geo_total.forEach((v,i)=>{const ww=v*bar;if(ww<=0)return;body+=`<rect x="${xx}" y="${yy+12}" width="${ww}" height="27" fill="${colors[i]}"><title>${escape(D.geo_names[i]+" · "+pct(v))}</title></rect>`;if(ww>42)body+=text(xx+ww/2,yy+30,pct(v,0),'text-anchor="middle" fill="#fff"');xx+=ww;});}
      $("geoSvg").innerHTML=svg(body,W,H,"Géographie : portefeuille et référence");
      $("geoValues").innerHTML=D.geo_names.map((n,i)=>`<tr><th scope="row"><span class="dot" style="background:${colors[i]}"></span>${escape(n)}</th><td>${pct(R[focus].geo_total[i])}</td><td>${pct(R[reference].geo_total[i])}</td></tr>`).join("");
    }
    function drawSector() {
      const q=R[focus],b=R[reference];
      $("sectorFocusName").textContent=name(focus);$("sectorFocusDot").style.background=q.color;
      $("sectorValues").innerHTML=D.sector_names.map((n,i)=>`<tr><th scope="row">${escape(n)}</th><td><div class="sector-meter"><span style="width:${q.sectors[i]*200}%;background:${q.color}"></span><b>${pct(q.sectors[i])}</b></div></td><td>${pct(b.sectors[i])}</td></tr>`).join("");
      document.querySelectorAll("[data-exposure-name]").forEach(n=>{n.textContent=name(focus);});drawGeo();
    }
    function switchView(id) {
      if(!["allPortfolios","overview","exposures","portfolios","methods"].includes(id))id="allPortfolios";activeView=id;
      document.querySelector(".dashboard-toolbar").hidden=!["allPortfolios","overview","exposures"].includes(id);
      $("summaryFocus").closest(".field").hidden=id!=="overview";
      document.querySelectorAll("[data-dashboard-view]").forEach(n=>{n.hidden=n.id!==id;});
      document.querySelectorAll(".nav [data-tab]").forEach(n=>{const on=n.dataset.tab===id;n.classList.toggle("active",on);if(on)n.setAttribute("aria-current","page");else n.removeAttribute("aria-current");});
      requestAnimationFrame(()=>{if(id==="overview"){drawRisk();drawGrowth();}if(id==="exposures")drawSector();});
      window.scrollTo({top:0,behavior:"instant"});
    }
    function openPortfolio(k) {if(!custom.includes(k))return;$("ficheFocus").value=k;document.querySelectorAll("[data-fiche]").forEach(n=>{n.hidden=n.dataset.fiche!==k;});switchView("portfolios");}
    function refreshCharts(){syncSelection();drawRisk();drawGrowth();statsRows();}
    function status(message){$("actionStatus").textContent=message;$("actionStatus").hidden=false;}
    function download(filename,body,type){try{const url=URL.createObjectURL(new Blob([body],{type})),a=document.createElement("a");a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}catch(error){status("Téléchargement indisponible dans cet aperçu.");}}
    const csvCell=v=>{const s=v===null?"":String(v);return /[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;};
    const csv=rows=>"\uFEFF"+rows.map(row=>row.map(csvCell).join(",")).join("\n");
    document.addEventListener("click",event=>{
      const target=event.target.closest?.("a,button,.risk-point");if(!target)return;
      if(target.dataset.tab){event.preventDefault();switchView(target.dataset.tab);}
      if(target.dataset.preset)setPreset(target.dataset.preset,target.closest("#compass")?"risk":"growth");
      if(target.hasAttribute("data-copy-risk")){const chosen=selectedIds("risk");$("capital").querySelectorAll("[data-series]").forEach(n=>{n.checked=chosen.includes(n.dataset.series);});refreshCharts();}
      if(target.dataset.sort){descending=sortKey===target.dataset.sort?!descending:true;sortKey=target.dataset.sort;statsRows();}
      if(target.dataset.allSort){allDescending=allSort===target.dataset.allSort?!allDescending:target.dataset.allSort!=="rank";allSort=target.dataset.allSort;renderAllPortfolios();}
      if(target.dataset.openPortfolio)openPortfolio(target.dataset.openPortfolio);
      if(target.matches(".risk-point")){const k=target.dataset.portfolio,q=R[k];$("riskDetail").innerHTML=`<b>${escape(name(k))}</b> · ${pct(q.cagr)} rendement · ${pct(q.vol)} vol. · Sharpe ${number(q.sharpe)} ${custom.includes(k)?`<button data-open-portfolio="${k}">Fiche ↗</button>`:''}`;}
      if(target.id==="metricsCsv"){const keys=["cagr","vol","beta","sharpe","information","treynor","tracking_error","vol_diff","max_drawdown","mer","end"];download("SAVY_Ratios.csv",csv([["Référence",reference],["Portefeuille",...keys],...ids.map(k=>[name(k),...keys.map(key=>key==="end"?R[k].end*capital/10000:metric(k,key))])]),"text/csv;charset=utf-8");}
      if(target.id==="monthlyCsv")download("SAVY_Rendements_Mensuels.csv",csv([["Mois",...ids.map(name)],...D.dates.map((date,i)=>[date,...ids.map(k=>R[k].monthly[i])])]),"text/csv;charset=utf-8");
      if(target.id==="analysisJson")download("SAVY_Analyse.json",JSON.stringify({...D,interface_state:{reference,capital,risk_selected:selectedIds("risk"),growth_selected:selectedIds("growth")}},null,2),"application/json");
      if(target.id==="riskDownload"||target.id==="growthDownload"){const chart=target.id==="riskDownload"?"risk":"growth",chosen=new Set(selectedIds(chart)),node=$(chart==="risk"?"riskSvg":"growthSvg").querySelector("svg").cloneNode(true);const original=$(chart==="risk"?"riskSvg":"growthSvg").querySelector("svg"), originals=[original,...original.querySelectorAll("*")], copies=[node,...node.querySelectorAll("*")];copies.forEach((copy,i)=>{const style=window.getComputedStyle(originals[i]);for(const key of ["fill","stroke","stroke-width","stroke-dasharray","font-family","font-size","font-weight"])copy.style.setProperty(key,style.getPropertyValue(key));});node.querySelectorAll("[data-portfolio]").forEach(n=>{if(!chosen.has(n.dataset.portfolio))n.remove();else n.setAttribute("display","inline");});download("SAVY_"+chart+".svg",node.outerHTML,"image/svg+xml;charset=utf-8");}
      if(target.id==="printReport")window.print();
    });
    document.addEventListener("keydown",event=>{if(event.target.matches?.(".risk-point")&&["Enter"," "].includes(event.key)){event.preventDefault();event.target.dispatchEvent(new MouseEvent("click",{bubbles:true}));}});
    document.addEventListener("input",event=>{if(event.target.id==="monthSlider")showMonth(event.target.value);if(event.target.id==="capitalInput"){const value=parseCapital(event.target.value);event.target.setAttribute("aria-invalid",String(value===null));$("capitalError").hidden=value!==null;if(value!==null){capital=value;drawGrowth();statsRows();}}});
    document.addEventListener("change",event=>{
      const el=event.target;
      if(el.matches("[data-series]"))refreshCharts();
      if(el.matches("[data-overview-benchmark]"))renderAllPortfolios();
      if(el.id==="summaryFocus"){summary=el.value;drawSummary();}
      if(el.id==="referenceSelect"){reference=el.value;for(const section of ["compass","capital"])$(section).querySelector('[data-series="'+reference+'"]').checked=true;drawSummary();refreshCharts();drawSector();$("riskDetail").textContent="Pointillés : "+reference;}
      if(el.id==="tableScope")statsRows();
      if(el.id==="riskAxis"){axis=el.value;drawRisk();}
      if(el.id==="sectorFocus"){focus=el.value;drawSector();}
      if(el.id==="ficheFocus"){document.querySelectorAll("[data-fiche]").forEach(n=>{n.hidden=el.value!=="all"&&n.dataset.fiche!==el.value;});}
    });
    document.addEventListener("toggle",event=>{
      const chooser=event.target;if(!chooser.matches?.("[data-chart-chooser]")||!chooser.open)return;
      document.querySelectorAll("[data-chart-chooser]").forEach(n=>{if(n!==chooser)n.open=false;});
      const panel=chooser.querySelector(".series-controls");panel.style.left="0px";
      const rect=panel.getBoundingClientRect();panel.style.left=Math.min(0,window.innerWidth-12-rect.right)+"px";
    },true);
    if(typeof ResizeObserver!=="undefined"){const widths=new Map();let timer;const observer=new ResizeObserver(entries=>{let changed=false;for(const e of entries)if(e.contentRect.width>0&&Math.abs((widths.get(e.target)||0)-e.contentRect.width)>1){widths.set(e.target,e.contentRect.width);changed=true;}if(changed){cancelAnimationFrame(timer);timer=requestAnimationFrame(()=>{if(activeView==="overview"){drawRisk();drawGrowth();}else if(activeView==="exposures")drawGeo();});}});["riskSvg","growthSvg","geoSvg"].forEach(id=>observer.observe($(id)));}
    document.documentElement.classList.remove("no-js");drawSummary();syncSelection();statsRows();drawRisk();drawGrowth();drawSector();switchView("allPortfolios");document.documentElement.dataset.ready="true";
  }
  return {relativeMetrics,parseCapital,start};
})();
if (typeof module === "object" && module.exports) module.exports = SavyFnb;
else SavyFnb.start(document);
