(() => {
  "use strict";
  const W = window.WeeklyReportsUtils, U = window.MacroUtils, host = document.getElementById("weeklyReportsGrid");
  if (!host) return;
  const KEY = "savy:weekly-reports:v1";
  let data = null, pending = null, copy = false;
  function el(tag, className, content) {
    const node = document.createElement(tag); if (className) node.className = className;
    if (content !== undefined) node.textContent = content; return node;
  }
  function render() {
    host.replaceChildren();
    for (const kind of W.KINDS) {
      const report = data?.reports[kind], card = el("article", "weekly-report card"); card.dataset.reportKind = kind;
      const label = kind === "real_estate" ? "IMMOBILIER · CANADA, QUÉBEC ET MONTÉRÉGIE" : "ACTIONS · RECHERCHE FINVIZ À 24 MOIS";
      card.append(el("p", "eyebrow", label), el("h3", "", report?.title || (kind === "real_estate" ? "Débriefing immobilier" : "Top 5 du screener Finviz")));
      if (!report) {card.append(el("p", "meta", "L’édition est indisponible pour le moment.")); host.append(card); continue;}
      const date = el("time", "meta weekly-report-date", "Édition du " + U.observationLabel(report.edition_date)); date.dateTime = report.edition_date;
      card.append(date, el("p", "weekly-report-summary", report.summary));
      if (report.highlights.length) {
        const list = el("ul", "weekly-report-highlights"); for (const item of report.highlights) list.append(el("li", "", item)); card.append(list);
      }
      if (kind === "real_estate" && report.opportunities.length) {
        card.append(el("h4", "weekly-report-subtitle", "Pistes étudiées dans l’édition"));
        const list = el("ul", "weekly-opportunities");
        for (const row of report.opportunities) {
          const item = el("li"); item.append(el("strong", "", row.address), el("span", "meta", row.city), el("p", "", row.detail)); list.append(item);
        }
        card.append(list);
      }
      if (kind === "stocks") {
        const count = report.stocks.length;
        card.append(el("p", "meta weekly-report-count", count ? count + (count > 1 ? " titres admissibles" : " titre admissible") + " dans cette édition" : "Aucun titre admissible dans cette édition"));
        const list = el("ol", "weekly-stock-list");
        for (const row of report.stocks) {
          const item = el("li", "weekly-stock"); item.dataset.ticker = row.ticker;
          const head = el("div", "weekly-stock-heading"), identity = el("div");
          identity.append(el("span", "weekly-stock-rank", String(row.rank).padStart(2, "0")), el("strong", "", row.ticker + " · " + row.company));
          const badges = el("div", "weekly-stock-badges"); badges.append(el("span", "weekly-stock-rating", row.rating === null ? "N/D" : U.formatNumber(row.rating, 1) + " / 5"));
          if (row.decision) badges.append(el("span", "weekly-stock-decision", row.decision));
          head.append(identity, badges);
          item.append(head, el("p", "", row.summary), el("p", "weekly-stock-central", row.central_label), el("p", "meta", "Risque : " + row.risk)); list.append(item);
        }
        card.append(list, el("p", "meta weekly-report-method", report.method_note));
      }
      const footer = el("div", "weekly-report-document");
      if (report.document_scope === "summary") footer.append(el("p", "meta", "Document : synthèse de l’édition."));
      const link = el("a", "button", report.document.label + " ↗"); link.href = report.document.path; link.target = "_blank"; link.rel = "noopener noreferrer";
      footer.append(link, el("span", "meta", "PDF · " + report.document.pages + " pages · " + Math.ceil(report.document.size_bytes / 1024) + " Ko"));
      card.append(footer); host.append(card);
    }
    document.getElementById("weeklyReportsStatus").textContent = W.KINDS.some(kind => data?.reports[kind]) ?
      (copy ? "Dernières éditions conservées sur cet appareil." : "Dernières éditions publiées · documents à ouvrir au bas de chaque résumé.") : "Les rapports sont indisponibles pour le moment.";
  }
  try {data = W.normalize(JSON.parse(localStorage.getItem(KEY))); copy = true; render();} catch { /* Read the published editions. */ }
  async function refresh() {
    if (pending) return pending;
    pending = (async () => {
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch("data/weekly-reports.json?v=" + Date.now(), {cache: "no-store", signal: controller.signal});
        if (!response.ok) throw new Error("Rapports indisponibles");
        const next = W.normalize(await response.json()); copy = false;
        if (data && U.parseTimestamp(next.generated_at) < U.parseTimestamp(data.generated_at)) {copy = true; return;}
        for (const kind of W.KINDS) if (data?.reports[kind] && (!next.reports[kind] || next.reports[kind].edition_date < data.reports[kind].edition_date)) {
          next.reports[kind] = data.reports[kind]; copy = true;
        }
        data = next;
        try {localStorage.setItem(KEY, JSON.stringify(data));} catch { /* Keep this session usable. */ }
      } catch {copy = true;}
      finally {clearTimeout(timeout); render();}
    })();
    try {await pending;} finally {pending = null;}
  }
  document.getElementById("refreshButton").addEventListener("click", refresh);
  document.addEventListener("visibilitychange", () => {if (document.visibilityState === "visible") refresh();});
  refresh();
})();
