(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SavyPortfolioBriefingUtils = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const MAX_LENGTH = 250000;
  const SECTIONS = [
    {id:"summary", label:"Synthèse", title:"Résumé exécutif"},
    {id:"os", label:"OS · FEQT", title:"Portefeuille OS — FEQT"},
    {id:"jmc", label:"JMC · VBAL", title:"Portefeuille JMC — VBAL"},
    {id:"mcl", label:"MCL · VGRO", title:"Portefeuille MCL — VGRO"},
    {id:"optimization", label:"Optimisation", title:"Comparaison et optimisation"},
    {id:"decisions", label:"Décisions & suivi", title:"Décisions et suivi"},
    {id:"reports", label:"Rapports", title:"Rapports et sources"},
  ];
  const TITLES = {
    summary:"Résumé exécutif", os:"Portefeuille OS — FEQT", jmc:"Portefeuille JMC — VBAL", mcl:"Portefeuille MCL — VGRO",
    comparison:"Comparaison des trois portefeuilles", optimization:"Analyse des scénarios optimisés",
    recommendations:"Tableau des recommandations", follow_up:"Suivi des décisions précédentes",
    outlook:"Perspectives et surveillance", methodology:"Méthodologie, sources et limites",
  };
  function validDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const d = new Date(value + "T12:00:00Z");
    return Number.isFinite(+d) && d.toISOString().slice(0,10) === value;
  }
  function dayLabel(value) {
    return validDate(value) ? new Intl.DateTimeFormat("fr-CA", {timeZone:"UTC",day:"numeric",month:"long",year:"numeric"}).format(new Date(value+"T12:00:00Z")) : "Date non indiquée";
  }
  // Only an account-bound Library reference is accepted here. A public PDF URL
  // must never be presented as an authenticated personal report.
  function libraryUrl(value) {
    if (!value) return null;
    if (typeof value !== "string" || value.length > 500) return null;
    try {
      const u = new URL(value), params = [...u.searchParams.keys()];
      if (u.origin !== "https://chatgpt.com" || u.pathname !== "/library" || u.username || u.password || u.hash ||
          params.length !== 2 || new Set(params).size !== 2 || !params.includes("file_id") || !params.includes("account_id") ||
          u.searchParams.get("account_id") !== "personal" || !/^libfile_[A-Za-z0-9_-]{8,160}$/.test(u.searchParams.get("file_id") || "")) return null;
      return u.href;
    } catch {return null;}
  }
  function sectionHeading(line) {
    let s = line.trim();
    if (!s || s.startsWith("|") || /^[-*+]\s/.test(s)) return null;
    const explicit = /^#{1,6}\s/.test(s) || /^\*\*.+\*\*\s*$/.test(s);
    s = s.replace(/^#{1,6}\s+/,"").replace(/^\*\*|\*\*$/g,"").replace(/^\d+(?:\.\d+)*[.)]?\s+/,"");
    const n = s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim();
    if (n.length > 125) return null;
    const portfolio = n.match(/^(?:(?:portefeuille|analyse du portefeuille|conclusion du portefeuille|conclusion|revue) )?(os|jmc|mcl)(?: (feqt|vbal|vgro))?$/);
    if (portfolio) return portfolio[1];
    const match = [
      ["summary", /^(?:resume executif|synthese|les cinq conclusions|conclusions principales)$/],
      ["comparison", /^(?:comparaison(?: transversale)? (?:des )?trois portefeuilles|comparaison transversale)$/],
      ["optimization", /^(?:analyse des scenarios optimises|optimisation(?: des trois portefeuilles)?|comparaison et optimisation)$/],
      ["recommendations", /^(?:tableau des recommandations|recommandations(?: globales)?|decisions prioritaires(?: de la semaine)?)$/],
      ["follow_up", /^(?:suivi des (?:decisions|recommandations)(?: precedentes)?|evaluation des recommandations|suivi des recommandations et evaluation du gestionnaire)$/],
      ["outlook", /^(?:perspectives(?: et surveillance)?|catalyseurs et risques a surveiller)$/],
      ["methodology", /^(?:methodologie(?: sources et limites)?|sources(?: et limites)?|methodologie et sources)$/],
    ].find(([,re])=>re.test(n));
    if (match && (explicit || !/[.!?]\s*$/.test(s))) return match[0];
    return null;
  }
  function splitText(text) {
    const sections = {}, lines = text.replace(/\r\n?/g,"\n").split("\n");
    let key = "summary", found = false, buffer = [];
    const flush = () => {const body=buffer.join("\n").trim();if(body)sections[key]=[sections[key],body].filter(Boolean).join("\n\n");buffer=[];};
    for (const line of lines) {
      const next = sectionHeading(line);
      if (next) {flush();key=next;found=true;} else buffer.push(line);
    }
    flush();
    return {sections, classified:found};
  }
  function textFromSections(sections) {
    return Object.entries(TITLES).filter(([key])=>sections[key]).map(([key,title])=>"## "+title+"\n\n"+sections[key]).join("\n\n");
  }
  function normalize(entry) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || !validDate(entry.date)) throw Error("La date du rapport doit être au format AAAA-MM-JJ.");
    if (entry.schema_version != null && entry.schema_version !== 1) throw Error("Cette version du format de rapport n’est pas prise en charge.");
    let text = entry.text ?? entry.markdown ?? "";
    if (typeof text !== "string" || text.length > MAX_LENGTH) throw Error("Le rapport dépasse la taille permise (250 000 caractères).");
    const sections = {};
    if (entry.sections != null) {
      if (typeof entry.sections !== "object" || Array.isArray(entry.sections)) throw Error("Les sections du rapport sont invalides.");
      for (const key of Object.keys(TITLES)) {
        const body=entry.sections[key];
        if (body != null && (typeof body !== "string" || body.length > MAX_LENGTH)) throw Error("Une section du rapport est invalide.");
        if (body?.trim()) sections[key]=body.trim();
      }
    }
    if (!Object.keys(sections).length && text.trim()) Object.assign(sections,splitText(text).sections);
    if (!text.trim()) text=textFromSections(sections);
    if (!text.trim() || text.length > MAX_LENGTH || Object.values(sections).reduce((n,s)=>n+s.length,0) > MAX_LENGTH) throw Error("Ajoute un rapport de 250 000 caractères au maximum avant de l’enregistrer.");
    const result={schema_version:1,date:entry.date,text:text.trim(),sections};
    for (const key of ["data_date","finviz_date"]) {
      if (entry[key] != null && entry[key] !== "") {
        if (!validDate(entry[key])) throw Error("La date des données ou du rapport Finviz est invalide.");
        result[key]=entry[key];
      }
    }
    if (entry.pdf_url) {
      const url=libraryUrl(entry.pdf_url);
      if (!url) throw Error("Utilise le lien personnel du PDF dans ChatGPT, pas une adresse de PDF public.");
      result.pdf_url=url;
    }
    return result;
  }
  function entries(raw) {
    const values=typeof raw === "string" ? JSON.parse(raw || "[]") : raw;
    if (!Array.isArray(values)) throw Error("L’historique des rapports est illisible.");
    return values.map(normalize).sort((a,b)=>b.date.localeCompare(a.date));
  }
  function importPayload(raw) {
    const data=JSON.parse(raw);
    if (data?.editions && data.schema_version != null && data.schema_version !== 1) throw Error("Cette version de l’historique n’est pas prise en charge.");
    const values=Array.isArray(data)?data:data?.editions ?? [data];
    if (!Array.isArray(values) || !values.length) throw Error("Le fichier ne contient aucun rapport.");
    return values.map(normalize);
  }
  function merge(previous,incoming) {
    const byDate=new Map();
    for (const entry of [...previous,...incoming]) {const e=normalize(entry);byDate.set(e.date,e);}
    // No rolling limit: a new report must not silently remove older editions.
    return [...byDate.values()].sort((a,b)=>b.date.localeCompare(a.date));
  }
  return {MAX_LENGTH,SECTIONS,TITLES,validDate,dayLabel,libraryUrl,sectionHeading,splitText,textFromSections,normalize,entries,importPayload,merge};
});
