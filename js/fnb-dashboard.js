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
    try {
      const appearance = JSON.parse(localStorage.getItem("savy:preferences:v2") || "{}");
      const remembered = appearance.theme_edition === "petrol-20261024" && ["petrol", "light", "dark"].includes(appearance.theme) ? appearance.theme : "petrol";
      document.documentElement.dataset.theme = window.parent !== window ? window.parent.document.documentElement.dataset.theme : remembered;
    } catch {document.documentElement.dataset.theme = "petrol";}

    const D = JSON.parse(document.getElementById("analysis").textContent), R = D.results;
    const stressInput = JSON.parse(document.getElementById('fnbStressInput')?.textContent || 'null');
    let stressScenario = 'world20';
    const dailyRisk = JSON.parse(document.getElementById('fnbDailyRisk')?.textContent || 'null');
    const ids = D.order, custom = D.custom_order, proposed = D.proposal_order || [], robust = D.robust_order || [], recommended = D.recommended_order || [], frozen = [...recommended,...robust], own = [...frozen, ...proposed, ...custom], benchmarks = D.benchmark_order;
    const $ = id => document.getElementById(id), escape = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
    const number = (v, digits = 2) => v === null || !Number.isFinite(v) ? "—" : new Intl.NumberFormat("fr-CA", {minimumFractionDigits:digits, maximumFractionDigits:digits}).format(v);
    const pct = (v, digits = 1) => v === null || !Number.isFinite(v) ? "—" : number(v * 100, digits) + " %";
    const money = v => new Intl.NumberFormat("fr-CA", {style:"currency", currency:"CAD", currencyDisplay:"narrowSymbol", maximumFractionDigits:0}).format(v);
    const short = k => frozen.includes(k) ? R[k].chart_name : proposed.includes(k) ? "Proposition" : custom.includes(k) ? "Nº " + k : k;
    const name = k => k==='VFV'?'S&P 500 · VFV':frozen.includes(k) || proposed.includes(k) ? R[k].name : custom.includes(k) ? short(k) + " · " + R[k].short_name : k;
    const fundNote = k => D.fund_labels?.[k] ? '<span class="fund-name">' + escape(D.fund_labels[k].name) + '</span><span class="fund-description">' + escape(D.fund_labels[k].description) + '</span>' : "";
    const seriesInk = k => benchmarks.includes(k) ? ({VEQT:"var(--benchmark)",VFV:"var(--benchmark-soft)",FEQT:"var(--benchmark-3)",VBAL:"var(--benchmark-4)",VGRO:"var(--benchmark-5)",FBAL:"var(--benchmark-6)"}[k] || "var(--benchmark)") : proposed.includes(k) ? "var(--chart)" : R[k].color;
    const dot = k => '<span class="dot" style="background:' + seriesInk(k) + '"></span>';
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
        root.querySelector("[data-custom-count]").textContent = chosen.filter(k => own.includes(k)).length;
        $(chart === "risk" ? "riskDownload" : "growthDownload").disabled = !chosen.length;
        root.querySelector(".empty-chart").hidden = chosen.length > 0;
      }
    }
    function setPreset(key, chart) {
      const sets = {all:ids, none:[], recommended:[...recommended,"VEQT",...(R.VFV?['VFV']:[])], robust:[...robust,"VEQT","FEQT"], comparables:["2","10","11","VBAL","VGRO","VEQT"], balanced:["10","VBAL","FBAL"], growth:["11","VGRO","FGRO"], equity:[...proposed,"2","VEQT","FEQT"], monthly:[...proposed,"2","FEQT","VEQT","VGRO","VBAL"]};
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
        body += `<g class="risk-point" data-portfolio="${k}" tabindex="0" role="button" aria-label="${escape(desc)}"><title>${escape(desc)}</title><circle cx="${xx}" cy="${yy}" r="5" fill="${seriesInk(k)}" stroke="var(--surface)" stroke-width="1.5"/>${text(xx+best[0],yy+best[1],label,`fill="${seriesInk(k)}" font-weight="700"`)}</g>`;
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
      const ymax=Math.ceil(Math.max(...ids.flatMap(k=>R[k].wealth))/2500)*2500, ymin=Math.floor(Math.min(7500,...ids.flatMap(k=>R[k].wealth))/2500)*2500;
      const x=i=>p.l+i/D.dates.length*w,y=v=>H-p.b-(v-ymin)/(ymax-ymin)*h;let body="";
      for(let i=0;i<=4;i++){const v=ymin+i/4*(ymax-ymin);body+=line(p.l,y(v),W-p.r,y(v))+text(p.l-7,y(v)+4,money(v*scale),'text-anchor="end"');}
      const count=W<440?2:4,ticks=[...new Set(Array.from({length:count+1},(_,i)=>Math.round(i*D.dates.length/count)))];
      for(const i of ticks){const label=new Date(D.wealth_dates[i]+"T12:00:00Z").toLocaleDateString("fr-CA",{month:"short",year:"2-digit",timeZone:"UTC"});body+=text(x(i),H-p.b+23,label,`text-anchor="${i===0?'start':i===D.dates.length?'end':'middle'}"`);}
      for(const k of ids){const q=R[k],path=q.wealth.map((v,i)=>(i?"L":"M")+x(i).toFixed(2)+","+y(v).toFixed(2)).join(" ");body+=`<path class="wealth-line" data-portfolio="${k}" d="${path}" fill="none" stroke="${seriesInk(k)}" stroke-width="${k===reference?2.8:2}" ${benchmarks.includes(k)?'stroke-dasharray="6 3"':''}><title>${escape(name(k)+" · "+money(q.end*scale))}</title></path>`;}
      body+=`<line id="growthCross" x1="0" x2="0" y1="${p.t}" y2="${H-p.b}" stroke="#8395A4" stroke-dasharray="3 3" opacity="0"/>`;
      const host=$("growthSvg"),tip=$("growthTip");host.innerHTML=svg(body,W,H,"Évolution du capital");tip.hidden=true;
      const chart=host.querySelector("svg");
      const inspect=event=>{const rect=chart.getBoundingClientRect();if(!rect.width)return null;const px=(event.clientX-rect.left)*W/rect.width;if(px<p.l||px>W-p.r)return null;const i=Math.max(0,Math.min(D.dates.length,Math.round((px-p.l)/w*D.dates.length)));showMonth(i);return i;};
      chart.addEventListener("pointermove",event=>{const i=inspect(event);if(i===null||event.pointerType==="touch"||!selectedIds("growth").length){tip.hidden=true;return;}tip.innerHTML='<strong>'+escape(dateLabel(i))+'</strong>'+selectedIds("growth").sort((a,b)=>R[b].wealth[i]-R[a].wealth[i]).slice(0,8).map(k=>'<div>'+escape(name(k))+' <b>'+money(R[k].wealth[i]*scale)+'</b></div>').join("");tip.style.left="auto";tip.style.right="8px";tip.hidden=false;});
      chart.addEventListener("pointerdown",inspect);chart.addEventListener("pointerleave",()=>{tip.hidden=true;});showMonth(month);
    }
    function statsRows() {
      const keys=["cagr","vol","beta","sharpe","information","treynor","tracking_error","vol_diff","end","mer"], chosen=new Set([...selectedIds("risk"),...selectedIds("growth")]);
      let order=own.filter(k=>$("tableScope").value==="all"||chosen.has(k));
      if(sortKey)order.sort((a,b)=>((metric(a,sortKey)??-Infinity)-(metric(b,sortKey)??-Infinity))*(descending?-1:1));
      order.push(...benchmarks.filter(k=>chosen.has(k)));
      $("statsBody").innerHTML=order.map(k=>`<tr class="${benchmarks.includes(k)?'benchmark':proposed.includes(k)?'proposed-row':''}"><th scope="row">${own.includes(k)?`<button class="stats-open" data-open-portfolio="${k}">`:''}${dot(k)}${escape(name(k))}${own.includes(k)?'</button>':fundNote(k)}</th>${keys.map(key=>`<td>${key==='end'?money(R[k].end*capital/10000):['beta','sharpe','information'].includes(key)?number(metric(k,key)):pct(metric(k,key),key==='mer'?2:1)}</td>`).join("")}</tr>`).join("");
      document.querySelectorAll("[data-sort]").forEach(n=>n.closest("th").setAttribute("aria-sort",n.dataset.sort===sortKey?(descending?"descending":"ascending"):"none"));
      renderAllPortfolios();
    }
    function renderAllPortfolios() {
      const body=$("allPortfolioBody");if(!body)return;
      const ranking=new Map((D.preference_ranking?.entries||[]).map(e=>[e.id,e.rank]));
      const selected=[...document.querySelectorAll("[data-overview-benchmark]:checked")].map(n=>n.dataset.overviewBenchmark);
      const keys=["cagr","vol","beta","sharpe","information","treynor","tracking_error","vol_diff","max_drawdown","mer"];
      let order=[...own];
      if(allSort)order.sort((a,b)=>{const va=allSort==="rank"?(ranking.get(a)??99):allSort==="stocks"?(D.lookthrough?.results[a]?.stock_count??0):metric(a,allSort),vb=allSort==="rank"?(ranking.get(b)??99):allSort==="stocks"?(D.lookthrough?.results[b]?.stock_count??0):metric(b,allSort);return((va??-Infinity)-(vb??-Infinity))*(allDescending?-1:1);});
      order.push(...selected);
      body.innerHTML=order.map(k=>{const isOwn=own.includes(k),holdings=D.lookthrough?.results[k];return `<tr class="${proposed.includes(k)?'proposed-row':isOwn?'':'benchmark'}"><td class="rank-cell">${ranking.has(k)?ranking.get(k):'—'}</td><th scope="row">${isOwn?`<button class="stats-open" data-open-portfolio="${k}">`:''}${dot(k)}${escape(name(k))}${isOwn?'</button>':fundNote(k)}</th>${keys.map(key=>`<td>${['beta','sharpe','information'].includes(key)?number(metric(k,key)):pct(metric(k,key),key==='mer'?2:1)}</td>`).join('')}<td>${holdings?'≈ '+number(holdings.stock_count,0):'—'}</td><td>${holdings?pct(holdings.top10_weight):'—'}</td></tr>`;}).join("");
      document.querySelectorAll("[data-all-sort]").forEach(n=>n.closest("th").setAttribute("aria-sort",n.dataset.allSort===allSort?(allDescending?"descending":"ascending"):"none"));
    }
    function drawGeo() {
      const W=Math.max(260,width("geoSvg")),H=168,l=12,r=12,bar=W-l-r,palette={"États-Unis":"#285E96","Canada":"#3C8F81","Développés hors Amérique du Nord":"#81A4BA","Marchés émergents":"#9A89BD","Pays non publiés":"#888c94","Or physique":"#C09B48","Cryptomonnaies indirectes":"#A67BA2","Obligations":"#576979","Liquidités et autres":"#84917f"},colors=D.geo_names.map(n=>palette[n]||"#888c94");let body="";
      for(const [row,k] of [focus,reference].entries()){const yy=22+row*77;body+=text(l,yy,name(k),'font-weight="600"');let xx=l;(R[k].geo_total||[]).forEach((v,i)=>{const ww=v*bar;if(ww<=0)return;body+=`<rect x="${xx}" y="${yy+12}" width="${ww}" height="27" fill="${colors[i]}"><title>${escape(D.geo_names[i]+" · "+pct(v))}</title></rect>`;if(ww>42)body+=text(xx+ww/2,yy+30,pct(v,0),'text-anchor="middle" fill="#fff"');xx+=ww;});}
      $("geoSvg").innerHTML=svg(body,W,H,"Géographie : portefeuille et référence");
      $("geoValues").innerHTML=D.geo_names.map((n,i)=>`<tr><th scope="row"><span class="dot" style="background:${colors[i]}"></span>${escape(n)}</th><td>${pct(R[focus].geo_total?.[i])}</td><td>${pct(R[reference].geo_total?.[i])}</td></tr>`).join("");
    }
    const pp = value => value === null || !Number.isFinite(value) ? '—' : (value>0?'+':'')+number(value*100,1)+' pp';
    const stressFactorName = key => ({market:'Marché',value:'Valeur',momentum:'Momentum',quality:'Qualité',lowvol:'Faible volatilité',technology:'Technologie',crypto:'Crypto',bond:'Taux',credit:'Crédit',fx:'Change'}[key]||key);
    const coverageText = coverage => Object.entries(coverage).filter(([,w])=>w>1e-10).map(([k,w])=>(window.SavyFnbStress?.LABELS[k]||k)+' '+pct(w,0)).join(' · ');
    function drawRiskSnapshot() {
      if (!$('riskSnapshotStatus')) return;
      const c=window.SavyFnbRisk?.compare(D,focus,reference,dailyRisk);
      $('riskSnapshotContent').hidden=!c?.available;
      if(!c?.available){$('riskSnapshotStatus').textContent=c?.reason||'Mesures indisponibles.';return;}
      const stale=c.daily.status==='stale'||Date.now()-Date.parse(c.end+'T21:00:00Z')>5*86400000;
      $('riskSnapshotStatus').textContent=name(focus)+' / '+name(reference)+' · '+c.start+' → '+c.end+(stale?' · données périmées':'');
      $('riskVarDaily').textContent=c.daily.available?pct(c.daily.var,2):'—';
      $('riskDailyNote').textContent=c.daily.available?c.daily.observations+' séances':'Indisponible';
      $('riskDailyNote').title=c.daily.reason||c.daily.error||'';
      $('riskVar').textContent=pct(c.var,2);$('riskCvar').textContent=pct(c.cvar,2);
      $('riskRelative').textContent=c.relativeVar===null?'—':number(c.relativeVar)+'×';
      $('riskRelativeNote').textContent=reference+' : '+pct(c.benchmarkVar,2);
      $('riskSkewness').textContent=number(c.daily.skewness,2);$('riskExcessKurtosis').textContent=number(c.daily.excessKurtosis,2);
      const dd=c.drawdown;
      $('riskDrawdown').textContent=pct(dd.portfolio?.value,1)+' / '+pct(dd.benchmark?.value,1);
      $('riskDrawdownNote').textContent='Simulation · port. / '+reference+' · '+dd.frequency;
      $('riskDrawdownNote').title=dd.start+' → '+dd.end+' · '+dd.method;
      const capture=c.capture;
      $('riskCapture').textContent=pct(capture?.ratio,1);
      $('riskCaptureNote').textContent=(capture?.portfolio>=0&&capture?.observations>=3?'Gain pendant les baisses · ':'')+(capture?.observations||0)+' mois baissiers'+(capture?.fragile?' · fragile':'');
      $('riskCaptureNote').title=capture?.interpretation||'';
      const capMax=Math.max(.01,Math.abs(capture?.portfolio||0),Math.abs(capture?.benchmark||0));
      $('riskCaptureBars').innerHTML=[['Port.',capture?.portfolio,'portfolio'],[reference,capture?.benchmark,'benchmark']].map(([label,value,kind])=>'<div title="'+escape(label+' : '+pct(value,1))+'"><span>'+escape(label)+'</span><i class="'+kind+'" style="width:'+Math.max(0,Math.abs(value||0)/capMax*65).toFixed(1)+'%"></i><b>'+pct(value,1)+'</b></div>').join('');
      const max=Math.max(.01,...c.top.map(t=>Math.abs(t.share)));
      $('riskContributions').innerHTML=c.top.map(t=>'<div class="risk-contribution" data-risk-contribution="'+escape(t.id)+'" title="'+escape(D.fund_labels[t.id]?.description||t.id)+'"><b>'+escape(t.id)+'</b><div class="risk-contribution-track"><i class="'+(t.share<0?'negative':'')+'" style="width:'+(Math.abs(t.share)/max*100).toFixed(2)+'%"></i></div><strong>'+pct(t.share,1)+'</strong></div>').join('')||'Contributions non estimables.';
      $('riskContributionNote').textContent=c.other===null?'':'Autres : '+pct(c.other,1)+' · variance '+c.contributionFrequency;
      $('riskSampleNote').textContent=c.var===null?c.reason:number(c.effectiveObservations,1)+' blocs effectifs · queue ≈ '+number(c.tailObservations,1)+(c.fragile?' · estimation fragile':'');
      const scenarios=window.SavyFnbStress?.compare(D,focus,reference,stressInput)||[];
      $('riskScenario').innerHTML=scenarios.map(v=>'<option value="'+v.id+'"'+(v.id===stressScenario?' selected':'')+'>'+escape(v.name)+'</option>').join('');
      const selected=scenarios.find(v=>v.id===stressScenario)||scenarios[0];
      const renderStress=()=>{
        const v=scenarios.find(x=>x.id===stressScenario)||selected;if(!v)return;
        const max=Math.max(.01,Math.abs(v.portfolio.return||0),Math.abs(v.benchmark.return||0));
        $('riskStressComparison').innerHTML='<div class="stress-result"><strong id="riskStress">'+pct(v.portfolio.return,1)+'</strong><span>/ '+escape(reference)+' '+pct(v.benchmark.return,1)+'</span><b class="'+(v.gap>0?'protection':'')+'">'+pp(v.gap)+'</b></div><div class="stress-bars" aria-label="Pertes comparées">'+[['portfolio',v.portfolio],['benchmark',v.benchmark]].map(([kind,row])=>'<i class="'+kind+'" style="width:'+(Math.abs(row.return||0)/max*100).toFixed(1)+'%"></i>').join('')+'</div><small>'+escape(coverageText(v.portfolio.coverage))+(!v.available?' · comparaison indisponible':'')+(v.status==='stale'?' · sources périmées':'')+'</small>';
        $('riskStressComparison').title=(v.historical?v.start+' → '+v.end+' · simulation de l’allocation actuelle':v.horizon)+' · '+v.interpretation+' · '+(v.portfolio.positions.some(p=>p.method==='Projection linéaire fondée sur le bêta')?'Projection linéaire fondée sur le bêta. ':'')+(v.portfolio.available?'':'Estimation complète non défendable.');
        drawBetaReading(c,v);
      };
      $('riskScenario').onchange=event=>{stressScenario=event.target.value;renderStress();};renderStress();
      $('riskScenarios').innerHTML=scenarios.map(v=>'<details class="stress-scenario-detail"><summary>'+escape(v.name)+' · '+pct(v.portfolio.return,1)+' / '+escape(reference)+' '+pct(v.benchmark.return,1)+' · '+pp(v.gap)+'</summary><p>'+escape(v.historical?v.start+' → '+v.end+'; simulation du portefeuille actuel':v.horizon)+'</p><p>Portefeuille : '+escape(coverageText(v.portfolio.coverage))+'<br>Benchmark : '+escape(coverageText(v.benchmark.coverage))+'</p><p>'+escape(v.interpretation)+'. Intervalle d’incertitude de stress non estimable avec les données présentes.</p><div class="table-wrap"><table><thead><tr><th>FNB / poids</th><th>Rendement</th><th>Méthode et source</th></tr></thead><tbody>'+v.portfolio.positions.map(x=>'<tr><th>'+escape(x.ticker)+' · '+pct(x.weight,1)+'</th><td>'+pct(x.return,1)+'</td><td>'+escape(window.SavyFnbStress.LABELS[x.classification]+' · '+x.method)+(x.source?.startsWith('https://')?' <a href="'+escape(x.source)+'" target="_blank" rel="noopener noreferrer">Source</a>':'')+(x.limitations?'<small>'+escape(x.limitations)+'</small>':'')+'</td></tr>').join('')+'</tbody></table></div><p>Principales différences : '+(v.drivers.map(x=>escape(x.ticker)+' '+pp(x.contribution)).join(' · ')||'Non attribuables sur cet échantillon.')+'</p><p>Facteurs : '+(v.components?Object.entries(v.components).map(([k,x])=>escape(stressFactorName(k))+' '+pp(x)).join(' · '):'Décomposition factorielle complète non identifiable pour cette combinaison de méthodes.')+'</p></details>').join('');
      const bt=c.backtesting;
      $('riskValidation').innerHTML='<p>'+c.observations+' blocs disjoints de 21 séances · '+number(c.effectiveObservations,1)+' effectifs approximatifs (autocorrélation des rendements) · environ '+number(c.tailObservations,1)+' observations dans la queue de 5 %. '+(c.fragile?'Queue trop courte pour une estimation stable des pertes extrêmes.':'')+'</p>'+(c.interval?'<p>Intervalles bootstrap 95 % : VaR ['+pct(c.interval.var[0],2)+' ; '+pct(c.interval.var[1],2)+'] · CVaR ['+pct(c.interval.cvar[0],2)+' ; '+pct(c.interval.cvar[1],2)+']. '+escape(c.interval.method)+' '+c.interval.replications+' réplications; elles n’augmentent pas l’historique effectif.</p>':'<p>'+escape(c.reason||'Intervalle non estimable.')+'</p>')+(c.stability?'<p>VaR selon les 21 décalages de début des blocs : '+pct(c.stability.minimum,2)+' à '+pct(c.stability.maximum,2)+'. '+escape(c.stability.note)+'</p>':'')+(bt?'<p>Rejeu quotidien : '+bt.daily.exceptions+' dépassements / '+bt.daily.observations+' prévisions ('+pct(bt.daily.rate,1)+', attendu 5 %). Rejeu 21 séances : '+bt.monthly.exceptions+' / '+bt.monthly.observations+(bt.monthly.fragile?' · échantillon de validation insuffisant.':'.')+' '+escape(bt.daily.note)+'</p>':'<p>Rejeu chronologique indisponible sans série quotidienne complète.</p>')+(c.coherence?'<p>CVaR ≥ VaR : '+(c.coherence.cvarAboveVar?'oui':'non')+'. VaR 21 séances ≥ VaR 1 jour : '+(c.coherence.monthlyAboveDaily?'oui':'non')+'. '+escape(c.coherence.note)+'</p>':'');
      const absolute=new Map((c.contributions||[]).map(x=>[x.id,x.share])),active=new Map((c.activeContributions||[]).map(x=>[x.id,x.share])),all=[...new Set([...absolute.keys(),...active.keys()])];
      $('riskActiveContributions').innerHTML='<p>Contributions d’Euler signées à la variance '+c.contributionFrequency+' des mélanges aux poids cibles constants. La variance active porte sur portefeuille − benchmark avec les mêmes rendements et poids; elle peut différer du backtest mensuel rééquilibré en janvier utilisé par les ratios et facteurs.</p><div class="table-wrap"><table><thead><tr><th>FNB</th><th>Risque absolu</th><th>Risque actif</th></tr></thead><tbody>'+all.map(t=>'<tr><th>'+escape(t)+'</th><td>'+pct(absolute.get(t)??null,1)+'</td><td>'+pct(active.get(t)??null,1)+'</td></tr>').join('')+'</tbody></table></div>';
      $('riskSourceStatus').textContent='Quotidien : '+(dailyRisk?.as_of||'indisponible')+' · '+(dailyRisk?.status||'absent')+'. '+(dailyRisk?.source||'')+' Stress : '+(stressInput?.as_of||'indisponible')+' · '+(stressInput?.status||'absent')+'. '+Object.entries(stressInput?.errors||{}).map(([t,e])=>t+' : '+e).join(' · ');
      $('riskPerformanceLink').onclick=()=>{document.querySelector('.risk-snapshot>.factor-method').open=false;switchView('overview');};
    }
    function drawBetaReading(c,scenario){
      const f=window.SavyFnbFactors?.compare(D,focus,reference),decomp=scenario.decomposition;
      $('riskAttribution').innerHTML='<p>Bêta / '+escape(reference)+' : '+number(c.beta)+' · Downside Beta : '+number(c.downside.beta)+' ('+c.downside.observations+' mois baissiers) · Downside Capture : '+pct(c.capture?.ratio,1)+' · risque actif annualisé : '+pct(f?.trackingError,2)+'. '+escape(c.downside.reason||'')+'</p><p>Stress '+escape(scenario.name)+' : écart '+pp(scenario.gap)+'. '+(decomp?'Effet marché : '+pp(decomp.market)+'; autres facteurs : '+pp(decomp.other)+'; écart de réconciliation : '+pp(decomp.residual)+'. '+escape(decomp.note):'Les rendements observés et les méthodes mixtes ne permettent pas d’isoler précisément marché, secteurs, facteurs et devises. L’écart restant n’est pas attribué automatiquement à la diversification.')+'</p><p>Un bêta plus faible peut suffire à réduire la perte. Un meilleur downside capture ou un écart favorable en stress n’établit pas à lui seul une diversification durable. Les scénarios projetés sur le seul bêta mesurent uniquement cet effet de marché.</p>';
    }
    function drawFactors() {
      if (!$("factorStatus")) return;
      const comparison = window.SavyFnbFactors?.compare(D, focus, reference);
      $("factorContent").hidden = !comparison?.available;
      if (!comparison?.available) {
        $("factorStatus").textContent = comparison?.reason || "Analyse factorielle indisponible pour cette publication.";
        return;
      }
      const c = comparison, signed = v => Math.abs(v) < .0005 ? number(0) : (v > 0 ? "+" : "") + number(v);
      $("factorStatus").textContent = name(focus) + " face à " + name(reference) + " · " + c.start + " → " + c.end + " · " + c.months + " mois communs en CAD.";
      $("factorMetrics").innerHTML = [["Tracking Error", pct(c.trackingError, 2),"Volatilité annualisée des rendements actifs mensuels."], ["R² actif", pct(c.activeR2, 0),"Part de variance active expliquée dans cet échantillon; ce n’est pas une mesure de pouvoir prédictif."], ["Bêta / "+reference, number(c.beta),"Bêta simple relatif au benchmark sélectionné."], ["Downside Beta", number(c.downside.beta),c.downside.observations+" mois baissiers. "+(c.downside.reason||"Covariance conditionnelle divisée par la variance conditionnelle du benchmark.")]].map(([label, value,tip]) => '<div title="'+escape(tip)+'"><span>' + escape(label) + '</span><strong>' + value + '</strong>'+(label==='Downside Beta'?'<small class="factor-metric-note">'+c.downside.observations+' mois'+(c.downside.fragile?' · fragile':'')+'</small>':'')+'</div>').join("");
      const scale = Math.max(.1, ...c.factors.map(f => Math.abs(f.delta)));
      $("factorValues").innerHTML = c.factors.map(f => {
        const span = Math.abs(f.delta) / scale * 50, left = f.delta < 0 ? 50 - span : 50;
        return '<tr data-factor="' + f.id + '" data-significant="'+f.significant+'" class="'+(f.significant?'factor-significant':'factor-not-significant')+'" title="'+(f.significant?'Écart significatif à 95 % dans ce modèle':'Bande 95 % contenant zéro : écart non significatif')+'"><th scope="row">' + escape(f.name) + '<small>' + escape(f.short ? f.long + ' − ' + f.short : 'VEQT − taux sans risque') + '</small></th><td>' + signed(f.portfolio) + '</td><td>' + signed(f.benchmark) + '</td><td><div class="factor-delta"><b>' + signed(f.delta) + '</b><span class="factor-track" aria-hidden="true"><i style="left:' + left.toFixed(2) + '%;width:' + span.toFixed(2) + '%"></i></span></div></td><td class="factor-band">[' + signed(f.low) + ' ; ' + signed(f.high) + ']</td><td>' + (f.contribution === null ? '—' : pct(f.contribution, 1)) + '</td></tr>';
      }).join("") + '<tr class="factor-residual"><th scope="row">Risques non expliqués<small>Résiduel du modèle</small></th><td>—</td><td>—</td><td>—</td><td>—</td><td>' + pct(c.residualContribution, 1) + '</td></tr><tr class="factor-unavailable"><th scope="row">Taille / petites capitalisations<small>Séries comparables insuffisantes</small></th><td colspan="5">Non estimé</td></tr>';
      $("factorReading").textContent = (c.activeR2 === null ? "Le risque actif est nul : les contributions à sa variance ne sont pas définies. " : "Les contributions et le résiduel totalisent 100 % avant arrondis. Une part négative représente une compensation du risque. ") + (c.unstable ? "Stratégies fortement corrélées : interpréter les sensibilités avec prudence. " : "") + "Les sensibilités décrivent l’historique disponible; elles ne sont ni une note de qualité ni une prévision de rendement.";
      const windows=window.SavyFnbFactors.stability(D,focus,reference);
      $('factorStability').innerHTML='<div class="table-wrap"><table><thead><tr><th>Fenêtre</th><th>Marché</th><th>Valeur</th><th>Mom.</th><th>Qual.</th><th>Faible vol.</th></tr></thead><tbody>'+windows.map(w=>'<tr><th>'+(w.windowMonths?w.windowMonths+' mois':'Complet')+'</th>'+(w.available?w.factors.map(f=>'<td title="'+escape(f.significant?'Écart significatif':'Écart non significatif')+'">'+number(f.portfolio)+'</td>').join(''):'<td colspan="5">'+escape(w.reason)+'</td>')+'</tr>').join('')+'</tbody></table></div><p>'+c.factors.map((f,i)=>{const recent=windows[1];return escape(f.name)+' : '+(recent.available?(Math.sign(recent.factors[i].delta)===Math.sign(f.delta)?'écart de même signe sur 24 mois et historique complet':'signe de l’écart différent sur 24 mois et historique complet'):'comparaison non estimable');}).join(' · ')+'. Comparaison descriptive, fenêtres imbriquées.</p>';
      $('factorDiagnostics').textContent='VIF maximal : '+number(c.maxVif,1)+' · '+c.months+' mois · erreurs-types HAC Newey–West, trois retards et correction des paramètres. R² portefeuille : '+pct(c.portfolioR2,0)+'; benchmark : '+pct(c.benchmarkR2,0)+'. Les expositions non significatives restent affichées en teinte atténuée.';
    }
    function drawSector() {
      const q=R[focus],b=R[reference];
      $("sectorFocusName").textContent=name(focus);$("sectorFocusDot").style.background=seriesInk(focus);
      $("sectorValues").innerHTML=D.sector_names.map((n,i)=>`<tr><th scope="row">${escape(n)}</th><td><div class="sector-meter"><span style="width:${(q.sectors?.[i]||0)*200}%;background:${seriesInk(focus)}"></span><b>${pct(q.sectors?.[i])}</b></div></td><td>${pct(b.sectors?.[i])}</td></tr>`).join("");
      document.querySelectorAll("[data-exposure-name]").forEach(n=>{n.textContent=name(focus);});drawGeo();drawFactors();drawRiskSnapshot();
    }
    const reportPeriod=document.querySelector('.report-header p').textContent;
    function switchView(id) {
      if(!["allPortfolios","overview","exposures","portfolios","methods","performance","frontier","decision"].includes(id))id="allPortfolios";activeView=id;
      document.querySelector(".dashboard-toolbar").hidden=!["allPortfolios","overview","exposures","decision"].includes(id);
      document.querySelector('.report-header p').textContent=id==='performance'?'Comparaison commune · depuis le 19 octobre 2026 · CAD':id==='decision'?'Comparaisons historiques et projections · CAD':reportPeriod;
      document.querySelector('.report-tools').hidden=['performance','frontier','decision'].includes(id);
      const footer=document.querySelector('.footer');if(footer)footer.textContent=id==='performance'?'Départ commun au 19 octobre 2026 · Ajouts ultérieurs simulés · Distributions réinvesties':id==='decision'?'Historique et scénarios prospectifs · CAD · Distributions réinvesties · Frais des FNB inclus':'Simulation historique · Distributions réinvesties · Sans versements ni retraits';
      $("summaryFocus").closest(".field").hidden=id!=="overview";
      document.querySelectorAll("[data-dashboard-view]").forEach(n=>{n.hidden=n.id!==id;});
      document.querySelectorAll(".nav [data-tab]").forEach(n=>{const on=n.dataset.tab===id;n.classList.toggle("active",on);if(on)n.setAttribute("aria-current","page");else n.removeAttribute("aria-current");});
      requestAnimationFrame(()=>{if(id==="overview"){drawRisk();drawGrowth();}if(id==="exposures")drawSector();});
      if(id==="performance")window.SavyFnbPerformance?.show();
      if(id==="frontier")window.SavyFnbFrontier?.show(D);
      window.scrollTo({top:0,behavior:"instant"});
    }
    function choosePortfolio(k, charts = false) {
      if(!own.includes(k))return;
      const previousReference=reference;
      const familyBenchmark=id=>R[id]?.benchmark||({"10":"VBAL","11":"VGRO"}[id])||(recommended.includes(id)?"VFV":null);
      if(familyBenchmark(k)){reference=familyBenchmark(k);$("referenceSelect").value=reference;}
      else if(familyBenchmark(summary)){reference="VEQT";$("referenceSelect").value=reference;}
      const previous=summary;summary=k;focus=k;
      $("summaryFocus").value=k;$("sectorFocus").value=k;$("ficheFocus").value=k;
      document.querySelectorAll("[data-fiche]").forEach(n=>{n.hidden=n.dataset.fiche!==k;});
      if(charts){
        // Replace the followed portfolio, retaining other comparisons and
        // each chart's independent choices.
        for(const section of ["compass","capital"])$(section).querySelectorAll("[data-series]").forEach(n=>{
          if(n.dataset.series===previous&&previous!==k)n.checked=false;
          if(n.dataset.series===k||n.dataset.series===reference)n.checked=true;
        });
        month=D.dates.length;refreshCharts();
        $("riskDetail").textContent=name(k)+" · Pointillés : "+reference;
      }
      else if(reference!==previousReference)refreshCharts();
      drawSummary();drawSector();
    }
    function openPortfolio(k) {if(!own.includes(k))return;choosePortfolio(k,true);switchView("portfolios");}
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
      if(target.dataset.openExposure){choosePortfolio(target.dataset.openExposure,true);switchView("exposures");}
      if(target.id==="monthlyCharts"){setPreset("monthly","risk");setPreset("monthly","growth");switchView("overview");}
      if(target.id==="robustCharts"){setPreset("robust","risk");setPreset("robust","growth");switchView("overview");}
      if(target.id==="recommendedCharts"){reference="VFV";$("referenceSelect").value=reference;drawSummary();setPreset("recommended","risk");setPreset("recommended","growth");switchView("overview");}
      if(target.matches(".risk-point")){const k=target.dataset.portfolio,q=R[k];$("riskDetail").innerHTML=`<b>${escape(name(k))}</b> · ${pct(q.cagr)} rendement · ${pct(q.vol)} vol. · Sharpe ${number(q.sharpe)} ${own.includes(k)?`<button data-open-portfolio="${k}">Fiche ↗</button>`:''}`;}
      if(target.id==="metricsCsv"){const keys=["cagr","vol","beta","sharpe","information","treynor","tracking_error","vol_diff","max_drawdown","mer","end"];download("SAVY_Ratios.csv",csv([["Référence",reference],["Portefeuille",...keys],...ids.map(k=>[name(k),...keys.map(key=>key==="end"?R[k].end*capital/10000:metric(k,key))])]),"text/csv;charset=utf-8");}
      if(["monthlyCsv","monthlyCsvSource"].includes(target.id))download("SAVY_Rendements_Mensuels.csv",csv([["Mois",...ids.map(name)],...D.dates.map((date,i)=>[date,...ids.map(k=>R[k].monthly[i])])]),"text/csv;charset=utf-8");
      if(["analysisJson","analysisJsonSource"].includes(target.id))download("SAVY_Analyse.json",JSON.stringify({...D,interface_state:{reference,capital,risk_selected:selectedIds("risk"),growth_selected:selectedIds("growth")}},null,2),"application/json");
      if(target.id==="riskDownload"||target.id==="growthDownload"){const chart=target.id==="riskDownload"?"risk":"growth",chosen=new Set(selectedIds(chart)),node=$(chart==="risk"?"riskSvg":"growthSvg").querySelector("svg").cloneNode(true);const original=$(chart==="risk"?"riskSvg":"growthSvg").querySelector("svg"), originals=[original,...original.querySelectorAll("*")], copies=[node,...node.querySelectorAll("*")];copies.forEach((copy,i)=>{const style=window.getComputedStyle(originals[i]);for(const key of ["fill","stroke","stroke-width","stroke-dasharray","font-family","font-size","font-weight"])copy.style.setProperty(key,style.getPropertyValue(key));});node.querySelectorAll("[data-portfolio]").forEach(n=>{if(!chosen.has(n.dataset.portfolio))n.remove();else n.setAttribute("display","inline");});download("SAVY_"+chart+".svg",node.outerHTML,"image/svg+xml;charset=utf-8");}
      if(target.id==="printReport")window.print();
    });
    document.addEventListener("keydown",event=>{if(event.target.matches?.(".risk-point")&&["Enter"," "].includes(event.key)){event.preventDefault();event.target.dispatchEvent(new MouseEvent("click",{bubbles:true}));}});
    document.addEventListener("input",event=>{if(event.target.id==="monthSlider")showMonth(event.target.value);if(event.target.id==="capitalInput"){const value=parseCapital(event.target.value);event.target.setAttribute("aria-invalid",String(value===null));$("capitalError").hidden=value!==null;if(value!==null){capital=value;drawGrowth();statsRows();}}});
    document.addEventListener("change",event=>{
      const el=event.target;
      if(el.matches("[data-series]"))refreshCharts();
      if(el.matches("[data-overview-benchmark]"))renderAllPortfolios();
      if(el.id==="summaryFocus")choosePortfolio(el.value,true);
      if(el.id==="referenceSelect"){reference=el.value;for(const section of ["compass","capital"])$(section).querySelector('[data-series="'+reference+'"]').checked=true;drawSummary();refreshCharts();drawSector();$("riskDetail").textContent="Pointillés : "+reference;}
      if(el.id==="tableScope")statsRows();
      if(el.id==="riskAxis"){axis=el.value;drawRisk();}
      if(el.id==="sectorFocus"){if(own.includes(el.value))choosePortfolio(el.value,true);else{focus=el.value;drawSector();}}
      if(el.id==="ficheFocus"){if(el.value==="all")document.querySelectorAll("[data-fiche]").forEach(n=>{n.hidden=false;});else choosePortfolio(el.value,true);}
    });
    document.addEventListener("toggle",event=>{
      const chooser=event.target;if(!chooser.matches?.("[data-chart-chooser]")||!chooser.open)return;
      document.querySelectorAll("[data-chart-chooser]").forEach(n=>{if(n!==chooser)n.open=false;});
      const panel=chooser.querySelector(".series-controls");panel.style.left="0px";
      const rect=panel.getBoundingClientRect();panel.style.left=Math.min(0,window.innerWidth-12-rect.right)+"px";
    },true);
    if(typeof ResizeObserver!=="undefined"){const widths=new Map();let timer;const observer=new ResizeObserver(entries=>{let changed=false;for(const e of entries)if(e.contentRect.width>0&&Math.abs((widths.get(e.target)||0)-e.contentRect.width)>1){widths.set(e.target,e.contentRect.width);changed=true;}if(changed){cancelAnimationFrame(timer);timer=requestAnimationFrame(()=>{if(activeView==="overview"){drawRisk();drawGrowth();}else if(activeView==="exposures")drawGeo();});}});["riskSvg","growthSvg","geoSvg"].forEach(id=>observer.observe($(id)));}
    async function monthlyHistory(){
      if(!D.optimization||!$("monthlyHistory"))return;
      const source=document.querySelector('script[src*="fnb-dashboard.js"]'),root=new URL("../",source.src);
      try{
        const response=await fetch(new URL("data/fnb-history/index.json",root),{cache:"no-cache"});if(!response.ok)throw Error("Archive unavailable");
        const history=await response.json();
        const rows=history.entries.map(e=>'<tr><th scope="row"><a href="'+escape(new URL(e.report,root).href)+'" target="_blank" rel="noopener">'+escape(e.month)+'</a></th><td>'+escape(e.as_of)+'</td><td>'+number(e.sharpe_at_publication)+'</td><td>'+pct(e.forward.total_return)+'</td></tr>').join('');
        $("monthlyHistory").innerHTML='<div class="table-wrap"><table><thead><tr><th>Mois</th><th>Données au</th><th>Sharpe publié</th><th>Après publication</th></tr></thead><tbody>'+rows+'</tbody></table></div><p class="method-summary"><a href="'+escape(new URL(history.baseline.report,root).href)+'" target="_blank" rel="noopener">Analyse initiale conservée · 19 octobre 2026 ↗</a></p>';
      }catch{$("monthlyHistory").textContent="Les données et la recommandation de cette publication sont conservées dans l’export JSON.";}
      if(location.pathname.includes("/fnb-history/")){$("monthlyStatus").textContent="Archive figée à sa publication · "+D.optimization.generated_at.slice(0,10);return;}
      try{const response=await fetch(new URL("data/fnb-status.json",root),{cache:"no-cache"});if(!response.ok)return;const s=await response.json();$("monthlyStatus").textContent=s.status==="retrying"?s.message:"Dernière mise à jour validée : "+s.last_success.slice(0,10)+" · prochaine recherche au début de "+s.next_run.slice(0,7)+" · reprise quotidienne automatique si une source tarde.";}catch{}
    }
    document.documentElement.classList.remove("no-js");drawSummary();syncSelection();statsRows();drawRisk();drawGrowth();drawSector();switchView("allPortfolios");monthlyHistory();
    window.SavyFnbDecision?.start(D,dailyRisk,stressInput,{capital:()=>capital,parseCapital,open:(id,ref,view)=>{choosePortfolio(id,true);$('referenceSelect').value=ref;$('referenceSelect').dispatchEvent(new Event('change',{bubbles:true}));switchView(view);}});
    document.documentElement.dataset.ready="true";
  }
  return {relativeMetrics,parseCapital,start};
})();
if (typeof module === "object" && module.exports) module.exports = SavyFnb;
else SavyFnb.start(document);
