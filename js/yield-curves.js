(() => {
  "use strict";
  const C = window.YieldCurveUtils, U = window.MacroUtils, $ = selector => document.querySelector(selector);
  const CACHE = "savy:yield-curves:v1", PREFS = "savy:yield-curve-dates:v1";
  let data = null, cached = false, dates = null, pending = null, models = [];
  const selected = new Map();
  function stored(key) {try {return JSON.parse(localStorage.getItem(key));} catch {return null;}}
  function save(key, value) {try {localStorage.setItem(key, JSON.stringify(value));} catch { /* Current view remains usable. */ }}
  function el(tag, className, text) {const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;}
  function svgEl(tag, attrs, text) {const node = document.createElementNS("http://www.w3.org/2000/svg", tag); for (const [key, value] of Object.entries(attrs || {})) node.setAttribute(key, String(value)); if (text !== undefined) node.textContent = text; return node;}
  function rate(value) {return U.validNumber(value) ? U.formatNumber(value, 2) + " %" : "N/D";}
  function bp(value) {return U.validNumber(value) ? (value > .005 ? "+" : "") + U.formatNumber(Math.abs(value) < .005 ? 0 : value, 1) + " pb" : "N/D";}
  function validDates(value) {return value && [value.a, value.b].every(day => U.isDate(day) && day >= C.START && day <= C.localDay());}
  function enableControls(enabled) {for (const node of document.querySelectorAll(".yield-date-controls input,.yield-date-controls button")) node.disabled = !enabled;}
  function applyDates(value, persist = true) {
    if (!validDates(value)) {
      $("#yieldDateError").hidden = false; $("#yieldDateError").textContent = "Choisis deux dates valides entre le 1er janvier 2016 et aujourd’hui.";
      for (const [key, id] of [["a", "#yieldDateA"], ["b", "#yieldDateB"]]) $(id).setAttribute("aria-invalid", String(!validDates({a: value[key], b: value[key]})));
      return false;
    }
    dates = {...value}; $("#yieldDateError").hidden = true;
    for (const [key, id] of [["a", "#yieldDateA"], ["b", "#yieldDateB"]]) {$(id).value = dates[key]; $(id).setAttribute("aria-invalid", "false");}
    if (persist) save(PREFS, dates);
    render(); return true;
  }
  function dateLabel(snapshot, requested) {
    return !snapshot ? "Aucune observation au " + requested : snapshot.date + (snapshot.adjusted ? " (demandé : " + requested + ")" : "");
  }
  function render() {
    if (!data || !dates) return;
    models = data.countries.map(country => C.comparison(country, dates.a, dates.b));
    const opened = new Set([...document.querySelectorAll("#yieldCurveGrid details[open]")].map(node => node.id));
    const focusedCountry = document.activeElement?.closest("[data-yield-country]")?.dataset.yieldCountry;
    const fragment = document.createDocumentFragment();
    for (const model of models) {
      const country = model.country, card = el("article", "yield-curve-card"); card.dataset.yieldCountry = country.id;
      const title = el("h3", "", country.title); title.id = "yieldTitle" + country.id; card.setAttribute("aria-labelledby", title.id); card.append(title);
      const legend = el("div", "yield-chart-legend");
      legend.append(el("span", "yield-date-a", "A · " + dateLabel(model.a, dates.a)), el("span", "yield-date-b", "B · " + dateLabel(model.b, dates.b))); card.append(legend);
      const warning = el("p", "meta"), missing = model.rows.filter(row => row.a === null || row.b === null).map(row => row.label);
      warning.textContent = (!model.a || !model.b ? "Comparaison incomplète. " : model.a.date === model.b.date ? "Les deux dates utilisent la même séance. " : "") +
        (missing.length ? "N/D : " + missing.join(", ") + ". " : "") +
        (country.fetch_status !== "fresh" || cached ? "Copie conservée · " : "Vérifié · ") +
        (country.last_successful_fetch ? U.timestampLabel(country.last_successful_fetch) : "source indisponible");
      if (!model.a || !model.b || missing.length || cached || country.fetch_status !== "fresh") warning.classList.add("warning"); card.append(warning);
      const metrics = el("div", "yield-metrics");
      for (const key of ["2Y", "10Y"]) {
        const row = model.rows.find(item => item.key === key), metric = el("div");
        metric.append(el("span", "meta", row.label + " · Δ B − A"), el("strong", "", bp(row.change_bp)), el("span", "meta", rate(row.a) + " → " + rate(row.b))); metrics.append(metric);
      }
      for (const [name, slope] of [["Pente 10 ans − 2 ans", model.slope_2_10], ["Pente 10 ans − 3 mois", model.slope_3m_10]]) {
        const metric = el("div"); metric.append(el("span", "meta", name), el("strong", "", bp(slope.b)), el("span", "meta", "A : " + bp(slope.a) + " · Δ " + bp(slope.change_bp))); metrics.append(metric);
      }
      card.append(metrics);
      const chart = el("div", "yield-chart"); chart.id = "yieldChart" + country.id; card.append(chart);
      const tableDetails = el("details", "yield-table-details"); tableDetails.id = "yieldTable" + country.id; tableDetails.open = opened.has(tableDetails.id);
      tableDetails.append(el("summary", "", "Tous les taux et les écarts par échéance"));
      const wrap = el("div", "table-wrap"), table = el("table"), caption = el("caption", "sr-only", country.title + " · rendements en % et écarts B moins A en points de base");
      const head = el("thead"), header = el("tr");
      for (const label of ["Échéance", "A · " + (model.a?.date || "N/D"), "B · " + (model.b?.date || "N/D"), "Δ (pb)"]) {const th = el("th", "", label); th.scope = "col"; header.append(th);}
      head.append(header); const body = el("tbody");
      for (const row of model.rows) {const tr = el("tr"); tr.dataset.tenor = row.key; const th = el("th", "", row.label); th.scope = "row"; tr.append(th, el("td", "yield-date-a", rate(row.a)), el("td", "yield-date-b", rate(row.b)), el("td", "", bp(row.change_bp))); body.append(tr);}
      table.append(caption, head, body); wrap.append(table); tableDetails.append(wrap); card.append(tableDetails);
      const sources = el("details", "yield-sources"); sources.id = "yieldSources" + country.id; sources.open = opened.has(sources.id); sources.append(el("summary", "", "Sources et méthode"), el("p", "meta", country.methodology));
      const link = el("a", "", country.source_label + " ↗"); link.href = country.source_url; link.target = "_blank"; link.rel = "noopener noreferrer"; sources.append(link);
      if (country.id === "CA") {const bill = el("a", "", "Bons du Trésor · Banque du Canada ↗"); bill.href = "https://www.bankofcanada.ca/rates/interest-rates/t-bill-yields/"; bill.target = "_blank"; bill.rel = "noopener noreferrer"; sources.append(bill);}
      sources.append(el("p", "meta", "Échéances espacées uniformément sur l’axe horizontal. Les lignes relient les taux publiés; aucun taux manquant n’est estimé.")); card.append(sources); fragment.append(card);
    }
    $("#yieldCurveGrid").replaceChildren(fragment);
    $("#yieldStatus").textContent = (cached ? "Copie conservée dans ce navigateur · " : "") + "Collecte du " + U.timestampLabel(data.generated_at) + " · historique depuis 2016 · " + data.countries.map(country => country.id + " : " + (country.history.at(-1)?.[0] || "indisponible")).join(" · ");
    $("#yieldStatus").classList.toggle("warning", cached || data.countries.some(country => country.fetch_status !== "fresh"));
    drawCharts();
    if (focusedCountry) $("#yieldChart" + focusedCountry + " svg")?.focus({preventScroll: true});
  }
  function drawCharts() {
    const allValues = models.flatMap(model => model.rows.flatMap(row => [row.a, row.b])).filter(U.validNumber);
    const min = allValues.length ? Math.floor((Math.min(...allValues) - .2) * 2) / 2 : 0;
    const max = allValues.length ? Math.ceil((Math.max(...allValues) + .2) * 2) / 2 : 1;
    for (const model of models) {
      const host = $("#yieldChart" + model.country.id); if (!host) continue;
      const focus = host.contains(document.activeElement);
      if (!model.rows.some(row => U.validNumber(row.a) || U.validNumber(row.b))) {host.replaceChildren(el("p", "chart-placeholder", "Aucune observation disponible pour ces dates.")); continue;}
      const width = Math.max(250, host.clientWidth || 600), height = 275, left = 45, right = 17, top = 16, bottom = 42;
      const x = index => left + index / (model.rows.length - 1) * (width - left - right), y = value => top + (max - value) / (max - min) * (height - top - bottom);
      const svg = svgEl("svg", {viewBox: "0 0 " + width + " " + height, role: "img", tabindex: "0", "aria-label": model.country.title + ". Courbes aux dates A et B. Flèches gauche et droite pour parcourir les échéances."});
      svg.append(svgEl("title", {}, model.country.title + " · A : " + (model.a?.date || "N/D") + " · B : " + (model.b?.date || "N/D")));
      for (let index = 0; index <= 4; index++) {const value = min + (max - min) * index / 4; svg.append(svgEl("line", {x1: left, x2: width - right, y1: y(value), y2: y(value), class: "yield-grid-line"}), svgEl("text", {x: left - 8, y: y(value) + 4, "text-anchor": "end", class: "yield-axis"}, U.formatNumber(value, 1) + "%"));}
      model.rows.forEach((row, index) => {
        if (width < 430 && index % 2 && index !== model.rows.length - 1) return;
        const text = row.key === "LONG" ? "Long" : row.key.replace("M", "m").replace("Y", "a");
        svg.append(svgEl("text", {x: x(index), y: height - 20, "text-anchor": "middle", class: "yield-axis"}, text));
      });
      for (const name of ["a", "b"]) {
        let path = "", gap = true;
        model.rows.forEach((row, index) => {
          if (!U.validNumber(row[name])) {gap = true; return;}
          path += (gap ? "M" : "L") + x(index).toFixed(2) + "," + y(row[name]).toFixed(2); gap = false;
          svg.append(svgEl("circle", {cx: x(index), cy: y(row[name]), r: 3.2, class: "yield-dot yield-" + name}));
        });
        if (path) svg.prepend(svgEl("path", {d: path, class: "yield-line yield-" + name}));
      }
      const marker = svgEl("line", {y1: top, y2: height - bottom, class: "yield-marker"}); svg.append(marker);
      const tooltip = el("p", "yield-tooltip"); tooltip.setAttribute("aria-live", "polite");
      function choose(index) {
        selected.set(model.country.id, index); const row = model.rows[index]; marker.setAttribute("x1", x(index)); marker.setAttribute("x2", x(index));
        tooltip.textContent = row.label + " · A : " + rate(row.a) + " · B : " + rate(row.b) + " · Δ " + bp(row.change_bp);
      }
      function point(event) {const rect = svg.getBoundingClientRect(); const relative = (event.clientX - rect.left) * width / rect.width; choose(Math.max(0, Math.min(model.rows.length - 1, Math.round((relative - left) / (width - left - right) * (model.rows.length - 1)))));}
      svg.addEventListener("pointermove", point); svg.addEventListener("pointerdown", point);
      svg.addEventListener("keydown", event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault();
        const index = selected.get(model.country.id) ?? 0;
        choose(event.key === "Home" ? 0 : event.key === "End" ? model.rows.length - 1 : Math.max(0, Math.min(model.rows.length - 1, index + (event.key === "ArrowRight" ? 1 : -1))));
      });
      host.replaceChildren(svg, tooltip); choose(Math.min(selected.get(model.country.id) ?? model.rows.findIndex(row => row.key === "10Y"), model.rows.length - 1));
      if (focus) svg.focus({preventScroll: true});
    }
  }
  async function refresh() {
    if (pending) return pending;
    pending = (async () => {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch("data/yield-curves.json?v=" + Date.now(), {cache: "no-store", signal: controller.signal});
        if (!response.ok) throw new Error("Courbes indisponibles");
        const next = C.normalize(await response.json());
        if (!data || U.parseTimestamp(next.generated_at) >= U.parseTimestamp(data.generated_at)) {data = next; cached = false; save(CACHE, next);}
      } catch {
        cached = true;
        if (!data) try {data = C.normalize(stored(CACHE));} catch { /* No fabricated curve. */ }
      } finally {clearTimeout(timer);}
      if (!data) {$("#yieldStatus").textContent = "Courbes indisponibles. Réessaie avec « Actualiser »."; $("#yieldStatus").classList.add("warning"); enableControls(false); return;}
      for (const id of ["#yieldDateA", "#yieldDateB"]) {$(id).min = C.START; $(id).max = C.localDay();}
      enableControls(true);
      if (!dates) {const saved = stored(PREFS), defaults = C.defaults(data); if (!defaults) {enableControls(false); $("#yieldStatus").textContent = "Aucune observation collectée."; return;} applyDates(validDates(saved) ? saved : defaults, false);}
      else render();
    })();
    try {await pending;} finally {pending = null;}
  }
  for (const id of ["#yieldDateA", "#yieldDateB"]) $(id).addEventListener("change", () => applyDates({a: $("#yieldDateA").value, b: $("#yieldDateB").value}));
  $("#yieldSwap").addEventListener("click", () => {if (dates) applyDates({a: dates.b, b: dates.a});});
  for (const button of document.querySelectorAll("[data-yield-preset]")) button.addEventListener("click", () => {if (data) applyDates(C.defaults(data, button.dataset.yieldPreset));});
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => drawCharts()).observe($("#yieldCurveGrid"));
  enableControls(false); window.SavyYieldCurves = {refresh};
})();
