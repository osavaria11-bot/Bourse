(() => {
  "use strict";
  const V = window.ValuationUtils, panel = document.getElementById("panel-recherche-valuation");
  if (!V || !panel) return;
  const node = (tag, className, text) => {const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n;};
  const number = (x, digits = 1) => V.finite(x) ? new Intl.NumberFormat("fr-CA", {minimumFractionDigits:digits, maximumFractionDigits:digits}).format(x) : "—";
  const dateLabel = d => V.day(d) ? new Intl.DateTimeFormat("fr-CA", {day:"numeric", month:"short", year:"numeric",timeZone:"UTC"}).format(new Date(d+"T12:00:00Z")) : "date non confirmée";
  const section = node("section", "valuation-research"); section.id = "valuationResearch";
  const heading = node("div", "valuation-heading"), intro = node("div");
  intro.append(node("p", "eyebrow", "Recherche · Actions individuelles"), node("h2", "", "Valorisation & RSI des multiples"),
    node("p", "meta", "Compare le P/E et l’EV/EBITDA prévisionnels à leur propre histoire. Le RSI mesure le mouvement du multiple sélectionné."));
  const refresh = node("button", "button quiet", "Actualiser"); refresh.type = "button"; refresh.id = "valuationRefresh"; heading.append(intro, refresh); section.append(heading);
  const status = node("p", "meta"); status.id = "valuationStatus"; status.setAttribute("role", "status"); section.append(status);
  const controls = node("div", "valuation-controls");
  function select(id, label, options) {
    const field = node("label", "valuation-field"); field.append(node("span", "", label)); const input = node("select"); input.id = id;
    for (const [value, text] of options) {const option = node("option", "", text); option.value = value; input.append(option);} field.append(input); controls.append(field); return input;
  }
  const scope = select("valuationScope", "Univers", [["mine","Mes actions + screener"],["OS","Portefeuille OS"],["JMC","Portefeuille JMC"],["MCL","Portefeuille MCL"],["research","Screener · toutes les éditions"],["all","Toutes les actions disponibles"]]);
  const stock = select("valuationStock", "Action", []);
  const basis = select("valuationBasis", "Prévisions", [["blended","12 mois glissants · pondération annuelle"],["fiscal","Exercices fiscaux · FY1 / FY2"]]);
  const horizonHost = node("div", "valuation-field"); horizonHost.append(node("span", "", "Horizon prévisionnel"));
  const horizons = node("div", "segmented"); horizons.setAttribute("role","group"); horizons.setAttribute("aria-label","Horizon prévisionnel");
  for (const [value, label] of [[1,"1 an"],[2,"2 ans"]]) {const button = node("button","",label); button.type="button"; button.dataset.horizon=String(value); button.setAttribute("aria-pressed",String(value===1)); horizons.append(button);}
  horizonHost.append(horizons); controls.append(horizonHost); section.append(controls);
  const membership = node("p", "meta"); membership.id="valuationMembership"; section.append(membership);
  const rangeHost = node("div", "valuation-range"), ranges = node("div", "segmented"); ranges.setAttribute("role","group"); ranges.setAttribute("aria-label","Historique des multiples");
  rangeHost.append(node("span", "meta", "Historique"), ranges);
  for (const [value,label] of [["1Y","1 an"],["3Y","3 ans"],["5Y","5 ans"],["MAX","Maximum"]]) {const b=node("button","",label); b.type="button"; b.dataset.range=value; b.setAttribute("aria-pressed",String(value==="5Y")); ranges.append(b);} section.append(rangeHost);
  const detail = node("p", "valuation-source-note"); detail.id = "valuationSourceNote"; section.append(detail);
  const coverageNote = node("p", "valuation-coverage-note"); coverageNote.id="valuationHistoryCoverage"; section.append(coverageNote);
  const charts = node("div","valuation-charts"); section.append(charts);
  const cards = {};
  for (const [id, title] of [["pe","P/E forward"],["ev_ebitda","EV/EBITDA forward"]]) {
    const card = node("article","valuation-card"); card.dataset.metric=id;
    const head=node("div","valuation-card-heading"), titleNode=node("h3","",title), reading=node("strong","valuation-reading","—");
    head.append(titleNode,reading); const stats=node("div","valuation-stats"), host=node("div","valuation-chart"), note=node("p","meta");
    host.id=id==="pe"?"valuationPeChart":"valuationEvChart"; note.id=id==="pe"?"valuationPeNote":"valuationEvNote";
    card.append(head,stats,host,note); charts.append(card); cards[id]={card,title:titleNode,reading,stats,host,note};
  }
  const method=node("details","portal-method valuation-method"); method.append(node("summary","","Méthode, sources et couverture historique"));
  for (const text of [
    "1 an : consensus des 12 prochains mois. 2 ans : consensus des mois 13 à 24, et non bénéfice cumulé sur deux ans. Les prévisions annuelles sont pondérées selon les jours jusqu’à la fin de l’exercice. C’est une approximation par années fiscales; elle peut différer d’un consensus par trimestre ou de Bloomberg BEst.",
    "P/E = cours de référence / BPA prévisionnel. EV/EBITDA = EV au cours de référence / EBITDA prévisionnel. L’EV est indicative : capitalisation du relevé + dernière dette nette annuelle publiée, ou pont EV–capitalisation de la dernière année publiée si la dette nette manque. Les intérêts minoritaires, les actions privilégiées et les changements de bilan récents peuvent manquer. La date de ce pont est indiquée; cette approximation ne constitue pas un EV Bloomberg actualisé au dernier trimestre. L’EV future de MarketScreener, qui incorpore une dette ou une trésorerie projetée, n’est pas utilisée comme EV actuelle.",
    "Le RSI de Wilder, sur 14 variations quotidiennes du ratio, apparaît sous chaque multiple sur une échelle de 0 à 100; repères 30, 50 et 70. Il demande 15 clôtures vérifiées. Un RSI faible reflète une contraction récente du multiple; il ne suffit pas à établir qu’une action est bon marché. Les révisions de consensus peuvent faire bouger le multiple sans mouvement du cours.",
    "L’historique utilise les consensus effectivement archivés à chaque date. Il commence au premier relevé vérifié; choisir 5 ans ou Maximum n’invente pas les années manquantes. La table annuelle et le graphique estimé générique de MarketScreener ne sont pas réétiquetés comme une série Bloomberg 1BF/2BF. Un historique antérieur nécessite une source de consensus datés pour ces mêmes horizons. Les bénéfices négatifs, le consensus manquant et l’EV/EBITDA non pertinent pour les sociétés financières restent N/D.",
    "La médiane, les bornes du 10e au 90e percentile et le percentile du niveau actuel portent sur les clôtures disponibles dans la période choisie. Ils exigent au moins 30 observations. Ils mesurent une position relative dans l’échantillon, sans signal automatique d’achat ou de vente. Le RSI est initialisé avant la fenêtre affichée quand l’historique le permet.",
    "Seules les actions individuelles sont incluses. Les CDR Microsoft et Sandisk sont reliés explicitement à l’action américaine sous-jacente; ses multiples ne sont pas calculés avec le cours du CDR. La composition privée des trois comptes est lue uniquement sur cet appareil. Les quantités et les prix moyens ne sont transmis à aucune source de valorisation.",
    "Collecte du consensus prévue chaque jour vers 18 h 17, heure de Toronto. Les clôtures sont aussi reprises à 18 h 47 et 21 h 17 en semaine. L’onglet ouvert vérifie les données toutes les cinq minutes. Quand le consensus ne peut être actualisé, le dernier consensus connu garde sa date et peut être revalorisé avec une nouvelle clôture. Il n’est jamais présenté comme une nouvelle estimation. Un consensus de plus de sept jours est exclu du RSI et des repères historiques."
  ]) method.append(node("p","meta",text));
  const links=node("p","meta");
  for (const [label,href] of [["Bloomberg · consensus datés","https://professional.bloomberg.com/products/data/enterprise-catalog/cofi/"],["Bloomberg · études techniques","https://assets.bbhub.io/professional/sites/10/RMB-Equity-Solutions.pdf"],["RSI de Wilder · Fidelity","https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/RSI"]]) {
    const a=node("a","",label+" ↗"); a.href=href; a.target="_blank"; a.rel="noopener noreferrer"; links.append(a,document.createTextNode(" · "));
  }
  method.append(links); section.append(method); panel.append(section);
  let config=null, index=null, members=[], histories=new Map(), loading=false, selected="", horizon=1, range="5Y", cached=false, holdings={}, current=null;
  function save(key,value) {try{localStorage.setItem(key,JSON.stringify(value));}catch{}}
  function stored(key){try{return JSON.parse(localStorage.getItem(key));}catch{return null;}}
  async function get(path) {const r=await fetch(path+"?v="+Date.now(),{cache:"no-store",signal:AbortSignal.timeout(20000)}); if(!r.ok)throw new Error("Source indisponible"); return r.json();}
  async function syncMemberships() {
    try {holdings=await window.SavyPortfolioStocks?.list()||{};}catch{holdings={};}
    if(!config)return; members=V.memberIds(config,holdings); renderStocks();
  }
  function visibleRows() {
    return members.filter(row=>scope.value==="all" || (scope.value==="mine" && (row.portfolios.length || row.research)) ||
      (scope.value==="research" && row.research) || row.portfolios.includes(scope.value));
  }
  function renderStocks() {
    const rows=visibleRows(); stock.replaceChildren();
    for(const row of rows){const option=node("option","",(row.id==="SNDKUS"?"SNDK":row.id)+" · "+row.title); option.value=row.id; stock.append(option);}
    if(!rows.some(r=>r.id===selected))selected=rows.find(r=>r.id==="NVDA")?.id||rows[0]?.id||"";
    stock.value=selected; stock.disabled=!rows.length;
    const count=Object.keys(holdings).length, member=members.find(r=>r.id===selected);
    membership.textContent=rows.length+" actions · "+(count?count+"/3 portefeuilles accessibles sur cet appareil":"Portefeuilles privés non chargés sur cet appareil")+
      (member?" · "+[...member.portfolios, ...(member.research?["Screener"]:[])].join(" / "):"");
  }
  async function load() {
    if(loading)return; loading=true; refresh.disabled=true; status.textContent="Chargement des consensus datés…";
    try {
      if(!config) config=V.universe(await get("data/valuation-universe.json"));
      try {index=V.index(await get("data/valuations/index.json"),config); cached=false;save("savy:valuations:index:v1",index);}
      catch {index=V.index(stored("savy:valuations:index:v1"),config);cached=true;}
      histories.clear(); await syncMemberships(); await render();
    } catch(error){status.textContent="Les consensus ne sont pas encore disponibles. "+error.message+". Les données manquantes restent N/D."; if(config){await syncMemberships();await render();}}
    finally{loading=false;refresh.disabled=false;}
  }
  async function render() {
    const id=selected, row=index?.instruments.find(r=>r.id===id), member=members.find(r=>r.id===id);
    for(const b of horizons.children){b.setAttribute("aria-pressed",String(+b.dataset.horizon===horizon));b.textContent=basis.value==="fiscal"?"FY"+b.dataset.horizon:b.dataset.horizon+" an"+(b.dataset.horizon==="2"?"s":"");}
    for(const b of ranges.children)b.setAttribute("aria-pressed",String(b.dataset.range===range));
    let data=histories.get(id)||{id,financial:member?.financial,observations:[]};
    if(id&&row?.latest&&!histories.has(id)){
      try {data=V.history(await get("data/valuations/"+encodeURIComponent(id)+".json"),id);histories.set(id,data);save("savy:valuation:"+id+":v1",data);}
      catch {try{data=V.history(stored("savy:valuation:"+id+":v1"),id);}catch{}}
    }
    if(id!==selected)return;
    const latest=row?.latest||data.observations.at(-1)||null;
    const model=V.model({...data,financial:member?.financial},latest,horizon,range,basis.value); current={id,model,latest};
    const age=latest?Date.now()-Date.parse(latest.observed_at):Infinity;
    const stale=cached||row?.fetch_status==="cached"||age>36*3600000;
    status.textContent=(latest?"Valorisation du "+dateLabel(latest.date)+" · consensus du "+dateLabel(latest.consensus_date||latest.date)+(stale?" conservé":"")+" · ":"")+
      (index?index.instruments.filter(i=>i.latest).length+"/"+config.instruments.length+" actions avec un relevé · ":"")+"Actualisation quotidienne après clôture";
    const mode=basis.value==="fiscal"?"Exercice fiscal FY"+horizon:"Prévisions "+(horizon===1?"des mois 1 à 12":"des mois 13 à 24");
    detail.replaceChildren(node("strong","",mode+" · "+(member?.title||"Choisis une action")));
    if(latest){
      if(member?.listing_note)detail.append(document.createTextNode(" — "+member.listing_note));
      detail.append(document.createTextNode(" — cours "+number(latest.price,2)+" "+latest.currency+" du "+dateLabel(latest.price_date)+
        "; pont EV de bilan au "+dateLabel(latest.ev_bridge_date)+" (EV indicative). "));
      const link=node("a","","Consensus MarketScreener ↗"); link.href=latest.source_url;link.target="_blank";link.rel="noopener noreferrer";detail.append(link);
      if((id==="MSFT"&&config.aliases.MSFTCDR)||(id==="SNDKUS"&&config.aliases.SNDK))detail.append(document.createTextNode(" Action américaine sous-jacente aux CDR; aucune conversion du prix du CDR."));
    }
    const observed=data.observations.filter(s=>s.complete_session&&s.price_date===s.date);
    coverageNote.hidden=observed.length>=30;
    coverageNote.textContent="Historique antérieur 1 an / 2 ans non disponible dans les sources actuelles. "+
      (data.observations.length?"Relevés archivés depuis le "+dateLabel(data.observations[0].date)+". ":"")+
      "Le RSI apparaîtra après 15 clôtures vérifiées; la médiane et les percentiles après 30. Une source de consensus historiques datés est nécessaire pour afficher cinq ans dès maintenant.";
    for(const key of ["pe","ev_ebitda"]){
      const card=cards[key], m=model[key], label=key==="pe"?"P/E forward":"EV/EBITDA forward";
      card.title.textContent=label+(basis.value==="fiscal"?" · FY"+horizon:" · "+horizon+" an"+(horizon===2?"s":""))+(m.period_end?" · fin "+dateLabel(m.period_end):"");
      card.reading.textContent=V.finite(m.latest)?number(m.latest)+"×"+ (key==="ev_ebitda"?" ≈":""):"N/D";
      card.stats.replaceChildren();
      for(const [label,value] of [["RSI du multiple · 14 séances",V.finite(m.latestRsi)?number(m.latestRsi):"N/D"],
        ["Médiane historique",m.stats.available?number(m.stats.median)+"×":"N/D"],
        ["Percentile du niveau actuel",m.stats.available?number(m.stats.percentile,0)+" / 100":"N/D"],
        ["Écart à la médiane",m.stats.available?(m.stats.premium>0?"+":"")+number(m.stats.premium)+" %":"N/D"]]){
        const stat=node("div");stat.append(node("span","meta",label),node("strong","",value));card.stats.append(stat);
      }
      let reason=!latest?"Consensus non disponible pour cette action.":key==="ev_ebitda"&&member?.financial?"EV/EBITDA non pertinent pour cette société financière.":
        !V.finite(m.latest)?"Prévisions de cet horizon absentes ou dénominateur non positif; aucune substitution par du TTM.":"";
      const valid=m.points.filter(p=>V.finite(p[1]));
      card.note.textContent=(reason?reason+" ":"")+(valid.length?valid.length+" clôture"+(valid.length>1?"s":"")+" vérifiée"+(valid.length>1?"s":"")+" · "+dateLabel(valid[0][0])+" → "+dateLabel(valid.at(-1)[0])+". ":"")+
        (valid.length<15?"Historique forward daté en constitution. RSI disponible après 15 clôtures; repères historiques après 30. Les cinq années antérieures nécessitent des consensus historiques pour le même horizon.":
        "RSI calculé sur le multiple sélectionné. Le percentile et le RSI répondent à deux questions différentes.");
      draw(card.host,m,label,latest?.date);
    }
  }
  function draw(host,m,label,latestDay){
    host.replaceChildren();
    const all=m.points.filter(p=>V.finite(p[1])&&p[1]>0), rsi=m.rsi.filter(p=>V.finite(p[1]));
    // A single current snapshot is a point with a true date, never a flat five-year line.
    if(!all.length&&V.finite(m.latest)&&latestDay)all.push([latestDay,m.latest]);
    if(!all.length){host.append(node("p","valuation-empty","Aucun point de valorisation vérifié à tracer pour cet horizon."));return;}
    const ns="http://www.w3.org/2000/svg",width=Math.max(300,Math.round(host.clientWidth||1000)),height=390,left=60,right=25,top=20,middle=230,rsiTop=280,bottom=350;
    const svg=document.createElementNS(ns,"svg");svg.setAttribute("viewBox","0 0 "+width+" "+height);svg.setAttribute("role","img");svg.setAttribute("aria-label",label+" et RSI de ce multiple");svg.setAttribute("tabindex","0");
    const title=document.createElementNS(ns,"title");title.textContent=label+" en haut; RSI de Wilder sur 14 séances en bas. Flèches pour parcourir les observations.";svg.append(title);
    const first=Date.parse(all[0][0]),last=Date.parse(all.at(-1)[0]),span=last-first||86400000;
    const x=d=>left+(width-left-right)*(last===first?.5:(Date.parse(d)-first)/span);
    const vals=all.map(p=>p[1]),lo=Math.max(0,Math.min(...vals)*.92),hi=Math.max(...vals)*1.08||1;
    const y=v=>middle-(v-lo)/(hi-lo)*(middle-top),ry=v=>bottom-v/100*(bottom-rsiTop);
    const element=(tag,attrs,text)=>{const e=document.createElementNS(ns,tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,String(v));if(text!==undefined)e.textContent=text;svg.append(e);return e;};
    for(let i=0;i<4;i++){const v=lo+(hi-lo)*i/3; element("line",{x1:left,x2:width-right,y1:y(v),y2:y(v),class:"valuation-grid"});element("text",{x:left-10,y:y(v)+4,"text-anchor":"end",class:"valuation-axis"},number(v)+"×");}
    if(m.stats.available){
      const lower=y(m.stats.low),upper=y(m.stats.high);element("rect",{x:left,y:upper,width:width-left-right,height:Math.max(0,lower-upper),class:"valuation-band"});
      element("line",{x1:left,x2:width-right,y1:y(m.stats.median),y2:y(m.stats.median),class:"valuation-median"});
    }
    for(const v of[30,50,70]){element("line",{x1:left,x2:width-right,y1:ry(v),y2:ry(v),class:"valuation-rsi-grid"});element("text",{x:left-10,y:ry(v)+4,"text-anchor":"end",class:"valuation-axis"},String(v));}
    element("text",{x:left,y:rsiTop-12,class:"valuation-axis"},"RSI DU MULTIPLE · 14 SÉANCES");
    function path(points,mapY,className){let active=false,d="";for(const p of points){if(!V.finite(p[1])){active=false;continue;}d+=(active?"L":"M")+x(p[0]).toFixed(2)+","+mapY(p[1]).toFixed(2);active=true;}if(d)element("path",{d,class:className,fill:"none"});}
    path(m.points,y,"valuation-line");path(m.rsi,ry,"valuation-rsi-line");
    if(all.length===1)element("circle",{cx:x(all[0][0]),cy:y(all[0][1]),r:4,class:"valuation-dot"});
    for(const [d,align] of[[all[0][0],"start"],[all.at(-1)[0],"end"]])if(all.length>1||align==="start")element("text",{x:all.length===1?x(d):align==="start"?left:width-right,y:height-10,"text-anchor":all.length===1?"middle":align,class:"valuation-axis"},dateLabel(d));
    if(!rsi.length)element("text",{x:(width+left-right)/2,y:rsiTop+42,"text-anchor":"middle",class:"valuation-axis"},"RSI en attente de 15 clôtures vérifiées");
    const guide=element("line",{x1:0,x2:0,y1:top,y2:bottom,class:"valuation-guide",visibility:"hidden"});
    const hint="Survole ou touche pour lire une date. Au clavier : flèches, Début et Fin.",tooltip=node("p","chart-tooltip",hint);tooltip.setAttribute("aria-live","polite");
    let at=all.length-1;
    function show(i){at=Math.max(0,Math.min(all.length-1,i));const[d,v]=all[at],r=m.rsi.find(p=>p[0]===d)?.[1];guide.setAttribute("x1",x(d));guide.setAttribute("x2",x(d));guide.setAttribute("visibility","visible");tooltip.textContent=dateLabel(d)+" · "+label+" "+number(v,2)+"× · RSI du multiple : "+(V.finite(r)?number(r):"N/D");}
    svg.addEventListener("focus",()=>show(at));svg.addEventListener("keydown",e=>{if(!["ArrowLeft","ArrowRight","Home","End"].includes(e.key))return;e.preventDefault();show(e.key==="Home"?0:e.key==="End"?all.length-1:at+(e.key==="ArrowLeft"?-1:1));});
    svg.addEventListener("pointermove",e=>{const b=svg.getBoundingClientRect(),v=first+((e.clientX-b.left)*width/b.width-left)/(width-left-right)*span;let best=0;for(let i=1;i<all.length;i++)if(Math.abs(Date.parse(all[i][0])-v)<Math.abs(Date.parse(all[best][0])-v))best=i;show(best);});
    svg.addEventListener("pointerleave",()=>{if(document.activeElement!==svg){guide.setAttribute("visibility","hidden");tooltip.textContent=hint;}});host.append(svg,tooltip);
  }
  refresh.addEventListener("click",load);scope.addEventListener("change",()=>{renderStocks();render();});stock.addEventListener("change",()=>{selected=stock.value;renderStocks();render();});basis.addEventListener("change",render);
  horizons.addEventListener("click",e=>{const b=e.target.closest("[data-horizon]");if(b){horizon=+b.dataset.horizon;render();}});
  ranges.addEventListener("click",e=>{const b=e.target.closest("[data-range]");if(b){range=b.dataset.range;render();}});
  document.addEventListener("savy:navigate",e=>{if(e.detail.page==="recherche"&&e.detail.tab==="valuation"){if(!config)load();else syncMemberships().then(render);}});
  document.addEventListener("savy:holdings",()=>{if(config&&!panel.hidden)syncMemberships().then(render);});
  document.addEventListener("visibilitychange",()=>{if(!document.hidden&&!panel.hidden)load();});setInterval(()=>{if(!document.hidden&&!panel.hidden)load();},300000);
  let resizeFrame;window.addEventListener("resize",()=>{if(config&&!panel.hidden){cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(render);}});
  if(!panel.hidden)load();
})();
