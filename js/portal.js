(() => {
  "use strict";
  const R = window.SavyPortalUtils, U = window.MacroUtils, $ = selector => document.querySelector(selector);
  const main = $("main"), pages = new Map(), panels = new Map();
  let active = R.route(location.hash), marketId = "SPX", allMarkets = false;
  let expanded = null, marketData = null;
  const icons = {
    accueil: '<path d="m3 10 9-7 9 7v11h-6v-8H9v8H3z"/>',
    marches: '<path d="M3 3v18h18M6 16l5-6 4 3 6-9"/>',
    portefeuilles: '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V3h8v4M3 12h18M10 12v3h4v-3"/>',
    recherche: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6M7 10h6M10 7v6"/>',
    immobilier: '<path d="M4 21V7l8-4v18M12 10h8v11M7 8v2m0 3v2m0 3v2m9-7v2m0 3v2M2 21h20"/>',
    polymarket: '<path d="M4 20V10h4v10m4 0V4h4v16m4 0v-7M2 20h20"/>',
    analyses: '<path d="M3 3v18h18"/><circle cx="8" cy="15" r="2"/><circle cx="13" cy="9" r="2"/><circle cx="19" cy="5" r="2"/>',
    dashboard: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  };
  function el(tag, className, text) {const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;}
  function link(label, page, tab, className = "portal-link") {
    const node = el("a", className, label); node.href = "#view=" + page + "&tab=" + (tab || Object.keys(R.PAGES[page].tabs)[0]); return node;
  }
  function move(selector, target) {const node = $(selector); if (node) target.append(node); return node;}
  function pane(page, tab) {return panels.get(page + "/" + tab);}
  function method(node, title = "Sources & méthode") {
    if (!node) return;
    const details = el("details", "portal-method"), summary = el("summary", "", title);
    node.before(details); details.append(summary, node); return details;
  }

  document.body.classList.add("savy-portal");
  const header = $(".page-header"); document.body.prepend(header);
  $(".brand .eyebrow").textContent = "VOTRE PERSPECTIVE FINANCIÈRE";
  $(".header-actions a[href='#portfolio']").remove();
  const nav = el("nav", "portal-nav"); nav.setAttribute("aria-label", "Navigation principale");
  const mobileLabels = {portefeuilles: "Portef.", recherche: "Rech.", immobilier: "Immo.", polymarket: "Polym.", analyses: "FNB", dashboard: "Tout"};
  for (const [id, config] of Object.entries(R.PAGES)) {
    const item = link("", id); item.dataset.page = id;
    const icon = el("span", "nav-icon"); icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + icons[id] + '</svg>';
    item.setAttribute("aria-label", config.label); item.title = config.label;
    item.append(icon, el("span", "nav-label", config.navLabel || config.label), el("span", "nav-label-mobile", mobileLabels[id] || config.label)); nav.append(item);
  }
  header.insertBefore(nav, $(".header-actions"));
  $(".intro-line").remove();
  for (const [id, config] of Object.entries(R.PAGES)) {
    const page = el("section", "portal-page"); page.id = "page-" + id; page.dataset.page = id;
    page.setAttribute("aria-label", config.label); page.hidden = true;
    const subnav = el("nav", "portal-tabs"); subnav.setAttribute("aria-label", config.label + " · rubriques");
    for (const [key, label] of Object.entries(config.tabs)) {
      const item = link(label, id, key); item.dataset.tab = key; subnav.append(item);
      const panel = el("div", "portal-panel"); panel.id = "panel-" + id + "-" + key; panel.hidden = true;
      panels.set(id + "/" + key, panel); page.append(panel);
    }
    if (Object.keys(config.tabs).length > 1) page.prepend(subnav);
    pages.set(id, page); main.append(page);
  }
  const home = pane("accueil", "overview");
  const heading = el("div", "portal-home-heading"), headingText = el("div");
  headingText.append(el("p", "eyebrow", "SAVY / LE POINT SUR LES MARCHÉS"), el("h2", "", "L’essentiel, en perspective."));
  const today = el("time", "meta", new Intl.DateTimeFormat("fr-CA", {timeZone: "America/Toronto", weekday: "long", day: "numeric", month: "long", year: "numeric"}).format(new Date()));
  heading.append(headingText, today); home.append(heading); move("#updated", home);
  const ticker = el("div", "portal-ticker"); ticker.id = "homeMarkets"; ticker.setAttribute("aria-label", "Dernières cotations des grands marchés");
  ticker.append(el("p", "meta", "Chargement des marchés…")); home.append(ticker);
  const editorial = el("div", "portal-editorial"), news = el("section", "portal-news");
  const newsHead = el("div", "portal-section-heading"); newsHead.append(el("h3", "", "À la une"), link("Lire / écouter ↗", "accueil", "news"));
  news.append(newsHead); const newsDate = el("p", "meta"); newsDate.id = "homeNewsDate"; news.append(newsDate);
  const newsList = el("div", "portal-headlines"); newsList.id = "homeNews"; newsList.append(el("p", "meta", "Chargement de l’édition…")); news.append(newsList);
  editorial.append(news); const right = el("div", "portal-editorial-side"); editorial.append(right); home.append(editorial);
  move("#fearGreed", right);
  const latest = el("section", "portal-latest"); latest.setAttribute("aria-label", "Dernières analyses");
  latest.append(el("h3", "", "Vos rendez-vous")); const latestGrid = el("div", "portal-latest-grid"); latestGrid.id = "homeReports";
  latestGrid.append(link("Sélection Finviz ↗", "recherche"), link("Briefing immobilier ↗", "immobilier")); latest.append(latestGrid); right.append(latest);
  const macroHeading = el("div", "portal-section-heading"); macroHeading.append(el("h3", "", "Repères économiques"), link("Tous les indicateurs ↗", "marches", "economy")); home.append(macroHeading);
  move("#kpis", home);

  // Move the original, live components. Their IDs, data and event handlers remain intact.
  move(".market-section", pane("marches", "indices"));
  move("#briefingCard", pane("accueil", "news"));
  move("#indicators", pane("marches", "economy"));
  $("#indicatorsTitle").textContent = "Les indicateurs économiques";
  $("#indicators .eyebrow").textContent = "ÉCONOMIE / DONNÉES & CYCLES";
  move(".policy-odds", pane("marches", "rates")); move("#yieldCurves", pane("marches", "rates"));
  const resources = move(".resources", pane("marches", "resources")); resources.open = true;
  const portfolio = move("#portfolio", pages.get("portefeuilles"));
  // Portfolio subpanels belong inside the existing component, so benchmark labels stay scoped to it.
  for (const tab of Object.keys(R.PAGES.portefeuilles.tabs)) portfolio.append(pane("portefeuilles", tab));
  const shared = $("#portfolioContent"), portfolioOverview = pane("portefeuilles", "overview");
  for (const selector of ["#portfolioBenchmark", "#portfolioBenchmarkNote", "#portfolioChart", ".portfolio-relative"]) move(selector, portfolioOverview);
  for (const selector of [".portfolio-positions-heading", "#portfolioPositions"]) move(selector, pane("portefeuilles", "positions"));
  move("#positionForm", pane("portefeuilles", "positions"));
  move("#portfolioHeatmap", pane("portefeuilles", "allocations"));
  const exposureActions = el("div", "portfolio-positions-heading");
  move("#portfolioSectorsToggle", exposureActions); move("#portfolioGeographyToggle", exposureActions);
  pane("portefeuilles", "allocations").append(exposureActions);
  for (const selector of ["#portfolioSectors", "#portfolioGeography"]) move(selector, pane("portefeuilles", "allocations"));
  $("#panel-portefeuilles-positions .portfolio-positions-heading .meta").textContent = "Positions, quantités et prix moyens enregistrés sur cet appareil.";
  for (const selector of ["#portfolioContributions", "#portfolioRisk", ".portfolio-movers"]) move(selector, pane("portefeuilles", "performance"));
  move("#portfolioEarnings", pane("portefeuilles", "earnings"));
  const transactions = pane("portefeuilles", "transactions");
  transactions.append(el("h3", "", "Historique des transactions"), el("p", "portal-empty", "Aucun journal de transactions n’est disponible dans les données actuelles. Les positions et leurs prix moyens restent accessibles dans l’onglet Positions. La performance historique est reconstituée avec les quantités actuelles, hors achats, ventes, dividendes, frais et espèces."));
  // Keep the edit form available when a portfolio is empty; only the data-dependent panels are gated.
  for (const tab of ["overview", "allocations", "performance", "earnings"]) shared.append(pane("portefeuilles", tab));
  const manage = link("Gérer mes positions ↗", "portefeuilles", "positions", "button quiet"); $("#portfolioEmpty").after(manage); manage.id = "portfolioManage";
  const methodology = $(".portfolio-method"), explanation = methodology.nextElementSibling;
  const portfolioMethod = method(methodology, "Méthode, données & confidentialité"); portfolioMethod.append(explanation); portfolio.append(portfolioMethod);
  move("#polymarket", pane("polymarket", "overview"));
  move("#weeklyReports", pane("recherche", "latest")); $("#weeklyReportsTitle").textContent = "La sélection Finviz";
  const property = el("section", "weekly-reports"); property.id = "propertyReport";
  property.append(el("p", "eyebrow", "IMMOBILIER / ÉDITION HEBDOMADAIRE"), el("h2", "", "Le briefing immobilier"));
  const propertyStatus = el("p", "meta"); propertyStatus.id = "propertyReportsStatus"; propertyStatus.setAttribute("role", "status"); property.append(propertyStatus);
  const propertyGrid = el("div", "weekly-reports-grid"); propertyGrid.id = "propertyReportsGrid"; property.append(propertyGrid); pane("immobilier", "latest").append(property);
  const research = pane("recherche", "latest"), plan = el("section", "research-plan"); plan.id = "researchPlan";
  const planHeading = el("div", "portal-section-heading"), planTitle = el("div");
  planTitle.append(el("p", "eyebrow", "RECHERCHE / FINVIZ"), el("h2", "", "Recherche & suivi"));
  planHeading.append(planTitle, el("span", "meta", "Deux rendez-vous · mêmes automatisations")); plan.append(planHeading);
  const schedule = el("div", "research-schedule");
  const nextResearch = new Date(); nextResearch.setUTCHours(22, 0, 0, 0);
  nextResearch.setUTCDate(nextResearch.getUTCDate() + (3 - nextResearch.getUTCDay() + 7) % 7);
  if (+nextResearch <= Date.now()) nextResearch.setUTCDate(nextResearch.getUTCDate() + 7);
  const researchTime = new Intl.DateTimeFormat("fr-CA", {timeZone:"America/Toronto",weekday:"long",hour:"numeric",minute:"2-digit"}).format(nextResearch).replace(/^./, letter => letter.toLocaleUpperCase("fr"));
  for (const [step, title, time, note, detail] of [
    ["1 · RECHERCHE", "Top 5 du screener Finviz", researchTime, "22 h UTC · horaire existant", "Admissibles, classement et instructions de rééquilibrage."],
    ["2 · SUIVI", "Suivi des portefeuilles Finviz", "Jeudi · 16 h 30", "Heure de Toronto · après clôture", "Valorisation, exécution des instructions publiées et comparaison à SPY."],
  ]) {
    const card = el("article", "research-schedule-card");
    card.append(el("span", "eyebrow", step), el("h3", "", title), el("strong", "research-time", time), el("span", "meta", note), el("p", "meta", detail)); schedule.append(card);
  }
  plan.append(schedule); research.prepend(plan);
  const strategies = el("details", "portal-method research-rules"); strategies.id = "researchStrategies";
  strategies.append(el("summary", "", "Règles des deux portefeuilles simulés"));
  const strategyList = el("div", "portal-strategies");
  for (const [title, allocation, rule] of [["Top 5 pondéré", "30 % · 25 % · 20 % · 15 % · 10 %", "Pondération selon le classement hebdomadaire."], ["Autres titres admissibles", "Équipondération", "Répartition égale entre les autres titres de la sélection."]]) {
    const article = el("article"); article.append(el("h3", "", title), el("strong", "", allocation), el("p", "meta", rule)); strategyList.append(article);
  }
  strategies.append(strategyList, el("p", "meta", "Rééquilibrage simulé à la clôture du jeudi avec le dernier classement publié avant la séance. Base initiale : 10 000 USD par portefeuille au 30 septembre 2026. Le suivi automatisé conserve son état et son classeur existants; aucun historique de valorisation n’est encore publié sur ce site."));
  plan.append(strategies);
  for (const [page, kind] of [["recherche", "stocks"], ["immobilier", "real_estate"]]) {
    const panel = pane(page, "archives"); panel.append(el("h2", "", "Les éditions précédentes"));
    const list = el("div", "portal-archives"); list.dataset.archiveKind = kind; list.append(el("p", "meta", "Chargement des documents publiés…")); panel.append(list);
  }
  main.append($("footer"));
  $("footer p").textContent = "SAVY · Votre portail financier";
  method($(".market-section > p:last-child"), "Comprendre les cours et les périodes");

  const fundAnalysis = pane("analyses", "overview"), fundHeading = el("div", "portal-section-heading"), fundTitle = el("div");
  fundTitle.append(el("h2", "", "Portefeuilles FNB"));
  const fundFullScreen = el("a", "button quiet", "Ouvrir en plein écran ↗");
  const fundReportUrl = () => "reports/portefeuilles-fnb.html?v=20261019-performance&month=" + new Intl.DateTimeFormat("fr-CA",{timeZone:"America/Toronto",year:"numeric",month:"2-digit"}).format(new Date());
  fundFullScreen.href = fundReportUrl(); fundFullScreen.target = "_blank"; fundFullScreen.rel = "noopener noreferrer";
  fundHeading.append(fundTitle, fundFullScreen);
  const fundFrame = el("iframe", "portal-report-frame"); fundFrame.id = "fundAnalysisFrame";
  fundFrame.title = "Analyse des 11 portefeuilles FNB : ratios, boussole et évolution des placements";
  function syncReportTheme() {
    const root = fundFrame.contentDocument?.documentElement;
    if (root) {root.classList.add("in-dashboard"); root.dataset.theme = document.documentElement.dataset.theme;}
  }
  fundFrame.addEventListener("load", syncReportTheme);
  new MutationObserver(syncReportTheme).observe(document.documentElement, {attributes: true, attributeFilter: ["data-theme"]});
  fundAnalysis.append(fundHeading, fundFrame);

  const dashboard = pane("dashboard", "overview"), dashboardMoves = [];
  dashboard.append(el("p", "eyebrow", "SAVY / VUE INTÉGRALE"), el("h2", "", "Dashboard complet"),
    el("p", "meta dashboard-intro", "Tous les graphiques, portefeuilles et dernières analyses sur une seule page, comme dans la vue d’origine."));
  function syncDashboard(show) {
    if (show && !dashboardMoves.length) {
      for (const selector of ["#updated", "#kpis", "#fearGreed", ".policy-odds", "#briefingCard", ".market-section", "#portfolio", "#yieldCurves", "#indicators", ".resources", "#polymarket", "#propertyReport", "#weeklyReports"]) {
        const node = $(selector); if (!node) continue;
        const marker = document.createComment("Dashboard component returns here"); node.before(marker);
        dashboardMoves.push({node, marker}); dashboard.append(node);
      }
    } else if (!show && dashboardMoves.length) {
      for (const {node, marker} of dashboardMoves.splice(0).reverse()) marker.replaceWith(node);
    }
  }

  const marketTools = el("div", "portal-chart-tools");
  const marketLabel = el("label", "", "Marché"), marketSelect = el("select"); marketSelect.id = "marketSelect"; marketLabel.append(marketSelect);
  const marketAll = el("button", "button quiet", "Voir tous les indices"); marketAll.type = "button"; marketAll.id = "marketShowAll"; marketAll.setAttribute("aria-pressed", "false");
  marketAll.addEventListener("click", () => {allMarkets = !allMarkets; syncMarkets(); window.dispatchEvent(new Event("resize"));});
  marketTools.append(marketLabel, marketAll); const marketExpand = el("button", "button quiet", "Agrandir ↗"); marketExpand.type = "button"; marketExpand.id = "marketExpand"; marketTools.append(marketExpand);
  $("#marketGrid").before(marketTools);
  const marketLayout = el("div", "portal-market-layout"); $("#marketGrid").before(marketLayout);
  const watchlist = el("div", "portal-market-watchlist"); watchlist.id = "marketWatchlist"; watchlist.setAttribute("aria-label", "Choisir un marché"); marketLayout.append(watchlist, $("#marketGrid"));
  marketSelect.addEventListener("change", () => selectMarket(marketSelect.value));
  const portfolioExpand = el("button", "button quiet", "Agrandir ↗"); portfolioExpand.type = "button"; portfolioExpand.id = "portfolioExpand"; $(".portfolio-period-controls").append(portfolioExpand);

  const dialog = el("dialog", "portal-expand"); dialog.id = "expandDialog"; dialog.setAttribute("aria-labelledby", "expandTitle");
  const dialogHead = el("div", "dialog-header"), dialogTitle = el("h2"); dialogTitle.id = "expandTitle";
  const close = el("button", "button quiet", "Fermer ×"); close.type = "button"; close.id = "closeExpand"; dialogHead.append(dialogTitle, close);
  const dialogBody = el("div", "portal-expand-body"); dialog.append(dialogHead, dialogBody); document.body.append(dialog);
  function expand(node, title, trigger) {
    if (expanded) {dialog.close(); restoreExpanded();}
    const marker = document.createComment("Expanded component returns here"); node.before(marker);
    expanded = {node, marker, trigger}; dialogTitle.textContent = title; dialogBody.append(node); dialog.showModal(); window.dispatchEvent(new Event("resize"));
  }
  close.addEventListener("click", () => dialog.close());
  function restoreExpanded() {if (expanded) {const {node, marker, trigger} = expanded; marker.replaceWith(node); expanded = null; window.dispatchEvent(new Event("resize")); trigger.focus();}}
  dialog.addEventListener("close", restoreExpanded);
  marketExpand.addEventListener("click", () => expand($(".market-section"), "Marchés · graphique détaillé", marketExpand));
  portfolioExpand.addEventListener("click", () => expand(shared, "Portefeuille · vue détaillée", portfolioExpand));

  function syncIndicators() {
    for (const card of $("#grid").children) card.hidden = false;
    $("#grid").classList.add("portal-compare", "portal-macro-all");
  }
  function selectMarket(id) {marketId = id; allMarkets = false; syncMarkets();}
  function syncMarkets() {
    const dashboard = active.page === "dashboard", all = dashboard || allMarkets;
    marketTools.hidden = dashboard; watchlist.hidden = all; marketLabel.hidden = all;
    marketLayout.classList.toggle("portal-all-markets", all);
    marketAll.setAttribute("aria-pressed", String(allMarkets)); marketAll.textContent = allMarkets ? "Revenir à la sélection" : "Voir tous les indices";
    const cards = [...$("#marketGrid").children]; marketSelect.replaceChildren(); watchlist.replaceChildren();
    for (const card of cards) {
      const id = card.dataset.id, title = card.querySelector("h4").textContent;
      const option = el("option", "", title); option.value = id; marketSelect.append(option); card.hidden = !all && id !== marketId;
      const row = el("button", "portal-watch-row"); row.type = "button"; row.dataset.market = id; row.setAttribute("aria-pressed", String(id === marketId));
      row.append(el("strong", "", title), el("span", "", card.querySelector(".market-value").textContent), el("span", card.querySelector(".market-return").className, card.querySelector(".market-return").textContent));
      row.addEventListener("click", () => selectMarket(id)); watchlist.append(row);
    }
    marketSelect.value = marketId;
  }
  function homeMarkets(data) {
    marketData = data || marketData; if (!marketData) {ticker.textContent = "Cotations indisponibles · consulter Marchés pour les sources et les périodes disponibles."; return;}
    ticker.replaceChildren();
    for (const original of marketData.series) {
      const point = window.SavyLiveQuotes?.marketPoint(original) || original;
      const session = window.SavyLiveQuotes?.marketSession(original);
      const period = session?.available ? session : U.marketPeriod(point, "1D");
      const item = link("", "marches", "indices", "portal-ticker-item"); item.dataset.market = original.id;
      const stamp = point.current_quote?.timestamp || point.date;
      item.title = point.current_quote ? window.IntradayUtils.label(point.current_quote) : "Clôture du " + (point.date || "date indisponible");
      item.append(el("span", "", original.title.replace("Indice ", "")), el("strong", "", U.formatNumber(point.value, 2) + (["EEM", "FEQT"].includes(original.id) ? " " + point.unit : "")),
        el("span", "change " + (period.percent > 0 ? "up" : period.percent < 0 ? "down" : "flat"), U.validNumber(period.percent) ? (period.percent > 0 ? "+" : "") + U.formatNumber(period.percent, 2) + " %" : "Variation indisponible"), el("small", "meta", stamp ? String(stamp).slice(0, 10) : "Indisponible"));
      ticker.append(item);
    }
  }
  function homeBriefing(briefing, cached) {
    newsList.replaceChildren();
    newsDate.textContent = briefing ? "Édition du " + U.observationLabel(briefing.edition_date) + (cached ? " · copie conservée" : "") : "Édition indisponible";
    if (!briefing) {newsList.append(el("p", "meta", "Aucune nouvelle vérifiée disponible. Réessaie avec Actualiser.")); return;}
    for (const [index, story] of briefing.stories.slice(0, 3).entries()) {
      const item = link("", "accueil", "news", "portal-headline"); item.dataset.story = index;
      item.append(el("span", "eyebrow", story.topic), el("h4", "", story.title));
      if (index === 0) item.append(el("p", "", story.summary));
      item.append(el("span", "meta", story.source_label + " · " + story.published_date)); newsList.append(item);
    }
  }
  function homeReports(data, cached) {
    latestGrid.replaceChildren();
    for (const [kind, page, label] of [["stocks", "recherche", "SÉLECTION FINVIZ"], ["real_estate", "immobilier", "IMMOBILIER"]]) {
      const report = data?.reports[kind], item = link("", page, "latest", "portal-report-link");
      item.append(el("span", "eyebrow", label), el("strong", "", report ? kind === "stocks" ? report.stocks.length + " titres à l’étude" : "Dernier briefing" : "Édition indisponible"), el("span", "meta", report ? U.observationLabel(report.edition_date) + (cached ? " · copie conservée" : "") : "Source en attente")); latestGrid.append(item);
    }
  }
  async function archives() {
    let data;
    try {const response = await fetch("data/report-archive.json?v=" + Date.now(), {cache: "no-store", signal: AbortSignal.timeout(12000)}); if (!response.ok) throw new Error(); data = await response.json();} catch { /* Explicit empty state; never invent previous reports. */ }
    for (const host of document.querySelectorAll("[data-archive-kind]")) {
      host.replaceChildren(); const rows = R.archiveEntries(data, host.dataset.archiveKind);
      for (const row of rows) {
        const item = el("a", "portal-archive-row"); item.href = row.path; item.target = "_blank"; item.rel = "noopener noreferrer";
        item.append(el("strong", "", "Édition du " + U.observationLabel(row.date)), el("span", "meta", "Ouvrir le PDF ↗")); host.append(item);
      }
      if (!rows.length) host.append(el("p", "portal-empty", "Aucune archive publiée disponible pour le moment."));
    }
  }
  function applyRoute(focus = false) {
    active = R.route(location.hash); if (dialog.open) {dialog.close(); restoreExpanded();}
    const all = active.page === "dashboard"; syncDashboard(all);
    for (const [id, page] of pages) page.hidden = active.page !== id;
    for (const [id, panel] of panels) panel.hidden = !(all && id.startsWith("portefeuilles/")) && id !== active.page + "/" + active.tab;
    for (const item of nav.children) {if (item.dataset.page === active.page) item.setAttribute("aria-current", "page"); else item.removeAttribute("aria-current");}
    for (const item of document.querySelectorAll(".portal-tabs a")) {if (item.dataset.tab === active.tab && item.closest(".portal-page").dataset.page === active.page) item.setAttribute("aria-current", "page"); else item.removeAttribute("aria-current");}
    document.title = "SAVY · " + R.PAGES[active.page].label;
    document.body.dataset.page = active.page;
    if (active.page === "analyses") {const url=fundReportUrl();fundFullScreen.href=url;if(fundFrame.getAttribute("src")!==url)fundFrame.src=url;}
    $("#portfolioManage").hidden = all || active.tab === "positions";
    syncIndicators(); syncMarkets();
    window.scrollTo({top: 0, behavior: "instant"}); window.dispatchEvent(new Event("resize"));
    if (focus) {const panel = pane(active.page, active.tab); panel.tabIndex = -1; panel.focus({preventScroll: true});}
    document.dispatchEvent(new CustomEvent("savy:navigate", {detail: {...active}}));
  }
  function navigate(page, tab, focus = false) {
    const url = R.address(location.href, page, tab || Object.keys(R.PAGES[page].tabs)[0]);
    if (url !== location.href) history.pushState(null, "", url); applyRoute(focus);
  }
  document.addEventListener("click", event => {
    const anchor = event.target.closest?.("a[href^='#']"); if (!anchor || event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const hash = anchor.getAttribute("href"), route = R.route(hash);
    if (!hash.startsWith("#view=") && !["#portfolio", "#indicators", "#yieldCurves", "#weeklyReports", "#fearGreed", "#briefingCard", "#polymarket"].includes(hash)) return;
    event.preventDefault(); if (anchor.dataset.market) selectMarket(anchor.dataset.market);
    navigate(route.page, route.tab, event.detail === 0);
    if (anchor.dataset.story) {
      $("#briefingCard").open = true;
      $("#briefingParagraph").children[Number(anchor.dataset.story)]?.scrollIntoView({block: "start"});
    }
  });
  window.addEventListener("hashchange", () => applyRoute()); window.addEventListener("popstate", () => applyRoute());
  document.addEventListener("savy:quotes", () => homeMarkets());
  $("#refreshButton").addEventListener("click", archives);
  window.SavyPortal = {navigate, syncIndicators, syncMarkets, homeMarkets, homeBriefing, homeReports, preserveRoute: url => R.preserveRoute(url, location.href)};
  applyRoute(); archives();
})();
