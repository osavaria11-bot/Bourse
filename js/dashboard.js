(() => {
  "use strict";
  const U = window.MacroUtils;
  const $ = selector => document.querySelector(selector);
  const CACHE_KEY = "savy:macro-data:v2";
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
    const [config, briefing] = await Promise.all([fetchJSON("data/series.json"), fetchJSON("data/daily-briefing.json")]);
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
      ["SP500", "S&P 500"], ["DFF", "Fed · taux effectif"], ["CPIAUCSL", "Inflation CPI · 12 mois"],
      ["DGS10", "Trésor US · 10 ans"], ["DEXCAUS", "USD/CAD"],
    ];
    const fragment = document.createDocumentFragment();
    for (const [id, label] of definitions) {
      const point = state.seriesById.get(id);
      const card = el("article", "kpi");
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
    const source = el("a", "", point.id + " · FRED ↗");
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
  function fallbackBriefing() {
    return ["CPIAUCSL", "PCEPILFE", "UNRATE", "GDPC1", "T10Y2Y", "SP500", "DEXCAUS"]
      .map(id => state.seriesById.get(id)).filter(point => point && point.value !== null)
      .map(point => point.title + " : " + U.formatNumber(point.value, point.decimals) + " " + point.unit + " (" + U.observationLabel(point.date, point.frequency) + ")").join("; ") + ".";
  }
  async function loadBriefing() {
    let briefing = null;
    try { briefing = await fetchJSON("data/daily-briefing.json"); } catch { /* The dataset also contains verified observations. */ }
    if (!state.dataset) return;
    const matches = briefing && briefing.schema_version === 2 && U.parseTimestamp(briefing.generated_at) === U.parseTimestamp(state.dataset.generated_at);
    $("#briefingDate").textContent = "Collecte : " + U.timestampLabel(state.dataset.generated_at) + ". Chaque période est précisée ci-dessous.";
    $("#briefingParagraph").textContent = matches ? briefing.briefing_paragraph : fallbackBriefing();
    const cached = state.dataset.series.filter(point => point.fetch_status === "cached").length;
    $("#briefingNote").textContent = (cached ? cached + " série(s) utilisent une valeur conservée. " : "") +
      "Les liens de veille complètent les statistiques; ils ne constituent pas un résumé automatique de l’actualité.";
    const fragment = document.createDocumentFragment();
    for (const source of briefing?.news_sources || []) {
      if (!source || typeof source.url !== "string" || !source.url.startsWith("https://")) continue;
      const li = el("li"), link = el("a", "", source.label || "Source");
      link.href = source.url; link.target = "_blank"; link.rel = "noopener noreferrer";
      if (source.description) link.title = source.description;
      li.append(link); fragment.append(li);
    }
    $("#briefingLinks").replaceChildren(fragment);
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
      state.dataset = dataset; state.origin = origin;
      state.seriesById = new Map(dataset.series.map(point => [point.id, point]));
      if (origin === "published") writeStored(CACHE_KEY, dataset);
      renderStatus(); renderKpis(); renderCategories(); renderCards();
      if ($("#detailDialog").open) updateDetail();
      await loadBriefing();
    } catch {
      if (state.dataset) {
        $("#updated").textContent = "Actualisation indisponible · les dernières données affichées sont conservées.";
        $("#updated").classList.add("warning");
      } else {
        $("#updated").textContent = "Les fichiers de données ne sont pas disponibles. Réessaie avec « Actualiser ».";
        $("#updated").classList.add("warning");
        $("#briefingParagraph").textContent = "Le briefing apparaîtra après une collecte réussie.";
      }
    } finally {
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
