(() => {
  "use strict";
  const U = window.MacroUtils;
  const $ = selector => document.querySelector(selector);
  const CACHE_KEY = "savy:macro-data:v2";
  const NEWS_CACHE_KEY = "savy:news-digest:v4";
  const MARKET_CACHE_KEY = "savy:market-indices:v1";
  const MARKET_DEFINITIONS = [
    ["SPX", "S&P 500", "États-Unis", "^GSPC"],
    ["IXIC", "Nasdaq Composite", "États-Unis", "^IXIC"],
    ["TSX", "S&P/TSX Composite", "Canada", "^GSPTSE"],
    ["STOXX600", "STOXX Europe 600", "Europe", "^STOXX"],
    ["EEM", "MSCI émergents · ETF EEM", "Marchés émergents", "EEM"],
  ];
  const PREFS_KEY = "savy:preferences:v2";
  function readStored(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  }
  function writeStored(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Features still work for this session. */ }
  }
  const prefs = readStored(PREFS_KEY, {}) || {};
  const state = {
    dataset: null, seriesById: new Map(), visible: [], origin: "published",
    search: "", category: typeof prefs.category === "string" ? prefs.category : "all",
    range: U.RANGES.some(range => range.key === prefs.range) ? prefs.range : "10Y",
    sort: ["default", "name", "recent"].includes(prefs.sort) ? prefs.sort : "default",
    favorites: new Set(Array.isArray(prefs.favorites) ? prefs.favorites.filter(id => typeof id === "string" && /^[A-Z0-9]+$/.test(id)) : []),
    favoritesOnly: false, theme: prefs.theme === "light" ? "light" : "dark",
    detailId: null, detailRange: "10Y", loading: false,
    marketDataset: null, marketRange: "1Y", marketCached: false,
  };
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function savePreferences() {
    writeStored(PREFS_KEY, { category: state.category, range: state.range, sort: state.sort, favorites: [...state.favorites], theme: state.theme });
  }
  function applyTheme() {
    document.documentElement.dataset.theme = state.theme;
    const label = state.theme === "dark" ? "Mode clair" : "Mode sombre";
    $("#themeToggle").textContent = label;
    $("#themeToggle").setAttribute("aria-label", "Activer le " + label.toLowerCase());
  }
  async function fetchJSON(path) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(path + "?v=" + Date.now(), { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("Fichier indisponible");
      return await response.json();
    } finally { clearTimeout(timeout); }
  }
  async function loadLegacySnapshot() {
    const [config, briefing] = await Promise.all([fetchJSON("data/series.json"), fetchJSON("data/macro-briefing.json")]);
    const snapshots = new Map((briefing.series_snapshot || []).map(point => [point.id, point]));
    const series = config.series.map(definition => {
      const point = snapshots.get(definition.id);
      const valid = definition.transform === "none" && point && U.validNumber(point.value) && U.isDate(point.date);
      return {
        ...definition, value: valid ? point.value : null, date: valid ? point.date : null,
        previous_value: valid ? point.previous_value : null, previous_date: null, change: null,
        history: valid ? [[point.date, point.value]] : [], fetch_status: valid ? "cached" : "unavailable",
        last_successful_fetch: valid ? briefing.last_successful_update : null,
      };
    });
    return U.normalizeDataset({ schema_version: 2, generated_at: briefing.generated_at, last_successful_update: briefing.last_successful_update, update_status: "stale_data_kept", series });
  }
  function renderStatus() {
    const dataset = state.dataset;
    const fresh = dataset.series.filter(point => point.fetch_status === "fresh").length;
    const available = dataset.series.filter(point => point.value !== null).length;
    const age = (Date.now() - U.parseTimestamp(dataset.generated_at)) / 3600000;
    const notice = state.origin === "browser-cache" ? "Copie conservée dans ce navigateur · " :
      state.origin === "legacy" ? "Dernières valeurs conservées; nouvel historique en attente · " : "";
    $("#updated").textContent = notice + "Collecte du " + U.timestampLabel(dataset.generated_at) + " · " +
      fresh + "/" + dataset.series.length + " séries vérifiées" +
      (available < dataset.series.length ? " · " + (dataset.series.length - available) + " indisponible(s)" : "") +
      (age > 36 ? " · collecte ancienne" : "");
    $("#updated").classList.toggle("warning", state.origin !== "published" || fresh !== dataset.series.length || age > 36);
  }
  function renderKpis() {
    const definitions = [
      ["VIXCLS", "VIX · volatilité"], ["DFF", "Fed · taux effectif"], ["CPIAUCSL", "Inflation CPI · 12 mois"],
      ["DGS10", "Trésor US · 10 ans"], ["DEXCAUS", "USD/CAD"], ["V39079", "Canada · taux directeur"],
    ];
    const fragment = document.createDocumentFragment();
    for (const [id, label] of definitions) {
      const point = state.seriesById.get(id);
      const card = el("article", "kpi");
      card.dataset.id = id;
      card.append(el("p", "eyebrow", label));
      card.append(el("p", "kpi-value", point ? U.formatNumber(point.value, point.decimals) + (point.value !== null && point.unit === "%" ? " %" : "") : "—"));
      card.append(el("p", "meta", point ? U.observationLabel(point.date, point.frequency) : "Période non disponible"));
      const change = point ? U.changeLabel(point) : { text: "En attente de collecte", direction: "flat" };
      card.append(el("p", "change " + change.direction, change.text));
      fragment.append(card);
    }
    $("#kpis").replaceChildren(fragment);
  }
  function renderCategories() {
    const categories = [...new Set(state.dataset.series.map(point => point.category))];
    if (!categories.includes(state.category)) state.category = "all";
    const fragment = document.createDocumentFragment();
    for (const category of ["all", ...categories]) {
      const button = el("button", "", category === "all" ? "Tous" : category);
      button.type = "button";
      button.setAttribute("aria-pressed", String(category === state.category));
      button.addEventListener("click", () => {
        state.category = category; savePreferences(); renderCategories(); renderCards();
      });
      fragment.append(button);
    }
    $("#categoryFilters").replaceChildren(fragment);
  }
  function renderRanges(container, selected, onChange) {
    const fragment = document.createDocumentFragment();
    for (const range of U.RANGES) {
      const button = el("button", "", range.label);
      button.type = "button"; button.dataset.range = range.key;
      button.setAttribute("aria-pressed", String(range.key === selected));
      button.addEventListener("click", () => onChange(range.key));
      fragment.append(button);
    }
    container.replaceChildren(fragment);
  }
  const observer = "IntersectionObserver" in window ? new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      const point = state.seriesById.get(entry.target.dataset.id);
      if (point) drawChart(entry.target, point, state.range);
      observer.unobserve(entry.target);
    }
  }, { rootMargin: "250px" }) : null;
  function buildCard(point) {
    const card = el("article", "card indicator-card");
    card.dataset.id = point.id;
    const top = el("div", "card-top");
    top.append(el("span", "category-tag", point.category));
    const favorite = el("button", "favorite-button", state.favorites.has(point.id) ? "★" : "☆");
    favorite.type = "button";
    favorite.setAttribute("aria-pressed", String(state.favorites.has(point.id)));
    favorite.setAttribute("aria-label", (state.favorites.has(point.id) ? "Retirer des favoris : " : "Ajouter aux favoris : ") + point.title);
    favorite.addEventListener("click", () => {
      if (state.favorites.has(point.id)) state.favorites.delete(point.id); else state.favorites.add(point.id);
      savePreferences();
      if (state.favoritesOnly) renderCards();
      else {
        favorite.textContent = state.favorites.has(point.id) ? "★" : "☆";
        favorite.setAttribute("aria-pressed", String(state.favorites.has(point.id)));
        favorite.setAttribute("aria-label", (state.favorites.has(point.id) ? "Retirer des favoris : " : "Ajouter aux favoris : ") + point.title);
      }
    });
    top.append(favorite);
    const title = el("h3", "", point.title);
    const valueRow = el("div", "value-row");
    const value = el("p", "current-value", U.formatNumber(point.value, point.decimals));
    if (point.value !== null) value.append(el("span", "value-unit", " " + point.unit));
    const change = U.changeLabel(point);
    const changeNode = el("p", "change " + change.direction, change.text);
    if (point.previous_date) changeNode.title = "Par rapport à " + U.observationLabel(point.previous_date, point.frequency);
    valueRow.append(value, changeNode);
    const date = el("p", "observation-date", "Observation : " + U.observationLabel(point.date, point.frequency));
    const host = el("div", "chart-host"); host.dataset.id = point.id;
    host.append(el("p", "chart-placeholder", "Chargement du graphique…"));
    const bottom = el("div", "card-bottom");
    const source = el("a", "", point.id + " · " + point.source_label + " ↗");
    source.href = point.source_url; source.target = "_blank"; source.rel = "noopener noreferrer";
    const details = el("button", "detail-button", "Explorer le graphique ↗");
    details.type = "button"; details.setAttribute("aria-label", "Explorer : " + point.title);
    details.addEventListener("click", () => openDetails(point.id));
    bottom.append(source, details);
    card.append(top, title, valueRow, date);
    if (point.fetch_status === "cached") card.append(el("p", "status-note", "Valeur conservée · dernière collecte réussie : " + U.timestampLabel(point.last_successful_fetch)));
    else if (point.fetch_status === "unavailable") card.append(el("p", "status-note", "Source indisponible · aucune valeur valide conservée"));
    else if (U.ageDays(point.date) > point.max_age_days) card.append(el("p", "status-note", "Période éloignée · vérifier le calendrier de publication"));
    card.append(host, bottom);
    return card;
  }
  function renderCards() {
    observer?.disconnect();
    state.visible = U.filterSeries(state.dataset.series, {
      search: state.search, category: state.category, sort: state.sort,
      favorites: state.favorites, favoritesOnly: state.favoritesOnly,
    });
    const fragment = document.createDocumentFragment();
    for (const point of state.visible) fragment.append(buildCard(point));
    $("#grid").replaceChildren(fragment);
    $("#resultCount").textContent = state.visible.length + " / " + state.dataset.series.length + " indicateurs · avant la dernière observation";
    $("#emptyState").hidden = state.visible.length !== 0;
    $("#emptyState").textContent = state.favoritesOnly && !state.favorites.size
      ? "Ajoute des indicateurs avec l’étoile ☆ pour retrouver tes favoris ici."
      : "Aucun indicateur ne correspond. Modifie la recherche ou choisis « Tous ».";
    $("#exportButton").disabled = state.visible.length === 0;
    for (const host of $("#grid").querySelectorAll(".chart-host")) {
      if (observer) observer.observe(host);
      else drawChart(host, state.seriesById.get(host.dataset.id), state.range);
    }
  }
  function svgEl(tag, attributes = {}, text) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function drawChart(host, point, range) {
    const history = U.visibleHistory(point, range);
    const valid = history.filter(row => U.validNumber(row[1]));
    if (!valid.length) {
      host.replaceChildren(el("p", "chart-placeholder", point.value === null ? "Historique indisponible pour cette collecte." : "Historique à venir après la prochaine collecte réussie."));
      return;
    }
    const width = 480, height = 205, left = 57, right = 14, top = 12, bottom = 31;
    const plotWidth = width - left - right, plotHeight = height - top - bottom;
    const [low, high] = U.niceExtent(history);
    let firstTime = Date.parse(history[0][0]), lastTime = Date.parse(history.at(-1)[0]);
    if (firstTime === lastTime) { firstTime -= 43200000; lastTime += 43200000; }
    const x = day => left + (Date.parse(day) - firstTime) / (lastTime - firstTime) * plotWidth;
    const y = value => top + (high - value) / (high - low) * plotHeight;
    const svg = svgEl("svg", { viewBox: "0 0 " + width + " " + height, tabindex: 0, role: "img",
      "aria-label": point.title + ". " + valid.length + " observations. Utiliser les flèches gauche et droite pour parcourir les valeurs." });
    svg.append(svgEl("title", {}, point.title + " · " + point.unit));
    for (let i = 0; i <= 3; i++) {
      const tickValue = low + (high - low) * i / 3, tickY = y(tickValue);
      svg.append(svgEl("line", { x1: left, x2: width - right, y1: tickY, y2: tickY, class: "chart-grid" }));
      svg.append(svgEl("text", { x: left - 8, y: tickY + 4, "text-anchor": "end", class: "chart-axis" }, U.formatNumber(tickValue, Math.min(point.decimals, 2), true)));
    }
    if (low < 0 && high > 0) svg.append(svgEl("line", { x1: left, x2: width - right, y1: y(0), y2: y(0), stroke: "var(--muted)", "stroke-width": 1, "stroke-dasharray": "4 4" }));
    const tickCount = valid.length === 1 ? 1 : 4;
    for (let i = 0; i < tickCount; i++) {
      const fraction = tickCount === 1 ? 0.5 : i / (tickCount - 1);
      const tickTime = firstTime + fraction * (lastTime - firstTime);
      const date = new Date(tickTime);
      const label = new Intl.DateTimeFormat("fr-CA", { timeZone: "UTC",
        ...(range.endsWith("M") ? { month: "short", day: "numeric" } : range === "1Y" ? { month: "short", year: "2-digit" } : { year: "numeric" }),
      }).format(date);
      svg.append(svgEl("text", { x: left + fraction * plotWidth, y: height - 8,
        "text-anchor": tickCount === 1 ? "middle" : i === 0 ? "start" : i === tickCount - 1 ? "end" : "middle", class: "chart-axis" }, label));
    }
    let path = "", segment = false;
    for (const [day, value] of history) {
      if (value === null) { segment = false; continue; }
      path += (segment ? "L" : "M") + x(day).toFixed(2) + "," + y(value).toFixed(2);
      segment = true;
    }
    svg.append(svgEl("path", { d: path, class: "chart-line" }));
    const latest = valid.at(-1);
    svg.append(svgEl("circle", { cx: x(latest[0]), cy: y(latest[1]), r: 3.5, class: "chart-dot" }));
    const guide = svgEl("line", { x1: 0, x2: 0, y1: top, y2: height - bottom, class: "chart-guide", visibility: "hidden" });
    const selectedDot = svgEl("circle", { cx: 0, cy: 0, r: 4, class: "chart-dot", visibility: "hidden" });
    svg.append(guide, selectedDot);
    const tooltip = el("p", "chart-tooltip");
    const hint = valid.length === 1 ? "Une observation disponible sur cette période." : "Survole le graphique · flèches ← → au clavier";
    tooltip.textContent = hint;
    let selected = valid.length - 1;
    function selectRow(row) {
      if (!row) return;
      guide.setAttribute("x1", x(row[0])); guide.setAttribute("x2", x(row[0])); guide.setAttribute("visibility", "visible");
      selectedDot.setAttribute("cx", x(row[0])); selectedDot.setAttribute("cy", y(row[1])); selectedDot.setAttribute("visibility", "visible");
      tooltip.textContent = U.observationLabel(row[0], point.frequency) + " · " + U.formatNumber(row[1], point.decimals) + " " + point.unit;
      selected = valid.findIndex(item => item[0] === row[0]);
    }
    svg.addEventListener("pointermove", event => {
      const rect = svg.getBoundingClientRect();
      if (!rect.width) return;
      const coordinate = Math.max(left, Math.min(width - right, (event.clientX - rect.left) * width / rect.width));
      selectRow(U.nearestPoint(history, firstTime + (coordinate - left) / plotWidth * (lastTime - firstTime)));
    });
    svg.addEventListener("pointerleave", () => {
      if (document.activeElement === svg) return;
      guide.setAttribute("visibility", "hidden"); selectedDot.setAttribute("visibility", "hidden"); tooltip.textContent = hint;
    });
    svg.addEventListener("focus", () => selectRow(valid[selected]));
    svg.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      if (event.key === "Home") selected = 0;
      else if (event.key === "End") selected = valid.length - 1;
      else selected = Math.max(0, Math.min(valid.length - 1, selected + (event.key === "ArrowLeft" ? -1 : 1)));
      selectRow(valid[selected]);
    });
    host.replaceChildren(svg, tooltip);
  }
  function updateDetail() {
    const point = state.seriesById.get(state.detailId);
    if (!point) return;
    $("#detailTitle").textContent = point.title;
    $("#detailCategory").textContent = point.category + " · " + point.id;
    $("#detailMeta").textContent = "Observation : " + U.observationLabel(point.date, point.frequency) + " · Collecte : " + U.timestampLabel(point.last_successful_fetch);
    $("#detailValue").textContent = U.formatNumber(point.value, point.decimals) + (point.value !== null ? " " + point.unit : "");
    $("#detailDescription").textContent = point.description;
    $("#detailSource").href = point.source_url;
    $("#detailSource").textContent = "Voir la série originale · " + point.source_label + " ↗";
    renderRanges($("#detailRanges"), state.detailRange, range => { state.detailRange = range; updateDetail(); });
    drawChart($("#detailChart"), point, state.detailRange);
    const fragment = document.createDocumentFragment();
    const rows = U.visibleHistory(point, state.detailRange).filter(row => U.validNumber(row[1])).slice(-10).reverse();
    for (const row of rows) {
      const tr = el("tr");
      tr.append(el("td", "", U.observationLabel(row[0], point.frequency)), el("td", "", U.formatNumber(row[1], point.decimals) + " " + point.unit));
      fragment.append(tr);
    }
    $("#detailTable").replaceChildren(fragment);
    $("#detailExport").disabled = rows.length === 0;
  }
  function openDetails(id) {
    state.detailId = id; state.detailRange = state.range; updateDetail();
    $("#detailDialog").showModal();
  }
  function downloadCSV(content, filename) {
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    const anchor = el("a"); anchor.href = url; anchor.download = filename;
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function newsURL(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch { return false; }
  }
  function validateBriefing(briefing) {
    const ids = ["reuters-markets", "reuters-economy", "bank-of-canada", "fred-indicators"];
    const stamp = U.parseTimestamp(briefing?.generated_at);
    if (!briefing || briefing.schema_version !== 3 || briefing.kind !== "news_digest" ||
        briefing.language !== "fr" || briefing.timezone !== "America/Toronto" || !U.isDate(briefing.edition_date) ||
        !Number.isFinite(stamp) || stamp > Date.now() + 300000 || !Array.isArray(briefing.sources) || briefing.sources.length !== ids.length) throw new Error("Briefing invalide");
    if (new Intl.DateTimeFormat("en-CA", {timeZone: "America/Toronto"}).format(new Date(stamp)) !== briefing.edition_date) throw new Error("Date d’édition incohérente");
    const seen = new Set();
    let words = 0;
    for (const source of briefing.sources) {
      if (!source || !ids.includes(source.id) || seen.has(source.id) || !newsURL(source.url) ||
          typeof source.label !== "string" || !source.label.trim() || typeof source.summary !== "string" || !source.summary.trim() ||
          !["available", "partial", "unavailable"].includes(source.status) || !Array.isArray(source.articles) ||
          (source.status !== "unavailable" && source.articles.length === 0)) throw new Error("Source du briefing invalide");
      seen.add(source.id); words += source.summary.trim().split(/\s+/u).length;
      for (const article of source.articles) {
        if (!article || !newsURL(article.url) || typeof article.title !== "string" || !article.title.trim() ||
            !U.isDate(article.published_date) || article.published_date > briefing.edition_date) throw new Error("Publication invalide");
      }
    }
    if (words !== 500 || briefing.word_count !== words) throw new Error("Le briefing doit contenir 500 mots");
    return briefing;
  }
  function newsLink(label, url) {
    const link = el("a", "", label);
    link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer";
    return link;
  }
  async function loadBriefing() {
    let briefing, cached = false;
    try {
      briefing = validateBriefing(await fetchJSON("data/daily-briefing.json"));
      writeStored(NEWS_CACHE_KEY, briefing);
    } catch {
      try { briefing = validateBriefing(readStored(NEWS_CACHE_KEY, null)); cached = true; }
      catch {
        $("#briefingDate").textContent = "Édition indisponible";
        $("#briefingParagraph").textContent = "Le briefing d’actualité n’a pas pu être chargé. Réessaie avec « Actualiser ».";
        $("#briefingNote").textContent = "Aucun résumé d’actualité vérifié n’est disponible dans ce navigateur.";
        $("#briefingLinks").replaceChildren(); return;
      }
    }
    const today = new Intl.DateTimeFormat("en-CA", {timeZone: "America/Toronto"}).format(new Date());
    const old = briefing.edition_date < today;
    $("#briefingDate").textContent = (cached ? "Copie conservée · " : "") + "Édition du " + briefing.edition_date + " · " + briefing.word_count +
      " mots · Publié le " + U.timestampLabel(briefing.generated_at) + (old ? " · nouvelle édition en attente" : "");
    $("#briefingDate").classList.toggle("warning", cached || old);
    const fragment = document.createDocumentFragment(), links = document.createDocumentFragment();
    for (const source of briefing.sources) {
      const section = el("section", "news-section" + (source.status === "unavailable" ? " news-unavailable" : ""));
      section.append(el("h3", "", source.label + (source.status === "unavailable" ? " · accès indisponible" : source.status === "partial" ? " · lecture partielle" : "")), el("p", "", source.summary));
      const articles = el("ul", "news-links");
      for (const article of source.articles) {
        const li = el("li");
        li.append(newsLink(article.title, article.url), el("span", "muted", " · " + article.published_date));
        articles.append(li);
      }
      section.append(articles); fragment.append(section);
      const li = el("li"); li.append(newsLink(source.label, source.url)); links.append(li);
    }
    $("#briefingParagraph").replaceChildren(fragment);
    $("#briefingLinks").replaceChildren(links);
    const unavailable = briefing.sources.filter(source => source.status === "unavailable").length;
    $("#briefingNote").textContent = (cached ? "Actualisation indisponible : dernière édition vérifiée conservée. " : "") +
      (unavailable ? unavailable + " source(s) inaccessible(s), indiquée(s) ci-dessus. " : "") + (briefing.editorial_note || "");
  }

  function normalizeMarkets(payload) {
    if (payload?.kind !== "market_indices" || U.parseTimestamp(payload.generated_at) > Date.now() + 300000 ||
        !Array.isArray(payload.series) || payload.series.length !== MARKET_DEFINITIONS.length) throw new Error("Indices invalides");
    const data = U.normalizeDataset(payload);
    const byId = new Map(data.series.map(point => [point.id, point]));
    data.series = MARKET_DEFINITIONS.map(([id, title, category, symbol]) => {
      const point = byId.get(id);
      if (!point || point.quote_symbol !== symbol) throw new Error("Indice attendu absent");
      const valid = point.history.filter(row => U.validNumber(row[1]));
      if (point.value !== null && (valid.length < 2 || valid.at(-1)[0] !== point.date || valid.at(-1)[1] !== point.value || point.value <= 0)) throw new Error("Clôture incohérente");
      return {...point, title, category, frequency: "daily", unit: id === "EEM" ? "$ US" : "points", decimals: 2,
        source_url: "https://finance.yahoo.com/quote/" + encodeURIComponent(symbol) + "/"};
    });
    if (!data.series.some(point => point.value !== null)) throw new Error("Aucun indice vérifié");
    return data;
  }
  function renderMarkets() {
    const ranges = document.createDocumentFragment();
    for (const range of U.RANGES) {
      const button = el("button", "", range.label);
      button.type = "button"; button.setAttribute("aria-pressed", String(range.key === state.marketRange));
      button.addEventListener("click", () => {state.marketRange = range.key; renderMarkets();});
      ranges.append(button);
    }
    $("#marketRanges").replaceChildren(ranges);
    const data = state.marketDataset;
    const available = data?.series.filter(point => point.value !== null).length || 0;
    $("#marketStatus").textContent = data ? (state.marketCached ? "Copie conservée · " : "") +
      "Collecte du " + U.timestampLabel(data.generated_at) + " · " + available + "/5 marchés disponibles" : "Cotations indisponibles. Réessaie avec « Actualiser » ou consulte les sources ci-dessous.";
    const oldCollection = data && Date.now() - U.parseTimestamp(data.generated_at) > 36 * 3600000;
    if (oldCollection) $("#marketStatus").textContent += " · collecte ancienne";
    $("#marketStatus").classList.toggle("warning", !data || state.marketCached || available !== 5 || oldCollection);
    const fragment = document.createDocumentFragment();
    for (const [id, title, category, symbol] of MARKET_DEFINITIONS) {
      const point = data?.series.find(item => item.id === id);
      const card = el("article", "market-card"); card.dataset.id = id;
      card.append(el("p", "eyebrow", category), el("h4", "", title));
      card.append(el("p", "market-value", point ? U.formatNumber(point.value, 2) + (point.value !== null && id === "EEM" ? " $ US" : "") : "—"));
      const old = point?.date && Date.now() - Date.parse(point.date) > 7 * 86400000;
      card.append(el("p", "meta" + (old || point?.fetch_status === "cached" ? " warning" : ""),
        point?.date ? "Clôture du " + point.date + (old ? " · observation ancienne" : "") + (point.fetch_status === "cached" ? " · dernière valeur conservée" : "") : "Clôture indisponible"));
      if (point && U.validNumber(point.change) && U.validNumber(point.previous_value) && point.previous_value > 0) {
        const change = el("p", "change " + (point.change > 0 ? "up" : point.change < 0 ? "down" : "flat"),
          (point.change > 0 ? "+" : "") + U.formatNumber(point.change / point.previous_value * 100, 2) + " % · " +
          (point.change > 0 ? "+" : "") + U.formatNumber(point.change, 2) + (id === "EEM" ? " $ US" : " pts"));
        change.title = "Par rapport à la clôture du " + point.previous_date; card.append(change);
      }
      const host = el("div", "chart-host");
      if (point) drawChart(host, point, state.marketRange);
      else host.append(el("p", "chart-placeholder", "Historique indisponible pour cette collecte."));
      const link = el("a", "", "Voir " + (id === "EEM" ? "l’ETF" : "cet indice") + " sur Yahoo Finance ↗");
      link.href = "https://finance.yahoo.com/quote/" + encodeURIComponent(symbol) + "/";
      link.target = "_blank"; link.rel = "noopener noreferrer";
      card.append(host, link); fragment.append(card);
    }
    $("#marketGrid").replaceChildren(fragment);
  }
  async function loadMarkets() {
    try {
      state.marketDataset = normalizeMarkets(await fetchJSON("data/market-indices.json"));
      state.marketCached = false; writeStored(MARKET_CACHE_KEY, state.marketDataset);
    } catch {
      try {state.marketDataset = normalizeMarkets(readStored(MARKET_CACHE_KEY, null)); state.marketCached = true;}
      catch {state.marketDataset = null; state.marketCached = false;}
    }
    renderMarkets();
  }
  async function loadDataset() {
    if (state.loading) return;
    state.loading = true; $("#refreshButton").disabled = true; $("#refreshButton").textContent = "Actualisation…";
    try {
      let dataset, origin = "published";
      try { dataset = U.normalizeDataset(await fetchJSON("data/macro-data.json")); }
      catch {
        try { dataset = U.normalizeDataset(readStored(CACHE_KEY, null)); origin = "browser-cache"; }
        catch { dataset = await loadLegacySnapshot(); origin = "legacy"; }
      }
      dataset.series = dataset.series.filter(point => point.id !== "SP500");
      state.dataset = dataset; state.origin = origin;
      state.seriesById = new Map(dataset.series.map(point => [point.id, point]));
      if (origin === "published") writeStored(CACHE_KEY, dataset);
      renderStatus(); renderKpis(); renderCategories(); renderCards();
      if ($("#detailDialog").open) updateDetail();
    } catch {
      if (state.dataset) {
        $("#updated").textContent = "Actualisation indisponible · les dernières données affichées sont conservées.";
        $("#updated").classList.add("warning");
      } else {
        $("#updated").textContent = "Les fichiers de données ne sont pas disponibles. Réessaie avec « Actualiser ».";
        $("#updated").classList.add("warning");
      }
    } finally {
      await Promise.all([loadBriefing(), loadMarkets(), window.SavyPortfolio?.refresh()]);
      state.loading = false; $("#refreshButton").disabled = false; $("#refreshButton").textContent = "Actualiser";
    }
  }
  $("#refreshButton").addEventListener("click", loadDataset);
  $("#themeToggle").addEventListener("click", () => { state.theme = state.theme === "dark" ? "light" : "dark"; applyTheme(); savePreferences(); });
  $("#searchInput").addEventListener("input", event => { state.search = event.target.value; if (state.dataset) renderCards(); });
  $("#sortSelect").value = state.sort;
  $("#sortSelect").addEventListener("change", event => { state.sort = event.target.value; savePreferences(); if (state.dataset) renderCards(); });
  $("#favoritesOnly").addEventListener("click", event => {
    state.favoritesOnly = !state.favoritesOnly; event.currentTarget.setAttribute("aria-pressed", String(state.favoritesOnly));
    if (state.dataset) renderCards();
  });
  $("#exportButton").addEventListener("click", () => downloadCSV(U.snapshotCSV(state.visible), "SAVY-indicateurs-" + new Date().toISOString().slice(0, 10) + ".csv"));
  $("#detailExport").addEventListener("click", () => {
    const point = state.seriesById.get(state.detailId);
    if (point) downloadCSV(U.historyCSV(point, state.detailRange), "SAVY-" + point.id + "-" + state.detailRange + ".csv");
  });
  $("#closeDialog").addEventListener("click", () => $("#detailDialog").close());
  $("#closeImage").addEventListener("click", () => $("#imageDialog").close());
  for (const dialog of document.querySelectorAll("dialog")) dialog.addEventListener("click", event => {
    const rect = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
  });
  for (const button of document.querySelectorAll(".image-open")) button.addEventListener("click", () => {
    $("#expandedImage").src = button.dataset.image; $("#expandedImage").alt = button.dataset.title;
    $("#imageDialog").showModal();
  });
  document.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault(); $("#searchInput").focus();
    }
  });
  renderRanges($("#rangeControls"), state.range, setGlobalRange);
  function setGlobalRange(range) {
    state.range = range; savePreferences();
    renderRanges($("#rangeControls"), range, setGlobalRange);
    if (state.dataset) renderCards();
  }
  applyTheme(); loadDataset();
  setInterval(() => { if (document.visibilityState === "visible") loadDataset(); }, 15 * 60 * 1000);
})();
