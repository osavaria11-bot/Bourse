(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SavyPortalUtils = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const PAGES = {
    accueil: {label: "Accueil", tabs: {overview: "Vue d’ensemble", news: "Actualités & audio"}},
    marches: {label: "Marchés", tabs: {indices: "Indices", economy: "Économie", rates: "Taux & décisions", resources: "Ressources"}},
    portefeuilles: {label: "Portefeuilles", tabs: {overview: "Vue d’ensemble", positions: "Positions", allocations: "Allocations", performance: "Performance & risque", earnings: "Résultats", transactions: "Transactions"}},
    recherche: {label: "Recherche", tabs: {latest: "Recherche & suivi", archives: "Archives"}},
    immobilier: {label: "Immobilier", tabs: {latest: "Dernier briefing", archives: "Archives"}},
    polymarket: {label: "Polymarket", tabs: {overview: "Marchés suivis"}},
    analyses: {label: "Analyse FNB", tabs: {overview: "Les 11 portefeuilles"}},
    dashboard: {label: "Dashboard complet", navLabel: "Dashboard", tabs: {overview: "Tous les blocs"}},
  };
  const ALIASES = {portfolio: ["portefeuilles", "overview"], indicators: ["marches", "economy"], yieldCurves: ["marches", "rates"],
    weeklyReports: ["recherche", "latest"], fearGreed: ["accueil", "overview"], briefingCard: ["accueil", "news"]};
  function route(hash = "") {
    const value = hash.replace(/^#/, ""), params = new URLSearchParams(value);
    const alias = Object.hasOwn(ALIASES, value) ? ALIASES[value] : null;
    let page = alias?.[0] || params.get("view") || (Object.hasOwn(PAGES, value) ? value : null);
    if (!page && ["portfolio-key", "positions", "portfolio"].some(key => params.has(key))) page = "portefeuilles";
    if (!Object.hasOwn(PAGES, page)) page = "accueil";
    const tabs = PAGES[page].tabs, requested = alias?.[1] || params.get("tab");
    return {page, tab: Object.hasOwn(tabs, requested) ? requested : Object.keys(tabs)[0]};
  }
  function address(currentURL, page, tab) {
    const url = new URL(currentURL), before = new URLSearchParams(url.hash.slice(1)), next = new URLSearchParams();
    for (const key of ["portfolio-key", "portfolio", "positions"]) if (before.get(key)) next.set(key, before.get(key));
    const selected = route("view=" + page + "&tab=" + tab);
    next.set("view", selected.page); next.set("tab", selected.tab);
    url.hash = next.toString(); return url.href;
  }
  // Refreshing a personal link must never reset the active page or expose its key in a query string.
  function preserveRoute(personalURL, currentURL) {
    const selected = route(new URL(currentURL).hash);
    return address(personalURL, selected.page, selected.tab);
  }
  function archiveEntries(payload, kind) {
    if (payload?.schema_version !== 1 || !Array.isArray(payload.documents)) return [];
    const folder = kind === "real_estate" ? "real-estate" : kind === "stocks" ? "stocks" : null;
    if (!folder) return [];
    const seen = new Set();
    return payload.documents.filter(row => {
      if (!row || row.kind !== kind || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
          row.path !== "reports/" + folder + "/" + row.date + ".pdf" || seen.has(row.path)) return false;
      const date = new Date(row.date + "T00:00:00Z");
      if (!Number.isFinite(+date) || date.toISOString().slice(0, 10) !== row.date) return false;
      seen.add(row.path); return true;
    }).sort((a, b) => b.date.localeCompare(a.date));
  }
  return {PAGES, route, address, preserveRoute, archiveEntries};
});
