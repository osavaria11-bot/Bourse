(() => {
  "use strict";
  const P = window.PortfolioUtils, U = window.MacroUtils, A = window.PortfolioProfileUtils, E = window.PortfolioExposureUtils, F = window.PortfolioAnalyticsUtils, H = window.PortfolioHeatmapUtils, $ = selector => document.querySelector(selector);
  const HOLDINGS_KEY = "savy:private-holdings:v1", PRICE_KEY = "savy:security-prices:v1", POSITIONS_VISIBLE_KEY = "savy:portfolio-positions-visible:v1";
  const PROFILE_STATE_KEY = "savy:portfolio-profile-state:v1", PROFILE_CACHE_KEY = "savy:portfolio-profile-cache:v1";
  const ACCESS_KEY = "savy:portfolio-access:v1";
  const EXPOSURE_KEY = "savy:portfolio-exposures:v1", EXPOSURE_VIEWS_KEY = "savy:portfolio-exposure-views:v1";
  const EARNINGS_KEY = "savy:portfolio-earnings:v1";
  const ACTIVE_KEY = "savy:portfolio-active:v1", VIEW_KEY = "savy:portfolio-view:v1";
  const portfolioIds = ["1", "2", "3"];
  const portfolioBenchmarks = {"1": "FEQT", "2": "VBAL", "3": "VGRO"};
  const portfolioNames = {"1": "OS", "2": "JMC", "3": "MCL"};
  const chartRanges = [{key: "INTRADAY", label: "Intraday"}, ...P.RANGES];
  const scopedKeys = new Set([HOLDINGS_KEY, POSITIONS_VISIBLE_KEY, PROFILE_STATE_KEY, PROFILE_CACHE_KEY, EXPOSURE_VIEWS_KEY, VIEW_KEY]);
  const initialFragment = new URLSearchParams(location.hash.slice(1));
  let activePortfolio = "1";
  const selectedPortfolio = initialFragment.get("portfolio") || stored(ACTIVE_KEY, "1");
  activePortfolio = portfolioIds.includes(selectedPortfolio) ? selectedPortfolio : "1";
  let benchmarkId = portfolioBenchmarks[activePortfolio];
  let catalog = null, prices = null, cached = false, range = "INTRADAY", moversRange = "1M", positions = [], history = [], imported = false;
  let exposures = null, exposureCached = false;
  let relativeComparison = null;
  let heatmapRange = "1D", heatmapTicker = "", heatmapModel = null;
  let earnings = null, earningsCached = false, earningsTicker = "", earningsWeek = F.weekFor().start, earningsSelection = null;
  const exposureViewState = stored(EXPOSURE_VIEWS_KEY, {});
  const exposureViews = {Sectors: exposureViewState?.Sectors === true, Geography: exposureViewState?.Geography === true};
  let profileState = stored(PROFILE_STATE_KEY, null), profileInitialized = false, holdingsAvailable = false, manifestURL = null;
  const personalKey = initialFragment.get("portfolio-key") || [rawStored(ACCESS_KEY, null)?.key, profileState?.key,
    rawStored(PROFILE_STATE_KEY, null)?.key, rawStored(PROFILE_STATE_KEY + ":2", null)?.key,
    rawStored(PROFILE_STATE_KEY + ":3", null)?.key].find(key => A.validKey(key));
  let positionsVisible = stored(POSITIONS_VISIBLE_KEY, false) === true, sortKey = null, sortDescending = true;
  const importFragment = new URLSearchParams(location.hash.slice(1)).get("positions");
  function scopedKey(key) {return activePortfolio !== "1" && scopedKeys.has(key) ? key + ":" + activePortfolio : key;}
  function rawStored(key, fallback) {try {return JSON.parse(localStorage.getItem(key)) ?? fallback;} catch {return fallback;}}
  function stored(key, fallback) {return rawStored(scopedKey(key), fallback);}
  function save(key, value) {try {localStorage.setItem(scopedKey(key), JSON.stringify(value)); return true;} catch {return false;}}
  const referenceLabels = [];
  const labelWalker = document.createTreeWalker($("#portfolio"), NodeFilter.SHOW_TEXT);
  while (labelWalker.nextNode()) if (labelWalker.currentNode.nodeValue.includes("FEQT") && !labelWalker.currentNode.parentElement.closest("[data-portfolio-id], #panel-portefeuilles-analysis")) referenceLabels.push({node: labelWalker.currentNode, template: labelWalker.currentNode.nodeValue});
  function renderPortfolioChoice() {
    $("#portfolioTitle").textContent = "Portefeuille " + portfolioNames[activePortfolio];
    $("#portfolio").dataset.portfolio = activePortfolio;
    for (const button of document.querySelectorAll("[data-portfolio-id]")) button.setAttribute("aria-pressed", String(button.dataset.portfolioId === activePortfolio));
    for (const label of referenceLabels) label.node.nodeValue = label.template.replaceAll("FEQT", benchmarkId);
    $("#portfolioBenchmark").setAttribute("aria-label", "Rendement du portefeuille et de " + benchmarkId);
  }
  function saveView() {save(VIEW_KEY, {range, moversRange, sortKey, sortDescending, earningsWeek, earningsTicker, heatmapRange});}
  function loadView() {
    const view = stored(VIEW_KEY, {});
    // Every portfolio opens on its session chart, including when this
    // browser remembers a previously selected historical period.
    range = "INTRADAY";
    heatmapRange = H.RANGES.some(item => item.key === view.heatmapRange) ? view.heatmapRange : "1D";
    heatmapTicker = "";
    moversRange = P.RANGES.some(item => item.key === view.moversRange) ? view.moversRange : "1M";
    sortKey = ["unrealized_percent", "unrealized_cad", "period_change_cad"].includes(view.sortKey) ? view.sortKey : null;
    sortDescending = view.sortDescending !== false;
    earningsWeek = typeof view.earningsWeek === "string" && U.isDate(view.earningsWeek) ? F.weekFor(view.earningsWeek).start : F.weekFor().start;
    earningsTicker = typeof view.earningsTicker === "string" ? view.earningsTicker : "";
    for (const button of $("#portfolioMoversRanges").querySelectorAll("button")) button.setAttribute("aria-pressed", String(button.dataset.range === moversRange));
  }
  async function choosePortfolio(id) {
    if (!portfolioIds.includes(id) || id === activePortfolio || !catalog) return;
    saveView(); activePortfolio = id; benchmarkId = portfolioBenchmarks[id]; save(ACTIVE_KEY, id);
    profileState = stored(PROFILE_STATE_KEY, null); profileInitialized = false;
    positionsVisible = stored(POSITIONS_VISIBLE_KEY, false) === true;
    const views = stored(EXPOSURE_VIEWS_KEY, {}); exposureViews.Sectors = views.Sectors === true; exposureViews.Geography = views.Geography === true;
    loadView(); setupPositions(); history = prices ? P.historyFor(positions, prices) : [];
    $("#portfolioMessage").textContent = ""; render();
    if (personalKey) await refreshPersonalProfile();
    else {const fragment = new URLSearchParams(); if (id !== "1") fragment.set("portfolio", id); const url = new URL(location.pathname + location.search + (fragment.size ? "#" + fragment : "#portfolio"), location.origin); window.history.replaceState(null, "", window.SavyPortal?.preserveRoute(url.href) || url.href);}
  }
  function el(tag, className, text) {const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;}
  function money(value, currency = "CAD") {return U.validNumber(value) ? new Intl.NumberFormat("fr-CA", {style: "currency", currency, maximumFractionDigits: 2}).format(value) : "—";}
  function delta(value, percent = false) {return U.validNumber(value) ? (value > 0 ? "+" : "") + (percent ? U.formatNumber(value, 2) + " %" : money(value)) : "—";}
  function direction(value) {return value > 0 ? "up" : value < 0 ? "down" : "flat";}
  async function fetchJSON(file) {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
    try {const response = await fetch(file + "?v=" + Date.now(), {cache: "no-store", signal: controller.signal}); if (!response.ok) throw new Error("Cotations indisponibles"); return await response.json();}
    finally {clearTimeout(timeout);}
  }
  function applyPositions(input) {
    if (input?.portfolio_id && input.portfolio_id !== activePortfolio) throw new Error("Choisis le portefeuille " + (portfolioNames[input.portfolio_id] || input.portfolio_id) + " avant d’importer ce fichier");
    const next = P.normalizePositions(input, catalog);
    positions = next;
    holdingsAvailable = true;
    $("#portfolioMessage").textContent = save(HOLDINGS_KEY, {schema_version: 1, base_currency: "CAD", positions}) ?
      positions.length + " positions enregistrées uniquement dans ce navigateur." : "Positions disponibles pour cette session. Exporte une sauvegarde pour les conserver.";
    history = prices ? P.historyFor(positions, prices) : [];
    render();
  }
  function setupPositions() {
    const saved = stored(HOLDINGS_KEY, null);
    try {positions = P.normalizePositions(saved || {positions: []}, catalog); holdingsAvailable = saved !== null;} catch {positions = []; holdingsAvailable = false;}
    const options = document.createDocumentFragment();
    for (const security of catalog.series) {const option = el("option", "", security.id + " · " + security.title + " · " + security.currency); option.value = security.id; options.append(option);}
    $("#positionTicker").replaceChildren(options);
    if (importFragment && !imported) {
      imported = true;
      try {
        if (importFragment.length > 12000) throw new Error("Import trop volumineux");
        const base64 = importFragment.replaceAll("-", "+").replaceAll("_", "/");
        const text = new TextDecoder().decode(Uint8Array.from(atob(base64 + "=".repeat((4 - base64.length % 4) % 4)), c => c.charCodeAt(0)));
        applyPositions(JSON.parse(text));
      } catch (error) {$("#portfolioMessage").textContent = "Import impossible : " + error.message;}
      // Private quantities are removed from the address after local import.
      window.history.replaceState(null, "", location.pathname + location.search + "#portfolio");
      requestAnimationFrame(() => $("#portfolio").scrollIntoView());
    }
  }
  function configurePersonalLink() {
    const url = A.personalURL(location.href, personalKey, activePortfolio);
    const anchor = $("#portfolioPersonalLink"); anchor.href = url; anchor.hidden = false;
    // Keep the personal fragment so a new Home Screen storage context can open it.
    window.history.replaceState(null, "", window.SavyPortal?.preserveRoute(url) || url);
    if (manifestURL) URL.revokeObjectURL(manifestURL);
    manifestURL = URL.createObjectURL(new Blob([JSON.stringify(A.homeManifest(url, personalKey, activePortfolio))], {type: "application/manifest+json"}));
    let manifest = $("#savyPersonalManifest");
    if (!manifest) {manifest = el("link"); manifest.rel = "manifest"; manifest.id = "savyPersonalManifest"; document.head.append(manifest);}
    manifest.href = manifestURL;
  }
  async function refreshPersonalProfile() {
    if (!personalKey || importFragment) return;
    const requestedPortfolio = activePortfolio;
    try {
      if (!A.validKey(personalKey)) throw new Error("Lien personnel invalide");
      let profile;
      try {profile = await fetchJSON(requestedPortfolio === "1" ? "data/personal-portfolio.json" : "data/personal-portfolio-" + requestedPortfolio + ".json");}
      catch {if (requestedPortfolio !== activePortfolio) return; profile = stored(PROFILE_CACHE_KEY, null);}
      // Authentication also binds the revision; unverified data never replaces holdings.
      const unlocked = await A.unlock(profile, personalKey);
      if ((profile.portfolio_id || "1") !== requestedPortfolio || (unlocked.portfolio_id && unlocked.portfolio_id !== requestedPortfolio)) throw new Error("Le profil appartient à un autre portefeuille");
      const loaded = P.normalizePositions(unlocked, catalog);
      if (requestedPortfolio !== activePortfolio) return;
      if (!holdingsAvailable || profileState?.key !== personalKey || profileState?.revision !== profile.revision) {
        applyPositions(loaded);
        $("#portfolioMessage").textContent = loaded.length + " positions chargées automatiquement dans le portefeuille " + portfolioNames[requestedPortfolio] + ". Ton lien personnel fonctionne aussi depuis l’écran d’accueil.";
      }
      profileState = {key: personalKey, revision: profile.revision};
      save(ACCESS_KEY, {key: personalKey});
      save(PROFILE_STATE_KEY, profileState); save(PROFILE_CACHE_KEY, profile);
      profileInitialized = true; configurePersonalLink();
    } catch (error) {if (requestedPortfolio === activePortfolio) $("#portfolioMessage").textContent = "Lien personnel indisponible : " + error.message + ". Les positions déjà enregistrées sont conservées.";}
  }
  function renderPositionsVisibility() {
    $("#portfolioPositions").hidden = !positionsVisible;
    $("#portfolioPositionsToggle").setAttribute("aria-expanded", String(positionsVisible));
    $("#portfolioPositionsToggle").textContent = (positionsVisible ? "Masquer" : "Afficher") + " mes positions (" + positions.length + ")";
  }
  function renderExposureVisibility() {
    for (const view of ["Sectors", "Geography"]) {
      $("#portfolio" + view).hidden = exposureViews?.[view] !== true;
      $("#portfolio" + view + "Toggle").setAttribute("aria-expanded", String(exposureViews?.[view] === true));
    }
  }
  function renderExposures(current) {
    for (const [view, axis] of [["Sectors", "sectors"], ["Geography", "geography"]]) {
      const result = E.compare(current, exposures, axis, benchmarkId), table = document.createDocumentFragment(), sources = document.createDocumentFragment();
      const status = $("#portfolio" + view + "Status");
      status.textContent = !exposures ? "Les répartitions n’ont pas pu être chargées. Utilise « Actualiser »." : !result.available ?
        "Une cotation et un taux de change complets sont nécessaires pour calculer les pondérations." :
        "Valeurs au " + current.date + (" · FEQT au ".replaceAll("FEQT", benchmarkId)) + result.benchmark_date + " · FNB décomposés en placements sous-jacents" +
        (exposureCached ? " · répartitions conservées" : "") + (result.indicative ? " · comparaison indicative : dates sous-jacentes distinctes pour QQC" : "") + (result.coverage < 99.995 ? " · " + U.formatNumber(100 - result.coverage, 2) + " % non classé" : "");
      status.classList.toggle("warning", !result.available || exposureCached || result.coverage < 99.995);
      if (result.available) {
        for (const row of result.rows) {
          const tr = el("tr"); tr.dataset.exposure = row.id;
          const name = el("th", "", row.label); name.scope = "row"; tr.append(name);
          for (const [value, className] of [[row.portfolio, ""], [row.benchmark, "feqt"]]) {
            const cell = el("td", "", U.validNumber(value) ? (className === "" && row.portfolio_undisclosed ? "≥ " : "") + U.formatNumber(value, 2) + " %" : "Non publié");
            if (U.validNumber(value)) {const track = el("span", "exposure-weight " + className), fill = el("span"); fill.style.width = Math.max(0, Math.min(100, value)) + "%"; track.setAttribute("aria-hidden", "true"); track.append(fill); cell.append(track);}
            tr.append(cell);
          }
          tr.append(el("td", "exposure-difference", U.validNumber(row.difference) ? (result.indicative ? "≈ " : "") + (row.difference > 0 ? "+" : "") + U.formatNumber(row.difference, 2) + " pt" : "—"));
          table.append(tr);
        }
        const note = el("p", "", ("Un écart positif indique une pondération plus élevée que FEQT. « Autres pays » regroupe les pays non détaillés par l’émetteur; leur poids individuel et leur écart ne sont pas disponibles. ≥ indique un poids minimal connu; aucun écart exact n’est calculé quand la répartition manque. Les actifs non classés restent visibles.".replaceAll("FEQT", benchmarkId))); sources.append(note);
        for (const source of [{id: ("FEQT · référence".replaceAll("FEQT", benchmarkId)), as_of: result.benchmark_date, source_url: result.benchmark_source, note: result.benchmark_note}, ...result.sources]) {
          const paragraph = el("p"), link = el("a", "", source.id + " ↗"); link.href = source.source_url; link.target = "_blank"; link.rel = "noopener noreferrer";
          paragraph.append(link, document.createTextNode(" · " + source.as_of + (source.note ? " · " + source.note : ""))); sources.append(paragraph);
          for (const [url, label] of [[source.underlying_source_url, "Placements sous-jacents ↗"], [source.classification_source_url, "Classification GICS ↗"], [source.classification_secondary_source_url, "Activité de l’émetteur ↗"]]) if (url) {const extra = el("a", "", label); extra.href = url; extra.target = "_blank"; extra.rel = "noopener noreferrer"; paragraph.append(document.createTextNode(" · "), extra);}
        }
        if (result.missing.length) sources.append(el("p", "", "Répartition manquante : " + result.missing.join(", ") + "."));
      }
      $("#portfolio" + view + "Rows").replaceChildren(table); $("#portfolio" + view + "Sources").replaceChildren(sources);
    }
  }
  function renderBenchmark(comparison) {
    const legend = document.createDocumentFragment();
    for (const [label, value, className] of [[portfolioNames[activePortfolio], comparison.portfolio_percent, ""], [benchmarkId, comparison.benchmark_percent, "feqt"]]) {
      const item = el("span", "portfolio-benchmark-item"), swatch = el("span", "portfolio-swatch " + className); swatch.setAttribute("aria-hidden", "true");
      item.append(swatch, el("span", "", label + " : "), el("strong", "", delta(value, true))); legend.append(item);
    }
    legend.append(el("span", "meta", "Écart : " + (U.validNumber(comparison.difference) ? (comparison.difference > 0 ? "+" : "") + U.formatNumber(comparison.difference, 2) + " pt" : "—")));
    $("#portfolioBenchmark").replaceChildren(legend);
    $("#portfolioBenchmarkNote").textContent = (comparison.normalized ? "Rendement en % · même base au " + comparison.start : "Valorisation en CAD · base de rendement manquante") +
      " · clôtures en CAD, hors dividendes · positions actuelles reconstituées" + (comparison.available ?
        (comparison.benchmark_start !== comparison.start || comparison.benchmark_end !== comparison.end ? (" · FEQT : derniers cours disponibles du ".replaceAll("FEQT", benchmarkId)) + comparison.benchmark_start + " au " + comparison.benchmark_end : "") :
        (" · comparaison FEQT indisponible : historique ou base manquants pour cette période".replaceAll("FEQT", benchmarkId)));
  }
  function renderMovers(day, quoteData = prices) {
    const heading = {"1D": "sur une séance", "1Y": "sur un an", "2Y": "sur deux ans", "5Y": "sur cinq ans", YTD: "depuis le début de l’année", "6M": "sur six mois", "3M": "sur trois mois", "1M": "sur un mois", "1W": "sur une semaine", "3D": "sur trois jours"}[moversRange];
    $("#portfolioMoversTitle").textContent = "Les meilleures et les pires performances " + heading;
    const performance = P.performanceFor(positions, quoteData, day, moversRange);
    const periodLabel = {"1D": "1 séance", "1Y": "1 an glissant", "2Y": "2 ans glissants", "5Y": "5 ans glissants", YTD: "YTD", "6M": "6 mois glissants", "3M": "3 mois glissants", "1M": "1 mois glissant", "1W": "5 séances", "3D": "3 séances"}[moversRange];
    $("#portfolioMoversPeriod").textContent = (performance.start ? "Du " + performance.start + " au " + performance.end : "Base de comparaison indisponible") + " · " + periodLabel + " · rendement en CAD, change inclus";
    const best = performance.rows.slice(0, 3), bestTickers = new Set(best.map(row => row.ticker));
    const worst = performance.rows.filter(row => !bestTickers.has(row.ticker)).slice(-3).reverse();
    for (const [selector, entries] of [["#portfolioBest", best], ["#portfolioWorst", worst]]) {
      const list = document.createDocumentFragment();
      for (const row of entries) {
        const item = el("li"); item.dataset.ticker = row.ticker;
        const name = el("span", "portfolio-mover-name"); name.append(el("strong", "", row.title), el("span", "portfolio-ticker", row.ticker + " · " + row.currency));
        const value = el("span", "change " + direction(row.percent), delta(row.percent, true));
        item.title = "Clôtures du " + row.start_price_date + " et du " + row.price_date + " · variation de la position : " + delta(row.change_cad);
        item.append(name, value); list.append(item);
      }
      if (!entries.length) list.append(el("li", "meta", performance.rows.length ? "Pas assez de titres pour compléter les deux listes." : "Historique indisponible pour cette période."));
      $(selector).replaceChildren(list);
    }
    $("#portfolioMoversNote").textContent = "Recalculé à chaque mise à jour quotidienne des cours, indépendamment de la période du graphique · " + performance.rows.length + "/" + positions.length + " titres comparables · hors dividendes" +
      (performance.missing.length ? " · historique ou change manquant : " + performance.missing.join(", ") : "");
  }
  function points(value) {return U.validNumber(value) ? (value > 0 ? "+" : "") + U.formatNumber(value, 2) + " pt" : "—";}
  function renderContributions(selected, quoteData = prices) {
    const result = F.contributionsFor(positions, quoteData, selected), table = document.createDocumentFragment();
    $("#portfolioContributionsTotal").textContent = result.available ? points(result.total) + " au total" : "—";
    $("#portfolioContributionsStatus").textContent = result.available ? (selected.intraday ? "Séance du " + selected.session_date + " · depuis la clôture précédente" : "Du " + result.start + " au " + result.end) + " · même période que le graphique · contributions en CAD, change inclus" :
      "Contributions indisponibles : une valeur complète de toutes les positions au début et à la fin de la période est nécessaire.";
    $("#portfolioContributionsStatus").classList.toggle("warning", !result.available);
    $("#portfolioContributionsSummary").textContent = "Voir toutes les contributions" + (result.available ? " (" + result.rows.length + ")" : "");
    for (const [selector, rows, empty] of [["#portfolioContributors", result.rows.filter(row => row.contribution > 0).slice(0, 3), "Aucune contribution positive sur cette période."],
      ["#portfolioDetractors", result.rows.filter(row => row.contribution < 0).slice(-3).reverse(), "Aucune contribution négative sur cette période."]]) {
      const list = document.createDocumentFragment();
      const largest = Math.max(0, ...result.rows.map(row => Math.abs(row.contribution)));
      for (const row of rows) {
        const li = el("li"), name = el("span", "portfolio-mover-name"); li.dataset.ticker = row.ticker;
        name.append(el("strong", "", row.title), el("span", "portfolio-ticker", row.ticker + " · " + delta(row.change_cad) + " CAD"));
        const bar = el("span", "contribution-bar " + direction(row.contribution)); bar.style.width = (largest ? Math.abs(row.contribution) / largest * 100 : 0) + "%"; bar.setAttribute("aria-hidden", "true"); name.append(bar);
        li.append(name, el("span", "change " + direction(row.contribution), points(row.contribution))); list.append(li);
      }
      if (!rows.length) list.append(el("li", "meta", result.available ? empty : "Historique incomplet pour cette période."));
      $(selector).replaceChildren(list);
    }
    for (const row of result.rows) {
      const tr = el("tr"), name = el("td"); tr.dataset.ticker = row.ticker;
      name.append(el("strong", "", row.title), el("span", "portfolio-ticker", row.ticker + " · cours du " + row.start_quote + " au " + row.end_quote));
      tr.append(name, el("td", "", U.formatNumber(row.start_weight, 2) + " %"), el("td", "change " + direction(row.percent), delta(row.percent, true)),
        el("td", "change " + direction(row.change_cad), delta(row.change_cad)), el("td", "change " + direction(row.contribution), points(row.contribution)));
      table.append(tr);
    }
    $("#portfolioContributionRows").replaceChildren(table);
  }
  function renderRisk(selected) {
    const risk = F.riskFor(positions, prices, selected, benchmarkId), rows = document.createDocumentFragment();
    $("#portfolioRiskStatus").textContent = risk.available ? "Du " + risk.start + " au " + risk.end + " · " + risk.observations + " rendements de séances communes · CAD, hors dividendes" +
      (risk.start !== selected.start || risk.end !== selected.end ? " · période demandée : " + selected.start + " au " + selected.end : "") +
      (risk.skipped_closes ? " · " + risk.skipped_closes + " clôtures sans correspondance exclues" : "") :
      (risk.reason === "short_history" ? "Pas assez de clôtures communes sur cette période." : ("Risque indisponible : un historique complet du portefeuille et de FEQT est nécessaire pour cette période.".replaceAll("FEQT", benchmarkId)));
    $("#portfolioRiskStatus").classList.toggle("warning", !risk.available);
    const measurements = [["period_return", "Rendement sur la période", risk.portfolio.period_return, risk.benchmark.period_return, "%"],
      ["active_return", "Excédent moyen annualisé", risk.portfolio.active_return, risk.benchmark.active_return, "%"],
      ["sharpe", "Ratio de Sharpe", risk.portfolio.sharpe, risk.benchmark.sharpe, ""],
      ["sortino", "Ratio de Sortino", risk.portfolio.sortino, risk.benchmark.sortino, ""],
      ["information", "Ratio d’information", risk.portfolio.information, risk.benchmark.information, ""],
      ["treynor", "Ratio de Treynor", risk.portfolio.treynor, risk.benchmark.treynor, "%/β"],
      ["alpha", "Alpha de Jensen annualisé", risk.portfolio.alpha, risk.benchmark.alpha, "%"],
      ["volatility", "Volatilité annualisée", risk.portfolio.volatility, risk.benchmark.volatility, "%"],
      ["tracking_error", "Tracking error annualisée", risk.portfolio.tracking_error, risk.benchmark.tracking_error, "%"],
      ["drawdown", "Baisse maximale", risk.portfolio.drawdown?.value, risk.benchmark.drawdown?.value, "%"],
      ["beta", ("Bêta relatif à FEQT".replaceAll("FEQT", benchmarkId)), risk.portfolio.beta, risk.benchmark.beta, ""],
      ["correlation", ("Corrélation avec FEQT".replaceAll("FEQT", benchmarkId)), risk.portfolio.correlation, risk.benchmark.correlation, ""]];
    for (const [key, label, portfolio, benchmark, unit] of measurements) {
      const tr = el("tr"), heading = el("th", "", label); heading.scope = "row"; tr.dataset.metric = key; tr.append(heading);
      for (const value of [portfolio, benchmark]) tr.append(el("td", "", U.validNumber(value) ? U.formatNumber(value, 2) + (unit ? " " + unit : "") : "N/D"));
      tr.append(el("td", "", U.validNumber(portfolio) && U.validNumber(benchmark) ? unit === "%/β" ? points(portfolio - benchmark) + "/β" : unit ? points(portfolio - benchmark) :
        (portfolio - benchmark > 0 ? "+" : "") + U.formatNumber(portfolio - benchmark, 2) : "—")); rows.append(tr);
    }
    $("#portfolioRiskRows").replaceChildren(rows);
    const notes = [];
    if (risk.available) {
      notes.push("Taux sans risque fixe : " + U.formatNumber(risk.risk_free_rate * 100, 2) + " %/an (hypothèse de comparaison). Ratios calculés sur les clôtures, pas sur les cotations en séance.");
      if (!U.validNumber(risk.portfolio.volatility)) notes.push("Volatilité : minimum " + F.MIN_VOLATILITY_RETURNS + " rendements communs.");
      if (risk.observations < F.MIN_RATIO_RETURNS) notes.push("Ratios et excédent annualisé : minimum " + F.MIN_RATIO_RETURNS + " rendements communs; choisis 3 mois ou plus.");
      else {
        if (risk.observations < F.SESSIONS_PER_YEAR) notes.push("Moins d’un an de séances : ratios sensibles à la période, à interpréter avec prudence. L’annualisation n’est pas une prévision.");
        if (!U.validNumber(risk.portfolio.sharpe) || !U.validNumber(risk.benchmark.sharpe)) notes.push("Sharpe N/D si la volatilité est nulle ou quasi nulle.");
        if (!U.validNumber(risk.portfolio.sortino) || !U.validNumber(risk.benchmark.sortino)) notes.push("Sortino N/D en l’absence d’écart baissier mesurable au taux sans risque.");
        if (!U.validNumber(risk.portfolio.information)) notes.push("Ratio d’information N/D si la tracking error est nulle ou quasi nulle.");
        if (!U.validNumber(risk.portfolio.treynor)) notes.push("Treynor N/D si le bêta est indisponible, nul, quasi nul ou négatif.");
      }
      notes.push("Le benchmark comparé à lui-même a un excédent et une tracking error de 0; son ratio d’information est indéfini (N/D), pas 0.");
      if (!U.validNumber(risk.portfolio.beta)) notes.push(risk.beta_reason === "constant_benchmark" ? ("Bêta indisponible : FEQT ne varie pas assez sur cet échantillon.".replaceAll("FEQT", benchmarkId)) : "Bêta : minimum " + F.MIN_BETA_RETURNS + " rendements communs.");
      for (const [label, measure] of [["Portefeuille", risk.portfolio.drawdown], [benchmarkId, risk.benchmark.drawdown]])
        notes.push(label + " : " + (measure.value < 0 ? "baisse maximale du sommet du " + measure.peak_date + " au creux du " + measure.trough_date + "." : "aucune baisse entre sommet et creux observée sur ces clôtures."));
    } else notes.push("Choisis une période plus longue si l’échantillon est trop court; aucune estimation ne remplace une donnée manquante.");
    $("#portfolioRiskNote").textContent = notes.join(" ");
  }
  function earningsAmount(value, currency, revenue = false) {
    if (!U.validNumber(value)) return "N/D";
    if (revenue) {
      const scale = Math.abs(value) >= 1e9 ? 1e9 : Math.abs(value) >= 1e6 ? 1e6 : 1;
      return U.formatNumber(value / scale, 2) + (scale === 1e9 ? " G" : scale === 1e6 ? " M" : " ") + (currency === "USD" ? "$ US" : currency === "CAD" ? "$ CA" : " · devise N/D");
    }
    return U.formatNumber(value, 2) + (currency === "USD" ? " $ US" : currency === "CAD" ? " $ CA" : " · devise N/D");
  }
  function earningsWeekLabel(week) {return U.observationLabel(week.start) + " – " + U.observationLabel(week.end);}
  function earningsDateLabel(event) {
    return event.report_at ? U.timestampLabel(event.report_at) + " · horaire du calendrier" : U.observationLabel(event.report_date) + " · heure N/D";
  }
  function earningsPendingLabel(event) {return event.report_date < F.localDay() ? "Publication à confirmer" : "À venir";}
  function renderEarnings(current) {
    const valuation = current || {complete: false, total: 0, rows: positions.map(row => ({...row, title: catalog?.series.find(definition => definition.id === row.ticker)?.title || row.ticker}))};
    if (!positions.some(row => row.ticker === earningsTicker)) earningsTicker = "";
    const options = document.createDocumentFragment(), all = el("option", "", "Tous mes titres"); all.value = ""; options.append(all);
    for (const row of [...valuation.rows].sort((a, b) => a.ticker.localeCompare(b.ticker))) {
      const option = el("option", "", row.ticker + " · " + row.title); option.value = row.ticker; options.append(option);
    }
    $("#portfolioEarningsTicker").replaceChildren(options); $("#portfolioEarningsTicker").value = earningsTicker;
    const thisWeek = F.weekFor(), weeks = document.createDocumentFragment();
    for (let offset = 5; offset >= -12; offset--) {
      const week = F.weekFor(F.shiftDay(thisWeek.start, offset * 7));
      const prefix = offset === 0 ? "Cette semaine · " : offset === 1 ? "Semaine prochaine · " : offset === -1 ? "Semaine dernière · " : "";
      const option = el("option", "", prefix + earningsWeekLabel(week)); option.value = week.start; weeks.append(option);
    }
    $("#portfolioEarningsWeek").replaceChildren(weeks);
    if (![...$("#portfolioEarningsWeek").options].some(option => option.value === earningsWeek)) earningsWeek = thisWeek.start;
    $("#portfolioEarningsWeek").value = earningsWeek;
    const result = F.selectEarnings(valuation, earnings, {ticker: earningsTicker, week: F.weekFor(earningsWeek)});
    earningsSelection = result;
    const warning = !earnings || earningsCached || result.cached.length > 0 || result.unavailable.length > 0 || !result.inWindow;
    $("#portfolioEarningsStatus").textContent = earnings ? earningsWeekLabel(result.week) + " · " + result.reported + " résultat" + (result.reported > 1 ? "s" : "") + " publié" + (result.reported > 1 ? "s" : "") + " · " + result.pending + " en attente · collecte du " + U.timestampLabel(earnings.generated_at) +
      (earningsCached || result.cached.length ? " · copie conservée; dates de collecte originales" : "") +
      (result.notApplicable.length ? " · " + result.notApplicable.length + " FNB hors du calendrier d’entreprise" : "") +
      (result.unavailable.length ? " · calendriers indisponibles : " + result.unavailable.join(", ") : "") +
      (!result.inWindow ? " · semaine hors de la fenêtre collectée; actualisation nécessaire" : "") : "Les résultats n’ont pas pu être chargés. Utilise « Actualiser ».";
    $("#portfolioEarningsStatus").classList.toggle("warning", warning);
    const calendar = document.createDocumentFragment();
    for (const day of result.week.days) {
      const reports = result.rows.filter(row => row.report_date === day), weekday = new Date(day + "T12:00:00Z").getUTCDay();
      if ((weekday === 0 || weekday === 6) && !reports.length) continue;
      const column = el("div", "portfolio-earnings-day"), label = el("time", "portfolio-earnings-day-label", new Intl.DateTimeFormat("fr-CA", {weekday: "short", day: "numeric", timeZone: "UTC"}).format(new Date(day + "T12:00:00Z")));
      label.dateTime = day; column.append(label);
      for (const report of reports) {
        const badge = el("button", "portfolio-earnings-badge", report.holdings.map(row => row.ticker).join(" / "));
        badge.type = "button"; badge.dataset.earningsId = report.id;
        const outcome = report.date_status === "reported" ? F.earningsOutcome(report.eps) : {status: "pending"};
        badge.classList.add("earnings-" + outcome.status); badge.setAttribute("aria-label", "Voir les résultats de " + badge.textContent + " du " + U.observationLabel(day));
        badge.append(el("small", "", report.date_status === "reported" ? outcome.status === "beat" ? "BPA battu" : outcome.status === "miss" ? "BPA raté" : outcome.status === "inline" ? "BPA conforme" : "Publié" : earningsPendingLabel(report)));
        badge.addEventListener("click", () => {const card = document.querySelector('#portfolioEarningsItems [data-earnings-id="' + report.id + '"]'); card?.scrollIntoView({behavior: "smooth", block: "center"}); card?.focus({preventScroll: true});});
        column.append(badge);
      }
      if (!reports.length) column.append(el("span", "portfolio-earnings-none", "—"));
      calendar.append(column);
    }
    $("#portfolioEarningsCalendar").replaceChildren(calendar); $("#portfolioEarningsCalendar").hidden = !earnings;
    const content = document.createDocumentFragment();
    for (const report of result.rows) {
      const card = el("article", "portfolio-earnings-card"), heading = el("div", "portfolio-earnings-card-heading"); card.dataset.earningsId = report.id; card.tabIndex = -1;
      const title = el("div"); title.append(el("p", "eyebrow", report.holdings.map(row => row.ticker).join(" / ")), el("h4", "", report.holdings[0].title));
      heading.append(title, el("span", "portfolio-earnings-state", report.date_status === "reported" ? "PUBLIÉ" : earningsPendingLabel(report)));
      const time = el("time", "meta", earningsDateLabel(report)); time.dateTime = report.report_at || report.report_date;
      card.append(heading, time, el("p", "meta", (report.quarter ? report.quarter + " · " : "") + (report.date_status === "estimated" ? "Date estimée" : report.date_status === "calendar" ? "Date du calendrier · à vérifier auprès de l’émetteur" : "Résultats publiés")));
      if (report.cached) card.append(el("p", "meta warning", "Copie de la collecte du " + U.timestampLabel(report.fetched_at)));
      const table = el("table", "portfolio-earnings-table"), caption = el("caption", "sr-only", "Montants publiés et consensus pour " + report.holdings[0].title);
      const head = el("thead"), headRow = el("tr"); for (const label of ["", "Publié", "Attendu"]) {const cell = el("th", "", label); cell.scope = "col"; headRow.append(cell);} head.append(headRow);
      const body = el("tbody");
      for (const [key, label] of [["eps", "BPA"], ["revenue", "Revenus"]]) {
        const metric = report[key], row = el("tr"), name = el("th", "", label), basisLabel = basis => basis ? " · " + (basis === "gaap" ? "GAAP" : "ajusté") : ""; name.scope = "row"; row.append(name, el("td", "", earningsAmount(metric.actual, metric.currency, key === "revenue") + basisLabel(metric.actual_basis)), el("td", "", earningsAmount(metric.estimate, metric.estimate_currency || metric.currency, key === "revenue") + basisLabel(metric.estimate_basis)));
        body.append(row);
        const outcome = F.earningsOutcome(metric), status = el("tr"), cell = el("td", "earnings-outcome earnings-" + outcome.status, report.date_status !== "reported" ? earningsPendingLabel(report) : outcome.status === "pending" ? "Montant publié N/D" : outcome.label + (U.validNumber(outcome.percent) ? " · " + delta(outcome.percent, true) : "")); cell.colSpan = 3; cell.dataset.metric = key; status.append(cell); body.append(status);
      }
      table.append(caption, head, body); card.append(table);
      const messages = F.earningsMessages(report);
      if (messages.length) {
        card.append(el("h5", "", "Messages clés")); const list = el("ul", "portfolio-earnings-messages");
        for (const message of messages) list.append(el("li", "", message.text));
        card.append(list);
      } else card.append(el("p", "meta", report.date_status === "reported" ? "Analyse du compte rendu en attente de vérification. Les sources sont disponibles ci-dessous." : "Analyse et surprises disponibles après publication."));
      const links = el("div", "portfolio-earnings-sources");
      const sources = [...report.sources]; if (report.report_url) sources.push({label: "Compte rendu de la conférence", url: report.report_url});
      for (const source of sources) {const link = el("a", "", source.label + " ↗"); link.href = source.url; link.target = "_blank"; link.rel = "noopener noreferrer"; links.append(link);}
      card.append(links);
      if (report.holdings.some(row => row.listing_note)) card.append(el("p", "meta", "Résultats de l’entreprise sous-jacente; la devise du rapport peut différer de ta cotation."));
      content.append(card);
    }
    if (!result.rows.length) {
      const onlyFunds = result.notApplicable.length > 0 && result.notApplicable.length === valuation.rows.filter(row => !earningsTicker || row.ticker === earningsTicker).length;
      const empty = el("div", "portfolio-earnings-empty"); empty.append(el("p", "", !earnings ? "Le calendrier apparaîtra lorsque les sources auront pu être chargées." : !result.inWindow ? "Aucune donnée collectée pour cette semaine." : onlyFunds ? "Tes titres sont des FNB : ils ne publient pas de BPA trimestriel d’entreprise. Le calendrier affichera les résultats si tu ajoutes des actions individuelles." : result.unavailable.length ? "Aucun résultat repéré dans les calendriers disponibles. Certains titres n’ont pas pu être vérifiés." : "Aucun résultat prévu ou publié cette semaine pour tes titres. Change de semaine pour voir les dernières ou prochaines publications."));
      const latest = valuation.rows.filter(row => !earningsTicker || row.ticker === earningsTicker).flatMap(row => earnings?.instruments[row.ticker]?.events || []).filter(event => event.date_status === "reported").sort((a, b) => b.report_date.localeCompare(a.report_date))[0];
      if (latest && F.weekFor(latest.report_date).start !== earningsWeek) {const button = el("button", "button quiet", "Voir ma dernière semaine de résultats"); button.type = "button"; button.addEventListener("click", () => {earningsWeek = F.weekFor(latest.report_date).start; renderEarnings(current);}); empty.append(button);}
      content.append(empty);
    }
    $("#portfolioEarningsItems").replaceChildren(content); $("#portfolioEarningsImage").disabled = !earnings || !result.inWindow;
  }
  function saveEarningsImage() {
    const result = earningsSelection; if (!result?.inWindow || !earnings) return;
    const canvas = document.createElement("canvas"), width = 1200, cardWidth = 544, rows = Math.max(1, Math.ceil(result.rows.length / 2));
    const ctx = canvas.getContext("2d"), theme = getComputedStyle(document.documentElement);
    const tone = name => theme.getPropertyValue(name).trim(), ink = tone("--text"), muted = tone("--muted");
    function messageLines(text) {
      const lines = []; let line = "";
      for (const word of ("• " + text).split(/\s+/)) {
        const next = line ? line + " " + word : word;
        if (line && ctx.measureText(next).width > cardWidth - 40) {lines.push(line); line = word;} else line = next;
      }
      if (line) lines.push(line);
      return lines;
    }
    ctx.font = "15px \"Source Sans 3\"";
    const cardHeight = Math.max(420, ...result.rows.map(report => 290 + F.earningsMessages(report).reduce((height, message) => height + messageLines(message.text).length * 19 + 14, 0)));
    canvas.width = width; canvas.height = 160 + rows * (cardHeight + 20) + 70;
    ctx.fillStyle = tone("--bg"); ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = tone("--accent"); ctx.font = "600 18px \"Source Sans 3\""; ctx.fillText("SAVY · RÉSULTATS DE MES TITRES", 46, 44);
    ctx.fillStyle = ink; ctx.font = "600 30px \"Source Sans 3\""; ctx.fillText(earningsWeekLabel(result.week), 46, 90);
    ctx.fillStyle = muted; ctx.font = "17px \"Source Sans 3\""; ctx.fillText(result.reported + " publiés · " + result.pending + " en attente · " + result.unavailable.length + " calendriers N/D · Sources : voir SAVY", 46, 122);
    function wrapped(text, x, y, maxWidth, lineHeight, maxLines = 3) {
      let line = "", lines = 0; const words = text.split(/\s+/);
      for (let i = 0; i < words.length; i++) {
        const next = line ? line + " " + words[i] : words[i];
        if (ctx.measureText(next).width > maxWidth && line) {ctx.fillText(line, x, y); y += lineHeight; lines++; line = words[i]; if (lines === maxLines - 1) {const rest = words.slice(i).join(" "); if (ctx.measureText(rest).width > maxWidth) {let clipped = rest; while (ctx.measureText(clipped + "…").width > maxWidth && clipped.length) clipped = clipped.slice(0, -1); ctx.fillText(clipped + "…", x, y); return;} }} else line = next;
      }
      if (line) ctx.fillText(line, x, y);
    }
    result.rows.forEach((report, index) => {
      const x = 46 + index % 2 * (cardWidth + 20), y = 160 + Math.floor(index / 2) * (cardHeight + 20);
      ctx.fillStyle = tone("--surface"); ctx.fillRect(x, y, cardWidth, cardHeight); ctx.fillStyle = tone("--accent"); ctx.font = "600 18px \"Source Sans 3\""; ctx.fillText(report.holdings.map(row => row.ticker).join(" / "), x + 20, y + 32);
      ctx.fillStyle = ink; ctx.font = "600 21px \"Source Sans 3\""; wrapped(report.holdings[0].title, x + 20, y + 62, cardWidth - 40, 23, 1);
      ctx.fillStyle = muted; ctx.font = "15px \"Source Sans 3\""; ctx.fillText(U.observationLabel(report.report_date) + (report.quarter ? " · " + report.quarter : "") + (report.date_status === "estimated" ? " · Date estimée" : ""), x + 20, y + 90);
      let lineY = y + 130;
      for (const [key, label] of [["eps", "BPA"], ["revenue", "Revenus"]]) {
        const metric = report[key], outcome = F.earningsOutcome(metric);
        ctx.fillStyle = ink; ctx.font = "17px \"Source Sans 3\""; ctx.fillText(label + " : " + earningsAmount(metric.actual, metric.currency, key === "revenue") + " / attendu " + earningsAmount(metric.estimate, metric.currency, key === "revenue"), x + 20, lineY);
        ctx.fillStyle = outcome.status === "beat" ? tone("--up") : outcome.status === "miss" ? tone("--down") : muted; ctx.font = "14px \"Source Sans 3\""; ctx.fillText(report.date_status !== "reported" ? earningsPendingLabel(report) : outcome.status === "pending" ? "Montant publié N/D" : outcome.label, x + 20, lineY + 23); lineY += 59;
      }
      ctx.fillStyle = muted; ctx.font = "15px \"Source Sans 3\"";
      const messages = F.earningsMessages(report);
      for (const message of messages) {
        for (const line of messageLines(message.text)) {ctx.fillText(line, x + 20, lineY); lineY += 19;}
        lineY += 14;
      }
      if (!messages.length) wrapped(report.date_status === "reported" ? "Analyse du compte rendu en attente de vérification." : "Analyse après publication.", x + 20, lineY, cardWidth - 40, 19, 2);
    });
    if (!result.rows.length) {ctx.fillStyle = muted; ctx.font = "23px \"Source Sans 3\""; wrapped("Aucun résultat repéré pour mes titres cette semaine." + (result.unavailable.length ? " Calendriers indisponibles : " + result.unavailable.join(", ") : ""), 46, 215, width - 92, 32);}
    ctx.fillStyle = muted; ctx.font = "13px \"Source Sans 3\""; ctx.fillText("Collecte : " + U.timestampLabel(earnings.generated_at) + (earningsCached || result.cached.length ? " · COPIE CONSERVÉE" : "") + " · Attentes absentes = N/D · BPA et consensus du même fournisseur", 46, canvas.height - 33);
    canvas.toBlob(blob => {if (!blob) return; const url = URL.createObjectURL(blob), link = el("a"); link.href = url; link.download = "savy-resultats-" + (activePortfolio !== "1" ? "portefeuille-" + activePortfolio + "-" : "") + result.week.start + ".png"; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);}, "image/png");
  }
  function renderAnalysis(selected, current, quoteData = prices, closedSelected = selected) {
    renderContributions(selected, quoteData); renderEarnings(current);
    $("#portfolioRisk .table-wrap").hidden = Boolean(selected?.intraday);
    if (selected?.intraday) {
      $("#portfolioRiskRows").replaceChildren();
      $("#portfolioRiskStatus").textContent = "Les mesures de risque utilisent les clôtures quotidiennes. Choisis 1 mois pour la volatilité, ou 3 mois et plus pour les ratios Sharpe, Sortino et information.";
      $("#portfolioRiskStatus").classList.remove("warning"); $("#portfolioRiskNote").textContent = "";
    } else renderRisk(closedSelected);
  }
  function selectHeatmap(ticker) {
    const row = heatmapModel?.rows.find(item => item.ticker === ticker);
    if (!row) return;
    heatmapTicker = ticker; $("#portfolioHeatmapPosition").value = ticker;
    for (const tile of $("#portfolioHeatmapTiles").querySelectorAll("button")) tile.setAttribute("aria-pressed", String(tile.dataset.ticker === ticker));
    const detail = document.createDocumentFragment();
    detail.append(el("strong", "", row.ticker + " · " + row.title));
    const metrics = el("div", "portfolio-heatmap-metrics");
    for (const [label, value] of [["Variation", row.percent === null ? "N/D · " + row.reason : delta(row.percent, true)],
      ["Valeur CAD", money(row.value_cad)], ["Poids", row.weight === null ? "N/D · valorisation partielle" : U.formatNumber(row.weight, 2) + " %"],
      ["Cours", U.validNumber(row.price) ? U.formatNumber(row.price, row.decimals) + " " + row.currency : "N/D"]]) {
      const item = el("div"); item.append(el("span", "meta", label), el("strong", "", value)); metrics.append(item);
    }
    detail.append(metrics);
    const time = row.quote ? window.IntradayUtils.shortLabel(row.quote) + " · " + U.timestampLabel(row.quote.timestamp) : "Clôture du " + (row.price_date || "—");
    detail.append(el("p", "meta", time + (row.baseline_date ? " · base du " + row.baseline_date : "") +
      (cached || row.fetch_status === "cached" ? " · copie conservée" : "")));
    $("#portfolioHeatmapDetail").replaceChildren(detail);
  }
  function drawHeatmap() {
    const host = $("#portfolioHeatmapTiles"), focused = document.activeElement?.closest("#portfolioHeatmapTiles button")?.dataset.ticker;
    const width = host.clientWidth, height = host.clientHeight;
    if (!heatmapModel?.valued.length) {host.replaceChildren(el("p", "chart-placeholder", "La heatmap apparaîtra avec les cours et le change nécessaires à la valorisation.")); return;}
    if (!width || !height) return;
    const fragment = document.createDocumentFragment(), limit = H.RANGES.find(item => item.key === heatmapRange).limit;
    for (const row of H.layout(heatmapModel.valued, width, height)) {
      const tile = el("button", "portfolio-heatmap-tile"); tile.type = "button"; tile.dataset.ticker = row.ticker;
      tile.style.left = row.x / width * 100 + "%"; tile.style.top = row.y / height * 100 + "%";
      tile.style.width = row.width / width * 100 + "%"; tile.style.height = row.height / height * 100 + "%";
      tile.style.backgroundColor = H.color(row.percent, limit);
      const change = row.percent === null ? "N/D" : delta(row.percent, true);
      tile.setAttribute("aria-label", row.ticker + " · " + row.title + " · " + change + (row.reason ? " · " + row.reason : "") +
        " · valeur " + money(row.value_cad) + (row.weight === null ? " · valorisation partielle" : " · poids " + U.formatNumber(row.weight, 2) + " %"));
      tile.setAttribute("aria-pressed", String(row.ticker === heatmapTicker)); tile.title = tile.getAttribute("aria-label");
      const label = el("span", "portfolio-heatmap-tile-label"); label.setAttribute("aria-hidden", "true");
      if (row.width >= 53 && row.height >= 30) {
        const symbol = el("strong", "portfolio-heatmap-symbol", row.ticker);
        symbol.style.fontSize = Math.min(23, Math.max(9, Math.min((row.width - 12) / (row.ticker.length * .7), (row.height - 16) / 2.7))) + "px";
        label.append(symbol);
      }
      const returnSize = Math.min(18, (row.width - 12) / (change.length * .65), (row.height - 16) / 3.2);
      if (row.width >= 62 && row.height >= 54 && returnSize >= 9) {
        const value = el("span", "portfolio-heatmap-return", change); value.style.fontSize = returnSize + "px"; label.append(value);
      }
      if (row.width >= 110 && row.height >= 90 && row.weight !== null) label.append(el("span", "portfolio-heatmap-weight", "Poids " + U.formatNumber(row.weight, 1) + " %"));
      if (row.width >= 180 && row.height >= 125) label.append(el("span", "portfolio-heatmap-name", row.title));
      tile.append(label); tile.addEventListener("click", () => selectHeatmap(row.ticker)); fragment.append(tile);
    }
    host.replaceChildren(fragment);
    if (focused) [...host.querySelectorAll("button")].find(tile => tile.dataset.ticker === focused)?.focus({preventScroll: true});
  }
  function renderHeatmap(current, quoteData = prices) {
    heatmapModel = H.model(current, prices, quoteData, heatmapRange);
    const config = H.RANGES.find(item => item.key === heatmapRange);
    for (const button of $("#portfolioHeatmapRanges").querySelectorAll("button")) button.setAttribute("aria-pressed", String(button.dataset.range === heatmapRange));
    $("#portfolioHeatmapTitle").textContent = "Heatmap · portefeuille " + portfolioNames[activePortfolio];
    $("#portfolioHeatmapStatus").textContent = !heatmapModel.end ? "Cours indisponibles." :
      (heatmapRange === "1D" ? "Séance du " + heatmapModel.end + " · depuis la clôture précédente" : heatmapModel.start ? "Du " + heatmapModel.start + " au " + heatmapModel.end : "Historique insuffisant au " + heatmapModel.end) +
      " · " + heatmapModel.valued.length + "/" + heatmapModel.rows.length + " positions valorisées" +
      (!heatmapModel.complete ? " · CARTE PARTIELLE : surfaces limitées aux positions valorisées, poids indisponibles" : "") +
      (heatmapModel.missing.length ? " · sans valeur : " + heatmapModel.missing.join(", ") : "") +
      (heatmapModel.unavailable.length ? " · variation N/D (gris) : " + heatmapModel.unavailable.join(", ") : "") + (cached ? " · copie conservée" : "");
    $("#portfolioHeatmapStatus").classList.toggle("warning", cached || !heatmapModel.complete || heatmapModel.unavailable.length > 0);
    const legend = document.createDocumentFragment();
    for (const factor of [-1, -2 / 3, -1 / 3, 0, 1 / 3, 2 / 3, 1]) {
      const item = el("span"), swatch = el("i"); swatch.style.backgroundColor = H.color(factor * config.limit, config.limit); swatch.setAttribute("aria-hidden", "true");
      item.append(swatch, el("span", "", (factor === -1 ? "≤ " : factor === 1 ? "≥ " : "") + U.formatNumber(factor * config.limit, factor === 0 ? 0 : 1) + " %")); legend.append(item);
    }
    const unknown = el("span"), swatch = el("i"); swatch.style.backgroundColor = H.color(null, config.limit); swatch.setAttribute("aria-hidden", "true"); unknown.append(swatch, el("span", "", "N/D")); legend.append(unknown);
    $("#portfolioHeatmapLegend").replaceChildren(legend);
    const options = document.createDocumentFragment();
    for (const row of heatmapModel.rows) {const option = el("option", "", row.ticker + " · " + (row.percent === null ? "N/D" : delta(row.percent, true))); option.value = row.ticker; options.append(option);}
    $("#portfolioHeatmapPosition").replaceChildren(options); $("#portfolioHeatmapPosition").disabled = !heatmapModel.rows.length;
    if (!heatmapModel.rows.some(row => row.ticker === heatmapTicker)) heatmapTicker = H.layout(heatmapModel.valued, 1, 1)[0]?.ticker || heatmapModel.rows[0]?.ticker || "";
    drawHeatmap();
    if (heatmapTicker) selectHeatmap(heatmapTicker); else $("#portfolioHeatmapDetail").replaceChildren();
  }
  function render() {
    renderPortfolioChoice();
    document.dispatchEvent(new CustomEvent("savy:holdings", {detail: {portfolio: activePortfolio,
      tickers: positions.filter(p => p.quantity > 0).map(p => p.ticker)}}));
    const extended = window.ExtendedHoursUtils, extendedHost = $("#portfolioExtendedHours");
    if (extended && extendedHost) extended.render(extendedHost, Object.fromEntries(['pre','post'].map(key =>
      [key, extended.portfolio(positions, prices, window.SavyLiveQuotes?.dataset(), key)])));
    $("#portfolioEmpty").hidden = positions.length > 0;
    $("#portfolioContent").hidden = positions.length === 0;
    $("#portfolioExport").disabled = !positions.length;
    renderPositionsVisibility();
    renderExposureVisibility();
    for (const button of document.querySelectorAll("[data-portfolio-sort]")) {
      const active = button.dataset.portfolioSort === sortKey;
      button.closest("th").setAttribute("aria-sort", active ? (sortDescending ? "descending" : "ascending") : "none");
      button.querySelector("span").textContent = active ? (sortDescending ? "↓" : "↑") : "↕";
    }
    const controls = document.createDocumentFragment();
    for (const item of chartRanges) {const button = el("button", "", item.label); button.type = "button"; button.dataset.range = item.key; button.setAttribute("aria-pressed", String(item.key === range)); button.addEventListener("click", () => {range = item.key; saveView(); render();}); controls.append(button);}
    $("#portfolioRanges").replaceChildren(controls);
    if (!positions.length) {
      renderHeatmap(null);
      const needsLink = !holdingsAvailable && !personalKey;
      $("#portfolioStatus").textContent = needsLink ? "Portefeuille " + portfolioNames[activePortfolio] + " : ouvre ton lien personnel pour retrouver tes positions." : "Importe ta sauvegarde ou ajoute tes positions. Les quantités restent sur cet appareil.";
      $("#portfolioEmpty").textContent = needsLink ? "Ton lien personnel donne accès aux trois portefeuilles et mémorise cet accès sur cet appareil. Tu peux aussi importer une sauvegarde." : "Ajoute des titres ci-dessous ou importe une sauvegarde de ce portefeuille.";
      return;
    }
    if (!prices || !history.length) {$("#portfolioStatus").textContent = "Les cours n’ont pas pu être chargés. Tes positions sont conservées; utilise « Actualiser »."; $("#portfolioChart").replaceChildren(); $("#portfolioBenchmark").replaceChildren(); $("#portfolioBenchmarkNote").textContent = ""; $("#portfolioRows").replaceChildren(); $("#portfolioBest").replaceChildren(); $("#portfolioWorst").replaceChildren(); $("#portfolioMoversPeriod").textContent = ""; $("#portfolioMoversNote").textContent = "Les classements seront disponibles avec les cotations."; renderHeatmap(null); renderExposures(null); renderAnalysis(null, null); drawRelativeChart(null); return;}
    let liveFx = window.SavyLiveFX?.current();
    const dailyQuotes = window.SavyLiveQuotes?.portfolioView(prices, positions, liveFx) || prices;
    const currentHistory = P.historyFor(positions, dailyQuotes), dailyDay = currentHistory.at(-1)[0];
    const intraday = range === "INTRADAY" ? window.PortfolioIntradayUtils.session(positions, prices, window.SavyLiveQuotes?.dataset(), benchmarkId, liveFx) : null;
    const quoteData = intraday?.data || dailyQuotes, day = intraday?.available ? intraday.selected.end : dailyDay;
    if (intraday?.fx) liveFx = intraday.fx;
    const current = P.valuationAt(positions, quoteData, day, liveFx), selected = intraday ? intraday.selected : P.period(currentHistory, range);
    const closedSelected = {...selected, history: history.filter(row => row[0] >= selected.start && row[0] <= selected.end)};
    const quotes = new Map(quoteData.series.filter(p => p.current_quote).map(p => [p.id, p.current_quote]));
    const quoted = positions.filter(p => quotes.has(p.ticker));
    const baseline = P.valuationAt(positions, quoteData, selected.start), old = current.rows.filter(row => row.price_date && row.price_date.slice(0, 10) < day.slice(0, 10));
    $("#portfolioStatus").textContent = (cached ? "Copie de cours conservée · " : "") + "Cours des titres au " + day.slice(0, 10) + " · " +
      (positions.length - current.missing.length) + "/" + positions.length + " titres valorisés · collecte du " + U.timestampLabel(prices.generated_at) +
      (old.length ? " · " + old.length + " cours d’une séance antérieure repris" : "");
    if (window.SavyLiveQuotes?.dataset()) $("#portfolioStatus").textContent += " · " + quoted.length + "/" + positions.length + " cotations en séance disponibles · dernière collecte : " + U.timestampLabel(window.SavyLiveQuotes.dataset().generated_at) +
      (intraday?.available && !intraday.current ? " · actualisation en attente, courbe datée conservée" : " · délai fournisseur possible");
    if (intraday?.available && intraday.current && intraday.retained_quotes.length) $("#portfolioStatus").textContent +=
      " · derniers cours plus anciens pour " + intraday.retained_quotes.join(", ") + " : voir les heures par position";
    $("#portfolioStatus").classList.toggle("warning", cached || !current.complete || quoted.some(p => quotes.get(p.ticker).stale) || old.length > 0 || Date.now() - U.parseTimestamp(prices.generated_at) > 36 * 3600000);
    $("#portfolioValueLabel").textContent = current.complete ? (intraday?.available && !intraday.current ? "DERNIÈRE VALEUR COLLECTÉE · CAD" : "VALEUR DES TITRES · CAD") : "VALEUR PARTIELLE · CAD";
    $("#portfolioValue").textContent = money(current.total);
    $("#portfolioChange").textContent = delta(selected.change) + " · " + delta(selected.percent, true);
    $("#portfolioChange").className = "portfolio-change change " + direction(selected.change);
    $("#portfolioPeriod").textContent = intraday ? (intraday.available ? "Intraday · séance du " + intraday.session_date + " · " + window.IntradayUtils.clock(selected.history[0][0]) + " à " + window.IntradayUtils.clock(selected.end) + " · heure de Montréal" + (!intraday.current ? " · actualisation en attente" : "") : "Points intraday en attente" + (intraday.missing.length ? " · " + intraday.missing.join(", ") : "") + " · consulte les autres périodes") :
      "Du " + selected.start + " au " + selected.end + (selected.incomplete ? " · historique incomplet, variation indisponible" : " · derniers cours disponibles, hors dividendes");
    $("#portfolioFX").textContent = current.fx ? "1 $ US = " + U.formatNumber(current.fx, 4) + " $ CA · " +
      (liveFx ? (liveFx.stale ? "dernier cours collecté · " : liveFx.closed ? "dernier cours, marché fermé · " : "cotation indicative · ") + U.timestampLabel(liveFx.timestamp) + " · " + (liveFx.source || "biquote") : "clôture du " + current.fx_date + " · Yahoo Finance") : "Taux USD/CAD indisponible";
    $("#portfolioCurrencies").textContent = money(current.cad) + " en titres CAD · " + money(current.usd, "USD") + " en titres USD";
    $("#portfolioCost").textContent = "Coût converti au taux actuel : " + money(current.cost_converted);
    $("#portfolioUnrealized").textContent = "Gain latent estimé : " + delta(current.unrealized_cad) + " · " + delta(current.unrealized_percent, true) +
      (current.costs_available < positions.length ? " · prix moyens ou change incomplets" : " · change actuel");
    $("#portfolioUnrealized").className = "portfolio-unrealized change " + direction(current.unrealized_cad);
    $("#portfolioMissing").textContent = current.missing.length ? "Valeur partielle : cours ou change manquant pour " + current.missing.join(", ") + "." : "";
    renderMovers(dailyDay, dailyQuotes);
    renderHeatmap(current, quoteData);
    renderExposures(current);
    renderAnalysis(selected, current, quoteData, closedSelected);
    const previous = new Map(baseline.rows.map(row => [row.ticker, row]));
    const closedRows = new Map(P.valuationAt(positions, quoteData, day).rows.map(row => [row.ticker, row]));
    const comparedRows = current.rows.map(row => {
      const start = previous.get(row.ticker)?.value_cad;
      const closeValue = closedRows.get(row.ticker)?.value_cad;
      return {...row, period_change_cad: !selected.incomplete && U.validNumber(start) && U.validNumber(closeValue) ? closeValue - start : null};
    });
    const rows = document.createDocumentFragment();
    for (const row of sortKey ? P.sortRows(comparedRows, sortKey, sortDescending) : comparedRows) {
      const tr = el("tr"); tr.dataset.ticker = row.ticker;
      const name = el("td"); name.append(el("strong", "", row.title), el("span", "portfolio-ticker", row.ticker + " · " + row.currency));
      const quantity = el("td"), input = el("input", "quantity-input"); input.type = "text"; input.inputMode = "decimal"; input.value = String(row.quantity).replace(".", ","); input.setAttribute("aria-label", "Quantité " + row.ticker);
      input.addEventListener("change", () => {try {applyPositions(positions.map(p => p.ticker === row.ticker ? {...p, quantity: input.value} : p));} catch (error) {$("#portfolioMessage").textContent = error.message; input.value = String(row.quantity).replace(".", ",");}}); quantity.append(input);
      const average = el("td"), costInput = el("input", "quantity-input"); costInput.type = "text"; costInput.inputMode = "decimal";
      costInput.value = U.validNumber(row.average_cost) ? String(row.average_cost).replace(".", ",") : ""; costInput.placeholder = "—"; costInput.setAttribute("aria-label", "Prix moyen " + row.ticker);
      costInput.addEventListener("change", () => {try {applyPositions(positions.map(p => p.ticker === row.ticker ? {...p, average_cost: costInput.value.trim() ? costInput.value : null} : p));} catch (error) {$("#portfolioMessage").textContent = error.message; costInput.value = U.validNumber(row.average_cost) ? String(row.average_cost).replace(".", ",") : "";}}); average.append(costInput, el("span", "portfolio-ticker", row.currency));
      const price = el("td"), quote = quotes.get(row.ticker), quoteLine = el("span", "position-quote-line");
      quoteLine.append(el("span", "position-price", U.formatNumber(row.price, row.decimals) + " " + row.currency));
      const sessionChange = P.sessionChange(prices.series.find(p => p.id === row.ticker), row.price, row.price_date, quote);
      if (sessionChange) {
        const percent = Math.abs(sessionChange.percent) < .005 ? 0 : sessionChange.percent;
        const change = el("span", "position-day-change change " + direction(percent), (percent > 0 ? "+" : "") + U.formatNumber(percent, 2) + "%");
        change.title = "Variation de la séance du " + sessionChange.session_date + " depuis la clôture précédente, en " + row.currency;
        quoteLine.append(change);
      }
      price.append(quoteLine);
      const priceDate = el("span", "portfolio-ticker portfolio-quote", quote ? window.IntradayUtils.shortLabel(quote) : (row.price_date || "Cours indisponible") + " · clôture quotidienne");
      if (quote) priceDate.title = "Cours daté du " + U.timestampLabel(quote.timestamp) + " · source consultée le " + U.timestampLabel(quote.fetched_at);
      price.append(priceDate);
      const value = el("td", "", money(row.value_cad));
      const weight = el("td", "", current.complete && row.value_cad !== null ? U.formatNumber(row.value_cad / current.total * 100, 2) + " %" : "—");
      const change = el("td", "change " + direction(row.period_change_cad), delta(row.period_change_cad));
      const gain = el("td", "change " + direction(row.unrealized_percent), delta(row.unrealized_percent, true));
      gain.append(el("span", "portfolio-ticker", U.validNumber(row.unrealized_native) ? money(row.unrealized_native, row.currency) : "Prix moyen manquant"));
      const gainCAD = el("td", "change " + direction(row.unrealized_cad), delta(row.unrealized_cad));
      const source = el("td"), link = el("a", "", "Source ↗"); link.href = row.source_url; link.target = "_blank"; link.rel = "noopener noreferrer"; source.append(link);
      const remove = el("button", "remove-position", "×"); remove.type = "button"; remove.setAttribute("aria-label", "Retirer " + row.ticker); remove.addEventListener("click", () => applyPositions(positions.filter(p => p.ticker !== row.ticker))); source.append(remove);
      tr.append(name, quantity, average, price, value, weight, gain, gainCAD, change, source); rows.append(tr);
    }
    $("#portfolioRows").replaceChildren(rows);
    const comparison = intraday ? intraday.comparison : P.benchmarkFor(selected, quoteData.series.find(row => row.id === benchmarkId), benchmarkId);
    renderBenchmark(comparison);
    if (intraday) $("#portfolioBenchmarkNote").textContent = intraday.available ? "Intraday · rendements en CAD depuis la clôture du " + selected.start + " · points de 5 min · change inclus · hors dividendes" : "Comparaison intraday indisponible : cotations de séance incomplètes.";
    if (quotes.has(benchmarkId)) $("#portfolioBenchmarkNote").textContent += " · " + benchmarkId + " : " + window.IntradayUtils.label(quotes.get(benchmarkId));
    drawChart(selected.history, comparison);
    drawRelativeChart(comparison);
    if (intraday && !intraday.available) $("#portfolioChart").replaceChildren(el("p", "chart-placeholder", "Courbe de séance à jour indisponible. Les positions sont conservées."));
  }
  function svgEl(tag, attrs, text) {const node = document.createElementNS("http://www.w3.org/2000/svg", tag); for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, String(v)); if (text !== undefined) node.textContent = text; return node;}
  function drawRelativeChart(comparison) {
    relativeComparison = comparison;
    const host = $("#portfolioRelativeChart"), relative = P.relativePerformance(comparison), metric = $("#portfolioRelativeValue");
    $("#portfolioRelativeTitle").textContent = "Écart avec " + benchmarkId;
    const shown = U.validNumber(relative.difference) && Math.abs(relative.difference) < .005 ? 0 : relative.difference;
    metric.textContent = points(shown); metric.className = "change " + direction(shown);
    if (!relative.available) {host.replaceChildren(el("p", "chart-placeholder", "Choisis une période avec un historique commun pour comparer le portefeuille à " + benchmarkId + ".")); return;}
    const data = relative.points.map(row => [row.date, row.difference]), valid = data.filter(row => U.validNumber(row[1]));
    const details = new Map(relative.points.map(row => [row.date, row]));
    const width = Math.max(240, Math.round(host.clientWidth || 900)), height = 128, left = 58, right = 12, top = 10, bottom = 25;
    const bound = Math.max(.1, ...valid.map(row => Math.abs(row[1]))) * 1.08;
    let first = Date.parse(data[0][0]), last = Date.parse(data.at(-1)[0]);
    if (first === last) {first -= 60000; last += 60000;}
    const x = date => left + (Date.parse(date) - first) / (last - first) * (width - left - right);
    const y = value => top + (bound - value) / (2 * bound) * (height - top - bottom), zero = y(0);
    const svg = svgEl("svg", {viewBox: "0 0 " + width + " " + height, tabindex: 0, role: "img",
      "aria-label": "Écart de rendement avec " + benchmarkId + " en points de pourcentage. Au-dessus de zéro : surperformance. Flèches gauche et droite pour parcourir les dates."});
    const defs = svgEl("defs");
    for (const [name, start, size] of [["up", top, zero - top], ["down", zero, height - bottom - zero]]) {
      const clip = svgEl("clipPath", {id: "portfolio-relative-" + name});
      clip.append(svgEl("rect", {x: left, y: start, width: width - left - right, height: size})); defs.append(clip);
    }
    svg.append(defs);
    for (const value of [-bound, 0, bound]) svg.append(svgEl("line", {x1: left, x2: width - right, y1: y(value), y2: y(value), class: value === 0 ? "relative-zero" : "chart-grid"}),
      svgEl("text", {x: left - 8, y: y(value) + 3, "text-anchor": "end", class: "chart-axis"}, U.formatNumber(value, bound < 100 ? 2 : 0) + " pt"));
    const segments = []; let segment = [];
    for (const row of data) {if (U.validNumber(row[1])) segment.push(row); else {if (segment.length) segments.push(segment); segment = [];}}
    if (segment.length) segments.push(segment);
    const line = segments.map(rows => rows.map((row, i) => (i ? "L" : "M") + x(row[0]).toFixed(2) + "," + y(row[1]).toFixed(2)).join("")).join("");
    const area = segments.map(rows => "M" + x(rows[0][0]).toFixed(2) + "," + zero + "L" + rows.map(row => x(row[0]).toFixed(2) + "," + y(row[1]).toFixed(2)).join("L") + "L" + x(rows.at(-1)[0]).toFixed(2) + "," + zero + "Z").join("");
    for (const name of ["up", "down"]) svg.append(svgEl("path", {d: area, class: "relative-area " + name, "clip-path": "url(#portfolio-relative-" + name + ")"}),
      svgEl("path", {d: line, class: "relative-line " + name, "clip-path": "url(#portfolio-relative-" + name + ")"}));
    for (let i = 0; i < (width < 400 ? 2 : 4); i++) {
      const ratio = i / (width < 400 ? 1 : 3), stamp = first + (last - first) * ratio;
      svg.append(svgEl("text", {x: left + (width - left - right) * ratio, y: height - 6, class: "chart-axis", "text-anchor": ratio === 0 ? "start" : ratio === 1 ? "end" : "middle"},
        range === "INTRADAY" ? window.IntradayUtils.clock(stamp) : new Intl.DateTimeFormat("fr-CA", {timeZone: "UTC", month: "short", day: "numeric"}).format(stamp)));
    }
    const guide = svgEl("line", {y1: top, y2: height - bottom, class: "chart-guide", visibility: "hidden"}), dot = svgEl("circle", {r: 3, class: "chart-dot", visibility: "hidden"}); svg.append(guide, dot);
    const hint = "Même période que le graphique · survole pour voir l’écart", tooltip = el("p", "chart-tooltip", hint); tooltip.setAttribute("aria-live", "polite");
    let index = valid.length - 1;
    function select(row) {
      if (!row) return;
      index = valid.findIndex(item => item[0] === row[0]); const detail = details.get(row[0]);
      guide.setAttribute("x1", x(row[0])); guide.setAttribute("x2", x(row[0])); guide.setAttribute("visibility", "visible");
      dot.setAttribute("cx", x(row[0])); dot.setAttribute("cy", y(row[1])); dot.setAttribute("visibility", "visible"); dot.style.fill = row[1] < 0 ? "var(--down)" : "var(--up)";
      tooltip.textContent = (range === "INTRADAY" ? window.IntradayUtils.clock(row[0]) : row[0]) + " · portefeuille " + delta(detail.portfolio, true) + " · " + benchmarkId + " " + delta(detail.benchmark, true) + " · écart " + points(Math.abs(row[1]) < .005 ? 0 : row[1]);
    }
    svg.addEventListener("focus", () => select(valid[index]));
    svg.addEventListener("keydown", event => {if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); index = event.key === "Home" ? 0 : event.key === "End" ? valid.length - 1 : Math.min(valid.length - 1, Math.max(0, index + (event.key === "ArrowLeft" ? -1 : 1))); select(valid[index]);});
    svg.addEventListener("pointermove", event => {const rect = svg.getBoundingClientRect(); if (!rect.width) return; const position = Math.max(left, Math.min(width - right, (event.clientX - rect.left) * width / rect.width)); select(U.nearestPoint(data, first + (position - left) / (width - left - right) * (last - first)));});
    svg.addEventListener("pointerleave", () => {if (document.activeElement === svg) return; guide.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); tooltip.textContent = hint;});
    host.replaceChildren(svg, tooltip);
  }
  function drawChart(original, comparison) {
    const intraday = range === "INTRADAY";
    const data = comparison.normalized ? comparison.points.map(row => [row.date, row.portfolio]) : original;
    const benchmark = comparison.available ? comparison.points.map(row => [row.date, row.benchmark]) : [];
    const details = new Map(comparison.points.map(row => [row.date, row]));
    const valid = data.filter(row => U.validNumber(row[1]));
    if (!valid.length) {$("#portfolioChart").replaceChildren(el("p", "chart-placeholder", "Un historique complet des cours et du change est nécessaire pour tracer le portefeuille.")); return;}
    const width = intraday ? Math.max(320, Math.min(900, $("#portfolioChart").clientWidth || 900)) : 900;
    const height = 300, left = 85, right = 20, top = 18, bottom = 36;
    const [low, high] = U.niceExtent([...data, ...benchmark]); let firstTime = Date.parse(data[0][0]), lastTime = Date.parse(data.at(-1)[0]);
    if (firstTime === lastTime) {firstTime -= 43200000; lastTime += 43200000;}
    const x = day => left + (Date.parse(day) - firstTime) / (lastTime - firstTime) * (width - left - right);
    const y = value => top + (high - value) / (high - low) * (height - top - bottom);
    const svg = svgEl("svg", {viewBox: "0 0 " + width + " " + height, tabindex: 0, role: "img", "aria-label": "Historique théorique du portefeuille en dollars canadiens. Date, valeur et variation depuis le début de la période au survol. Flèches gauche et droite pour parcourir les valeurs."});
    svg.setAttribute("aria-label", ("Rendement du portefeuille et de FEQT en CAD, hors dividendes. Date, valeur et rendements au survol. Flèches gauche et droite pour parcourir les valeurs.".replaceAll("FEQT", benchmarkId)));
    svg.append(svgEl("title", {}, comparison.normalized ? ("Rendement du portefeuille vs FEQT · même base · %".replaceAll("FEQT", benchmarkId)) : "Valorisation reconstituée des positions actuelles · CAD"));
    for (let i = 0; i < 4; i++) {const value = low + (high - low) * i / 3; svg.append(svgEl("line", {x1: left, x2: width - right, y1: y(value), y2: y(value), class: "chart-grid"}), svgEl("text", {x: left - 10, y: y(value) + 4, "text-anchor": "end", class: "chart-axis"}, U.formatNumber(value, high - low < 10 ? 2 : 0) + (comparison.normalized ? " %" : "")));}
    for (let i = 0; i < 4; i++) {const stamp = firstTime + (lastTime - firstTime) * i / 3; svg.append(svgEl("text", {x: left + (width - left - right) * i / 3, y: height - 9, class: "chart-axis", "text-anchor": i === 0 ? "start" : i === 3 ? "end" : "middle"}, intraday ? window.IntradayUtils.clock(stamp) : new Intl.DateTimeFormat("fr-CA", {timeZone: "UTC", month: "short", day: "numeric"}).format(new Date(stamp))));}
    let path = "", connected = false;
    for (const row of data) {if (!U.validNumber(row[1])) {connected = false; continue;} path += (connected ? "L" : "M") + x(row[0]).toFixed(2) + "," + y(row[1]).toFixed(2); connected = true;}
    svg.append(svgEl("path", {d: path, class: "chart-line"}));
    if (benchmark.length) {let benchmarkPath = "", linked = false; for (const row of benchmark) {if (!U.validNumber(row[1])) {linked = false; continue;} benchmarkPath += (linked ? "L" : "M") + x(row[0]).toFixed(2) + "," + y(row[1]).toFixed(2); linked = true;} svg.append(svgEl("path", {d: benchmarkPath, class: "chart-line chart-benchmark"}));}
    const guide = svgEl("line", {y1: top, y2: height - bottom, class: "chart-guide", visibility: "hidden"}), dot = svgEl("circle", {r: 4, class: "chart-dot", visibility: "hidden"}); svg.append(guide, dot);
    const benchmarkDot = svgEl("circle", {r: 4, class: "chart-dot chart-benchmark-dot", visibility: "hidden"}); svg.append(benchmarkDot);
    const hint = ("Survole le graphique pour comparer le portefeuille et FEQT · flèches ← → au clavier".replaceAll("FEQT", benchmarkId));
    const tooltip = el("p", "chart-tooltip", hint); tooltip.setAttribute("aria-live", "polite"); let index = valid.length - 1;
    const baseline = original[0], canCompare = U.validNumber(baseline[1]) && baseline[1] > 0;
    function select(row) {
      if (!row) return;
      const detail = details.get(row[0]); index = valid.findIndex(item => item[0] === row[0]);
      guide.setAttribute("x1", x(row[0])); guide.setAttribute("x2", x(row[0])); guide.setAttribute("visibility", "visible");
      dot.setAttribute("cx", x(row[0])); dot.setAttribute("cy", y(row[1])); dot.setAttribute("visibility", "visible");
      tooltip.textContent = (intraday ? U.timestampLabel(row[0]) : row[0]) + " · " + money(detail.value) + " CAD · " +
        (canCompare ? delta(detail.portfolio, true) + (intraday ? " depuis la clôture du " + comparison.start : " depuis le " + baseline[0]) : "variation indisponible : base du " + baseline[0] + " manquante");
      if (U.validNumber(detail.benchmark)) {
        benchmarkDot.setAttribute("cx", x(row[0])); benchmarkDot.setAttribute("cy", y(detail.benchmark)); benchmarkDot.setAttribute("visibility", "visible");
        tooltip.textContent += " · " + benchmarkId + " : " + delta(detail.benchmark, true) + " · écart : " + U.formatNumber(detail.portfolio - detail.benchmark, 2) + " pt";
        if (detail.benchmark_date !== row[0]) tooltip.textContent += " (" + (intraday ? "dernière cotation" : "clôture") + " du " + (intraday && detail.benchmark_date?.includes("T") ? window.IntradayUtils.clock(detail.benchmark_date) : detail.benchmark_date) + ")";
      } else {benchmarkDot.setAttribute("visibility", "hidden"); tooltip.textContent += " · " + benchmarkId + " : —";}
    }
    svg.addEventListener("focus", () => select(valid[index]));
    svg.addEventListener("keydown", event => {if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); index = event.key === "Home" ? 0 : event.key === "End" ? valid.length - 1 : Math.min(valid.length - 1, Math.max(0, index + (event.key === "ArrowLeft" ? -1 : 1))); select(valid[index]);});
    svg.addEventListener("pointermove", event => {const rect = svg.getBoundingClientRect(); if (!rect.width) return; const coordinate = Math.max(left, Math.min(width - right, (event.clientX - rect.left) * width / rect.width)); select(U.nearestPoint(data, firstTime + (coordinate - left) / (width - left - right) * (lastTime - firstTime)));});
    svg.addEventListener("pointerleave", () => {if (document.activeElement === svg) return; guide.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); benchmarkDot.setAttribute("visibility", "hidden"); tooltip.textContent = hint;});
    $("#portfolioChart").replaceChildren(svg, tooltip);
  }
  async function refresh() {
    try {
      catalog = await fetchJSON("data/securities.json");
      if (!imported && !profileInitialized) setupPositions();
      await refreshPersonalProfile();
      await Promise.all([
        (async () => {try {prices = P.normalizePrices(await fetchJSON("data/security-prices.json"), catalog); cached = false; save(PRICE_KEY, prices);} catch {prices = P.normalizePrices(stored(PRICE_KEY, null), catalog); cached = true;}})(),
        (async () => {try {exposures = E.normalize(await fetchJSON("data/portfolio-exposures.json")); exposureCached = false; save(EXPOSURE_KEY, exposures);} catch {try {exposures = E.normalize(stored(EXPOSURE_KEY, null)); exposureCached = true;} catch {exposures = null;}}})(),
        (async () => {try {earnings = F.normalizeEarnings(await fetchJSON("data/portfolio-earnings.json"), catalog); earningsCached = false; save(EARNINGS_KEY, earnings);} catch {try {earnings = F.normalizeEarnings(stored(EARNINGS_KEY, null), catalog); earningsCached = true;} catch {earnings = null;}}})(),
      ]);
      history = P.historyFor(positions, prices); render();
    } catch {$("#portfolioStatus").textContent = "Cotations indisponibles. Les positions enregistrées sur cet appareil sont conservées.";}
  }
  $("#portfolioImport").addEventListener("change", async event => {const file = event.target.files[0]; if (!file || !catalog) return; try {if (file.size > 100000) throw new Error("Fichier trop volumineux"); applyPositions(JSON.parse(await file.text()));} catch (error) {$("#portfolioMessage").textContent = "Import impossible : " + error.message;} finally {event.target.value = "";}});
  $("#positionForm").addEventListener("submit", event => {event.preventDefault(); if (!catalog) return; try {const ticker = $("#positionTicker").value; const existing = positions.find(p => p.ticker === ticker); const quantity = Number($("#positionQuantity").value.trim().replace(",", ".")); const costText = $("#positionAverageCost").value.trim(); const average_cost = costText ? Number(costText.replace(",", ".")) : existing?.average_cost; const next = {ticker, quantity, ...(average_cost !== undefined ? {average_cost} : {})}; applyPositions(existing ? positions.map(p => p.ticker === ticker ? next : p) : [...positions, next]); $("#positionQuantity").value = ""; $("#positionAverageCost").value = "";} catch (error) {$("#portfolioMessage").textContent = error.message;}});
  $("#portfolioExport").addEventListener("click", () => {const blob = new Blob([JSON.stringify({schema_version: 1, base_currency: "CAD", portfolio_id: activePortfolio, portfolio_name: portfolioNames[activePortfolio], benchmark: benchmarkId, positions}, null, 2) + "\n"], {type: "application/json"}); const url = URL.createObjectURL(blob), anchor = el("a"); anchor.href = url; anchor.download = "portefeuille-" + portfolioNames[activePortfolio] + "-savy.json"; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);});
  $("#portfolioPositionsToggle").addEventListener("click", () => {positionsVisible = !positionsVisible; save(POSITIONS_VISIBLE_KEY, positionsVisible); renderPositionsVisibility();});
  for (const view of ["Sectors", "Geography"]) $("#portfolio" + view + "Toggle").addEventListener("click", () => {exposureViews[view] = exposureViews[view] !== true; save(EXPOSURE_VIEWS_KEY, exposureViews); renderExposureVisibility();});
  function currentEarningsValuation() {return prices && history.length ? P.valuationAt(positions, prices, history.at(-1)[0], window.SavyLiveFX?.current()) : null;}
  $("#portfolioEarningsTicker").addEventListener("change", event => {earningsTicker = event.target.value; saveView(); renderEarnings(currentEarningsValuation());});
  $("#portfolioEarningsWeek").addEventListener("change", event => {earningsWeek = event.target.value; saveView(); renderEarnings(currentEarningsValuation());});
  $("#portfolioEarningsImage").addEventListener("click", saveEarningsImage);
  for (const item of H.RANGES) {
    const button = el("button", "", item.label); button.type = "button"; button.dataset.range = item.key;
    button.setAttribute("aria-pressed", String(item.key === heatmapRange));
    button.addEventListener("click", () => {heatmapRange = item.key; saveView(); render();});
    $("#portfolioHeatmapRanges").append(button);
  }
  $("#portfolioHeatmapPosition").addEventListener("change", event => selectHeatmap(event.target.value));
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => drawHeatmap()).observe($("#portfolioHeatmapTiles"));
  document.addEventListener("click", event => {
    if (window.SavyPortal) return;
    if (!profileInitialized) return;
    const anchor = event.target.closest?.("a[href^='#']"), hash = anchor?.getAttribute("href");
    if (!["#portfolio", "#indicators"].includes(hash)) return;
    event.preventDefault(); $(hash)?.scrollIntoView({behavior: "smooth"});
  });
  for (const item of P.RANGES) {
    const button = el("button", "", item.label); button.type = "button";
    button.dataset.range = item.key; button.setAttribute("aria-pressed", String(item.key === moversRange));
    button.addEventListener("click", () => {
      moversRange = item.key; saveView();
      for (const other of $("#portfolioMoversRanges").querySelectorAll("button")) other.setAttribute("aria-pressed", String(other === button));
      const label = {"1D": "sur une séance", "1Y": "sur un an", "2Y": "sur deux ans", "5Y": "sur cinq ans", YTD: "depuis le début de l’année", "6M": "sur six mois", "3M": "sur trois mois", "1M": "sur un mois", "1W": "sur une semaine", "3D": "sur trois jours"}[moversRange];
      $("#portfolioMoversTitle").textContent = "Les meilleures et les pires performances " + label;
      if (prices && history.length) render();
    });
    $("#portfolioMoversRanges").append(button);
  }
  for (const button of document.querySelectorAll("[data-portfolio-sort]")) button.addEventListener("click", () => {const key = button.dataset.portfolioSort; sortDescending = key === sortKey ? !sortDescending : true; sortKey = key; saveView(); render();});
  loadView(); renderPortfolioChoice();
  for (const button of document.querySelectorAll("[data-portfolio-id]")) button.addEventListener("click", () => choosePortfolio(button.dataset.portfolioId));
  let chartResize;
  window.addEventListener("resize", () => {
    clearTimeout(chartResize);
    chartResize = setTimeout(() => {if (prices && history.length && !["INPUT", "SELECT"].includes(document.activeElement?.tagName)) {if (range === "INTRADAY") render(); else drawRelativeChart(relativeComparison);}}, 150);
  });
  window.SavyPortfolio = {refresh};
  document.addEventListener("savy:quotes", () => {
    if (prices && history.length && !document.activeElement?.closest("#portfolioRows input")) render();
  });
  document.addEventListener("savy:fx", () => {
    if (prices && history.length && !document.activeElement?.closest("#portfolioRows input")) render();
  });
})();
