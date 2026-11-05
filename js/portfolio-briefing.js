(() => {
  "use strict";
  const root = document.getElementById("panel-portefeuilles-analysis");
  if (!root) return;
  const U = window.SavyPortfolioBriefingUtils, KEY = "savy:portfolio-private-briefings:v1";
  const $ = selector => root.querySelector(selector);
  const title = $("#portfolioBriefingLatestTitle"), status = $("#portfolioBriefingStatus");
  const content = $("#portfolioBriefingContent"), archive = $("#portfolioBriefingArchives");
  const dateField = $("#portfolioBriefingDate"), textField = $("#portfolioBriefingText");
  const dataDate = $("#portfolioBriefingDataDate"), pdfField = $("#portfolioBriefingPdfUrl");
  const formStatus = $("#portfolioBriefingFormStatus"), form = root.querySelector(".portfolio-briefing-form");
  const select = $("#portfolioBriefingEdition"), pdfLink = $("#portfolioBriefingPdf"), editor = $("#portfolioBriefingEditor");
  const tabs = [...root.querySelectorAll('[role="tab"][data-committee-section]')];
  let selectedDate = null, selectedSection = "summary", draftBatch = null;
  let remoteEntries=[],remoteCatalog=[];
  const privatePdfs=new Map();
  function editions() {return U.merge(U.entries(localStorage.getItem(KEY) || "[]"),remoteEntries);}
  function available(entries){return [...new Set([...entries.map(x=>x.date),...remoteCatalog.map(x=>x.date)])].sort((a,b)=>b.localeCompare(a));}
  function node(tag,className,text) {const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n;}

  // Report text is data. Build a small Markdown vocabulary with DOM text nodes;
  // never execute embedded HTML, load remote images, or embed a PDF URL.
  function inline(host,text) {
    const tokens=/\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https:\/\/[^\s)]+\)/g;
    let cursor=0;
    for (const token of text.matchAll(tokens)) {
      host.append(document.createTextNode(text.slice(cursor,token.index)));
      const value=token[0];
      if (value.startsWith("**")) host.append(node("strong","",value.slice(2,-2)));
      else if (value.startsWith("`")) host.append(node("code","",value.slice(1,-1)));
      else {
        const match=value.match(/^\[([^\]]+)\]\((https:\/\/[^\s)]+)\)$/);
        let url;try {url=new URL(match[2]);}catch {url=null;}
        if (url && url.protocol==="https:" && !url.username && !url.password) {
          const link=node("a","",match[1]);link.href=url.href;link.target="_blank";link.rel="noopener noreferrer";host.append(link);
        } else host.append(document.createTextNode(value));
      }
      cursor=token.index+value.length;
    }
    host.append(document.createTextNode(text.slice(cursor)));
  }
  const cells = line => line.trim().replace(/^\|/,"").replace(/\|$/,"").replace(/\\\|/g,"\u0000").split("|").map(x=>x.replace(/\u0000/g,"|").trim());
  const separator = line => line.includes("|") && cells(line).every(x=>/^:?-{3,}:?$/.test(x));
  function markdown(host,text,emptyText) {
    host.replaceChildren();
    if (!text) {host.append(node("p","committee-empty",emptyText));return;}
    const lines=text.replace(/\r\n?/g,"\n").split("\n");let paragraph=[],list=null;
    const flush=()=>{if(paragraph.length){const p=node("p");inline(p,paragraph.join(" "));host.append(p);paragraph=[];}list=null;};
    for (let i=0;i<lines.length;i++) {
      const line=lines[i].trim();
      if (!line) {flush();continue;}
      if (line.includes("|") && i+1<lines.length && separator(lines[i+1])) {
        flush();const wrap=node("div","committee-table-wrap"),table=node("table"),head=node("thead"),row=node("tr");
        const headers=cells(line);for(const value of headers){const cell=node("th");cell.scope="col";inline(cell,value);row.append(cell);}head.append(row);table.append(head);
        const body=node("tbody");i++;
        while(i+1<lines.length && lines[i+1].includes("|") && lines[i+1].trim()) {
          const values=cells(lines[++i]),tr=node("tr");
          for(let j=0;j<Math.max(headers.length,values.length);j++){const cell=node("td");inline(cell,values[j]||"");tr.append(cell);}body.append(tr);
        }
        table.append(body);wrap.append(table);host.append(wrap);continue;
      }
      const heading=line.match(/^#{1,6}\s+(.+)/);
      if (heading) {flush();const h=node("h5");inline(h,heading[1]);host.append(h);continue;}
      if (/^[-*_]{3,}$/.test(line)) {flush();host.append(node("hr"));continue;}
      const item=line.match(/^(?:([-*+])\s+|\d+[.)]\s+)(.*)/);
      if (item) {
        if(paragraph.length)flush();const tag=item[1]?"ul":"ol";
        if(!list||list.tagName.toLowerCase()!==tag){list=node(tag);host.append(list);}
        const li=node("li");inline(li,item[2]);list.append(li);continue;
      }
      if(list)list=null;
      paragraph.push(line);
    }
    flush();
  }
  function section(id,focus=false) {
    if(!U.SECTIONS.some(x=>x.id===id))return;
    selectedSection=id;root.dataset.committeeSection=id;
    for(const tab of tabs){const active=tab.dataset.committeeSection===id;tab.setAttribute("aria-selected",String(active));tab.tabIndex=active?0:-1;}
    for(const panel of content.querySelectorAll('[role="tabpanel"]'))panel.hidden=panel.id!=="portfolioBriefingPanel-"+id;
    if(focus)tabs.find(x=>x.dataset.committeeSection===id)?.focus({preventScroll:true});
  }
  function show() {
    let entries=[],error="";
    try{entries=editions();}catch {error="L’historique privé ne peut pas être lu sur cet appareil. Les rapports existants n’ont pas été modifiés.";}
    const current=entries.find(x=>x.date===selectedDate)||entries[0];selectedDate=current?.date||null;
    const dates=available(entries);
    title.textContent=current?"Revue du "+U.dayLabel(current.date):remoteCatalog.length?"Comité du "+U.dayLabel(remoteCatalog[0].date)+" · accès privé":"Première édition à venir";
    status.textContent=error||(current?(privatePdfs.has(current.date)?"Rapport privé synchronisé dans SAVY":"Rapport privé conservé dans ce navigateur")+" · "+dates.length+" édition"+(dates.length>1?"s":""):
      remoteCatalog.length?"Aucune édition privée ouverte sur cet appareil. Utilise le lien privé d’Analyse communiqué dans ChatGPT.":"Aucune édition privée enregistrée. Le comité est programmé chaque jeudi à 3 h, heure de Montréal.");
    $("#portfolioBriefingMeta").textContent=current?
      "Données : "+(current.data_date?U.dayLabel(current.data_date):"date non indiquée")+" · Finviz : "+(current.finviz_date?U.dayLabel(current.finviz_date):"date non indiquée"):
      "Base d’analyse : clôture du mercredi · Dernier rapport Finviz du mercredi soir";
    select.replaceChildren();select.disabled=!dates.length;
    if(!dates.length){select.append(node("option","","Aucune édition"));}
    for(const date of dates){const option=node("option","",U.dayLabel(date));option.value=date;option.selected=date===selectedDate;select.append(option);}
    const privatePdf=current&&privatePdfs.get(current.date),pdfUrl=privatePdf||current?.pdf_url;
    pdfLink.hidden=!pdfUrl;
    if(pdfUrl)pdfLink.href=pdfUrl;else pdfLink.removeAttribute("href");
    if(privatePdf){pdfLink.download="SAVY_Comite_"+current.date+".pdf";pdfLink.textContent="Télécharger le PDF";}else{pdfLink.removeAttribute("download");pdfLink.textContent="Ouvrir le PDF ↗";}
    for(const host of root.querySelectorAll("[data-committee-content]"))markdown(host,current?.sections[host.dataset.committeeContent],host.dataset.emptyText);
    $("#portfolioBriefingExport").disabled=!entries.length;
    archive.replaceChildren();
    if (!dates.length) {
      archive.append(node("p","committee-empty","Aucune édition précédente disponible sur cet appareil."));
    }
    for (const date of dates) {
      const entry=entries.find(x=>x.date===date);
      const row=node("div","portfolio-briefing-archive-row"),button=node("button","","Édition du "+U.dayLabel(date));button.type="button";
      button.dataset.briefingDate = date;
      if (current?.date === date) button.setAttribute("aria-current", "true");
      const meta=node("span","meta",(date===selectedDate?"Affichée":"Consulter")+(privatePdfs.has(date)||entry?.pdf_url?" · PDF personnel":""));
      row.append(button,meta);archive.append(row);
    }
    section(selectedSection);
  }
  root.addEventListener("click",event=>{
    const tab=event.target.closest("button[data-committee-section]");
    if(tab){section(tab.dataset.committeeSection,true);return;}
    const link=event.target.closest("a[data-committee-portfolio]");
    if(link){const id=link.dataset.committeePortfolio;if(["1","2","3"].includes(id))document.querySelector('.portfolio-choice [data-portfolio-id="'+id+'"]')?.click();}
  });
  root.querySelector(".committee-nav").addEventListener("keydown",event=>{
    if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
    const i=tabs.indexOf(event.target);if(i<0)return;event.preventDefault();
    const next=event.key==="Home"?0:event.key==="End"?tabs.length-1:(i+(event.key==="ArrowRight"?1:-1)+tabs.length)%tabs.length;
    section(tabs[next].dataset.committeeSection,true);
  });
  $("#portfolioBriefingAdd").addEventListener("click",()=>{section("reports");editor.open=true;dateField.focus({preventScroll:true});editor.scrollIntoView({block:"nearest"});});
  function chooseEdition(date){if(!editions().some(x=>x.date===date)&&remoteCatalog.some(x=>x.date===date)){window.SavyCommitteeReports?.load(date).catch(()=>{});return;}selectedDate=date;show();}
  select.addEventListener("change",()=>chooseEdition(select.value));
  archive.addEventListener("click", event => {
    const button = event.target.closest("button[data-briefing-date]");
    if (!button) return;
    selectedSection="summary";chooseEdition(button.dataset.briefingDate);
    title.scrollIntoView({block:"nearest", behavior:"auto"});
  });
  $("#portfolioBriefingImport").addEventListener("change",async event=>{
    const file=event.target.files?.[0];if(!file)return;
    try{
      if(file.size>5*1024*1024)throw Error("Le fichier dépasse 5 Mo. Importe les rapports en plusieurs fichiers.");
      const raw=await file.text();
      if(file.name.toLowerCase().endsWith(".json"))draftBatch=U.merge([],U.importPayload(raw));
      else {
        const nameDate=file.name.match(/\d{4}-\d{2}-\d{2}/)?.[0];
        draftBatch=[U.normalize({date:U.validDate(nameDate)?nameDate:dateField.value,text:raw})];
      }
      const latest=draftBatch[0];dateField.value=latest.date;dataDate.value=latest.data_date||"";pdfField.value=latest.pdf_url||"";textField.value=latest.text;
      $("#portfolioBriefingSave").textContent=draftBatch.length>1?"Conserver les "+draftBatch.length+" rapports dans SAVY":"Conserver la revue dans SAVY";
      formStatus.textContent=draftBatch.length>1?draftBatch.length+" rapports chargés. Vérifie l’édition la plus récente puis enregistre l’historique.":"Rapport chargé. Vérifie la date et le contenu, puis enregistre.";
    }catch(error){draftBatch=null;formStatus.textContent=error.message||"Ce fichier ne peut pas être importé.";}
    finally{event.target.value="";}
  });
  form.addEventListener("submit", event => {
    event.preventDefault();
    try{
      const original=draftBatch?.[0],text=textField.value.trim();
      const candidate=U.normalize({date:dateField.value,text,data_date:dataDate.value,pdf_url:pdfField.value.trim(),
        finviz_date:original?.finviz_date,sections:original?.text===text?original.sections:undefined});
      const incoming=draftBatch?.length>1?[candidate,...draftBatch.slice(1)]:[candidate];
      const entries=U.merge(editions(),incoming);
      try{localStorage.setItem(KEY,JSON.stringify(entries));}
      catch{throw Error("Enregistrement impossible : le stockage de cet appareil est indisponible ou plein. Les éditions précédentes sont conservées; exporte l’historique pour en garder une copie.");}
      selectedDate=candidate.date;selectedSection="summary";draftBatch=null;
      textField.value="";pdfField.value="";dataDate.value="";$("#portfolioBriefingSave").textContent="Conserver la revue dans SAVY";
      formStatus.textContent="Édition enregistrée sur cet appareil. Aucune information envoyée à GitHub.";
      show();title.scrollIntoView({block:"nearest"});
    }catch(error){formStatus.textContent=error.message||"Le rapport n’a pas pu être enregistré. Les éditions précédentes sont conservées.";}
  });
  $("#portfolioBriefingExport").addEventListener("click",()=>{
    try{
      const values=editions();if(!values.length)return;
      const blob=new Blob([JSON.stringify({schema_version:1,editions:values},null,2)],{type:"application/json"});
      const url=URL.createObjectURL(blob),a=node("a");a.href=url;a.download="SAVY_Comite_historique.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
    }catch {status.textContent="L’historique ne peut pas être exporté pour le moment. Les rapports enregistrés sont conservés.";}
  });
  window.addEventListener("storage",event=>{if(event.key===KEY)show();});
  window.addEventListener("savy:committee:catalog",event=>{remoteCatalog=event.detail.editions;show();});
  window.addEventListener("savy:committee:loading",event=>{status.textContent="Ouverture privée du comité du "+U.dayLabel(event.detail.date)+"…";});
  window.addEventListener("savy:committee:loaded",event=>{const value=event.detail;remoteEntries=U.merge(remoteEntries,[value.report]);privatePdfs.set(value.report.date,value.pdfUrl);selectedDate=value.report.date;show();});
  window.addEventListener("savy:committee:error",event=>{show();status.textContent=event.detail.message;});
  try {
    dateField.value = new Intl.DateTimeFormat("sv-SE", {timeZone:"America/Toronto",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  } catch {dateField.value = new Date().toISOString().slice(0,10);}
  show();
})();
