(() => {
  "use strict";
  const P = window.PortfolioUtils, U = window.MacroUtils, $ = selector => document.querySelector(selector);
  const HOLDINGS_KEY = "savy:private-holdings:v1", PRICE_KEY = "savy:security-prices:v1", POSITIONS_VISIBLE_KEY = "savy:portfolio-positions-visible:v1";
  let catalog = null, prices = null, cached = false, range = "YTD", positions = [], history = [], imported = false;
  let positionsVisible = stored(POSITIONS_VISIBLE_KEY, false) === true, sortKey = null, sortDescending = true;
  const importFragment = new URLSearchParams(location.hash.slice(1)).get("positions");
  function stored(key, fallback) {try {return JSON.parse(localStorage.getItem(key)) ?? fallback;} catch {return fallback;}}
  function save(key, value) {try {localStorage.setItem(key, JSON.stringify(value)); return true;} catch {return false;}}
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
    const next = P.normalizePositions(input, catalog);
    positions = next;
    $("#portfolioMessage").textContent = save(HOLDINGS_KEY, {schema_version: 1, base_currency: "CAD", positions}) ?
      positions.length + " positions enregistrées uniquement dans ce navigateur." : "Positions disponibles pour cette session. Exporte une sauvegarde pour les conserver.";
    history = prices ? P.historyFor(positions, prices) : [];
    render();
  }
  function setupPositions() {
    try {positions = P.normalizePositions(stored(HOLDINGS_KEY, {positions: []}), catalog);} catch {positions = [];}
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
  function renderPositionsVisibility() {
    $("#portfolioPositions").hidden = !positionsVisible;
    $("#portfolioPositionsToggle").setAttribute("aria-expanded", String(positionsVisible));
    $("#portfolioPositionsToggle").textContent = (positionsVisible ? "Masquer" : "Afficher") + " mes positions (" + positions.length + ")";
  }
  function renderMovers(day) {
    const month = P.monthlyPerformance(positions, prices, day);
    $("#portfolioMoversPeriod").textContent = "Du " + month.start + " au " + month.end + " · 1 mois glissant · rendement en CAD, change inclus";
    const best = month.rows.slice(0, 3), bestTickers = new Set(best.map(row => row.ticker));
    const worst = month.rows.filter(row => !bestTickers.has(row.ticker)).slice(-3).reverse();
    for (const [selector, entries] of [["#portfolioBest", best], ["#portfolioWorst", worst]]) {
      const list = document.createDocumentFragment();
      for (const row of entries) {
        const item = el("li"); item.dataset.ticker = row.ticker;
        const name = el("span", "portfolio-mover-name"); name.append(el("strong", "", row.title), el("span", "portfolio-ticker", row.ticker + " · " + row.currency));
        const value = el("span", "change " + direction(row.percent), delta(row.percent, true));
        item.title = "Clôtures du " + row.start_price_date + " et du " + row.price_date + " · variation de la position : " + delta(row.change_cad);
        item.append(name, value); list.append(item);
      }
      if (!entries.length) list.append(el("li", "meta", month.rows.length ? "Pas assez de titres pour compléter les deux listes." : "Historique mensuel indisponible."));
      $(selector).replaceChildren(list);
    }
    $("#portfolioMoversNote").textContent = "Recalculé à chaque mise à jour quotidienne des cours, indépendamment de la période du graphique · " + month.rows.length + "/" + positions.length + " titres comparables · hors dividendes" +
      (month.missing.length ? " · historique ou change manquant : " + month.missing.join(", ") : "");
  }
  function render() {
    $("#portfolioEmpty").hidden = positions.length > 0;
    $("#portfolioContent").hidden = positions.length === 0;
    $("#portfolioExport").disabled = !positions.length;
    renderPositionsVisibility();
    for (const button of document.querySelectorAll("[data-portfolio-sort]")) {
      const active = button.dataset.portfolioSort === sortKey;
      button.closest("th").setAttribute("aria-sort", active ? (sortDescending ? "descending" : "ascending") : "none");
      button.querySelector("span").textContent = active ? (sortDescending ? "↓" : "↑") : "↕";
    }
    const controls = document.createDocumentFragment();
    for (const item of P.RANGES) {const button = el("button", "", item.label); button.type = "button"; button.setAttribute("aria-pressed", String(item.key === range)); button.addEventListener("click", () => {range = item.key; render();}); controls.append(button);}
    $("#portfolioRanges").replaceChildren(controls);
    if (!positions.length) {$("#portfolioStatus").textContent = "Importe ta sauvegarde ou ajoute tes positions. Les quantités restent sur cet appareil."; return;}
    if (!prices || !history.length) {$("#portfolioStatus").textContent = "Les cours n’ont pas pu être chargés. Tes positions sont conservées; utilise « Actualiser »."; $("#portfolioChart").replaceChildren(); $("#portfolioRows").replaceChildren(); $("#portfolioBest").replaceChildren(); $("#portfolioWorst").replaceChildren(); $("#portfolioMoversPeriod").textContent = ""; $("#portfolioMoversNote").textContent = "Les classements seront disponibles avec les cotations."; return;}
    const day = history.at(-1)[0], current = P.valuationAt(positions, prices, day), selected = P.period(history, range);
    const baseline = P.valuationAt(positions, prices, selected.start), old = current.rows.filter(row => row.price_date && row.price_date < day);
    $("#portfolioStatus").textContent = (cached ? "Copie de cours conservée · " : "") + "Valorisation au " + day + " · " +
      (positions.length - current.missing.length) + "/" + positions.length + " titres valorisés · collecte du " + U.timestampLabel(prices.generated_at) +
      (old.length ? " · " + old.length + " cours d’une séance antérieure repris" : "");
    $("#portfolioStatus").classList.toggle("warning", cached || !current.complete || old.length > 0 || Date.now() - U.parseTimestamp(prices.generated_at) > 36 * 3600000);
    $("#portfolioValueLabel").textContent = current.complete ? "VALEUR DES TITRES · CAD" : "VALEUR PARTIELLE · CAD";
    $("#portfolioValue").textContent = money(current.total);
    $("#portfolioChange").textContent = delta(selected.change) + " · " + delta(selected.percent, true);
    $("#portfolioChange").className = "portfolio-change change " + direction(selected.change);
    $("#portfolioPeriod").textContent = "Du " + selected.start + " au " + selected.end + (selected.incomplete ? " · historique incomplet, variation indisponible" : " · variation théorique sur la période");
    $("#portfolioFX").textContent = current.fx ? "1 $ US = " + U.formatNumber(current.fx, 4) + " $ CA · taux du " + current.fx_date : "Taux USD/CAD indisponible";
    $("#portfolioCurrencies").textContent = money(current.cad) + " en titres CAD · " + money(current.usd, "USD") + " en titres USD";
    $("#portfolioCost").textContent = "Coût converti au taux actuel : " + money(current.cost_converted);
    $("#portfolioUnrealized").textContent = "Gain latent estimé : " + delta(current.unrealized_cad) + " · " + delta(current.unrealized_percent, true) +
      (current.costs_available < positions.length ? " · prix moyens ou change incomplets" : " · change actuel");
    $("#portfolioUnrealized").className = "portfolio-unrealized change " + direction(current.unrealized_cad);
    $("#portfolioMissing").textContent = current.missing.length ? "Valeur partielle : cours ou change manquant pour " + current.missing.join(", ") + "." : "";
    renderMovers(day);
    const previous = new Map(baseline.rows.map(row => [row.ticker, row]));
    const comparedRows = current.rows.map(row => {
      const start = previous.get(row.ticker)?.value_cad;
      return {...row, period_change_cad: !selected.incomplete && U.validNumber(start) && U.validNumber(row.value_cad) ? row.value_cad - start : null};
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
      const price = el("td", "", U.formatNumber(row.price, row.decimals) + " " + row.currency); price.append(el("span", "portfolio-ticker", row.price_date || "Cours indisponible"));
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
    drawChart(selected.history);
  }
  function svgEl(tag, attrs, text) {const node = document.createElementNS("http://www.w3.org/2000/svg", tag); for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, String(v)); if (text !== undefined) node.textContent = text; return node;}
  function drawChart(data) {
    const valid = data.filter(row => U.validNumber(row[1]));
    if (!valid.length) {$("#portfolioChart").replaceChildren(el("p", "chart-placeholder", "Un historique complet des cours et du change est nécessaire pour tracer le portefeuille.")); return;}
    const width = 900, height = 300, left = 85, right = 20, top = 18, bottom = 36;
    const [low, high] = U.niceExtent(data); let firstTime = Date.parse(data[0][0]), lastTime = Date.parse(data.at(-1)[0]);
    if (firstTime === lastTime) {firstTime -= 43200000; lastTime += 43200000;}
    const x = day => left + (Date.parse(day) - firstTime) / (lastTime - firstTime) * (width - left - right);
    const y = value => top + (high - value) / (high - low) * (height - top - bottom);
    const svg = svgEl("svg", {viewBox: "0 0 " + width + " " + height, tabindex: 0, role: "img", "aria-label": "Historique théorique du portefeuille en dollars canadiens. Date, valeur et variation depuis le début de la période au survol. Flèches gauche et droite pour parcourir les valeurs."});
    svg.append(svgEl("title", {}, "Valorisation reconstituée des positions actuelles · CAD"));
    for (let i = 0; i < 4; i++) {const value = low + (high - low) * i / 3; svg.append(svgEl("line", {x1: left, x2: width - right, y1: y(value), y2: y(value), class: "chart-grid"}), svgEl("text", {x: left - 10, y: y(value) + 4, "text-anchor": "end", class: "chart-axis"}, U.formatNumber(value, high - low < 10 ? 2 : 0)));}
    for (let i = 0; i < 4; i++) {const stamp = firstTime + (lastTime - firstTime) * i / 3; svg.append(svgEl("text", {x: left + (width - left - right) * i / 3, y: height - 9, class: "chart-axis", "text-anchor": i === 0 ? "start" : i === 3 ? "end" : "middle"}, new Intl.DateTimeFormat("fr-CA", {timeZone: "UTC", month: "short", day: "numeric"}).format(new Date(stamp))));}
    let path = "", connected = false;
    for (const row of data) {if (!U.validNumber(row[1])) {connected = false; continue;} path += (connected ? "L" : "M") + x(row[0]).toFixed(2) + "," + y(row[1]).toFixed(2); connected = true;}
    svg.append(svgEl("path", {d: path, class: "chart-line"}));
    const guide = svgEl("line", {y1: top, y2: height - bottom, class: "chart-guide", visibility: "hidden"}), dot = svgEl("circle", {r: 4, class: "chart-dot", visibility: "hidden"}); svg.append(guide, dot);
    const hint = "Survole le graphique pour voir la date, la valeur et le % depuis le début · flèches ← → au clavier";
    const tooltip = el("p", "chart-tooltip", hint); tooltip.setAttribute("aria-live", "polite"); let index = valid.length - 1;
    const baseline = data[0], canCompare = U.validNumber(baseline[1]) && baseline[1] > 0;
    function select(row) {if (!row) return; index = valid.findIndex(item => item[0] === row[0]); guide.setAttribute("x1", x(row[0])); guide.setAttribute("x2", x(row[0])); guide.setAttribute("visibility", "visible"); dot.setAttribute("cx", x(row[0])); dot.setAttribute("cy", y(row[1])); dot.setAttribute("visibility", "visible"); tooltip.textContent = row[0] + " · " + money(row[1]) + " CAD · " + (canCompare ? delta((row[1] / baseline[1] - 1) * 100, true) + " depuis le " + baseline[0] : "variation indisponible : base du " + baseline[0] + " manquante");}
    svg.addEventListener("focus", () => select(valid[index]));
    svg.addEventListener("keydown", event => {if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); index = event.key === "Home" ? 0 : event.key === "End" ? valid.length - 1 : Math.min(valid.length - 1, Math.max(0, index + (event.key === "ArrowLeft" ? -1 : 1))); select(valid[index]);});
    svg.addEventListener("pointermove", event => {const rect = svg.getBoundingClientRect(); if (!rect.width) return; const coordinate = Math.max(left, Math.min(width - right, (event.clientX - rect.left) * width / rect.width)); select(U.nearestPoint(data, firstTime + (coordinate - left) / (width - left - right) * (lastTime - firstTime)));});
    svg.addEventListener("pointerleave", () => {if (document.activeElement === svg) return; guide.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); tooltip.textContent = hint;});
    $("#portfolioChart").replaceChildren(svg, tooltip);
  }
  async function refresh() {
    try {
      catalog = await fetchJSON("data/securities.json");
      if (!imported) setupPositions();
      try {prices = P.normalizePrices(await fetchJSON("data/security-prices.json"), catalog); cached = false; save(PRICE_KEY, prices);}
      catch {prices = P.normalizePrices(stored(PRICE_KEY, null), catalog); cached = true;}
      history = P.historyFor(positions, prices); render();
    } catch {$("#portfolioStatus").textContent = "Cotations indisponibles. Les positions enregistrées sur cet appareil sont conservées.";}
  }
  $("#portfolioImport").addEventListener("change", async event => {const file = event.target.files[0]; if (!file || !catalog) return; try {if (file.size > 100000) throw new Error("Fichier trop volumineux"); applyPositions(JSON.parse(await file.text()));} catch (error) {$("#portfolioMessage").textContent = "Import impossible : " + error.message;} finally {event.target.value = "";}});
  $("#positionForm").addEventListener("submit", event => {event.preventDefault(); if (!catalog) return; try {const ticker = $("#positionTicker").value; const existing = positions.find(p => p.ticker === ticker); const quantity = Number($("#positionQuantity").value.trim().replace(",", ".")); const costText = $("#positionAverageCost").value.trim(); const average_cost = costText ? Number(costText.replace(",", ".")) : existing?.average_cost; const next = {ticker, quantity, ...(average_cost !== undefined ? {average_cost} : {})}; applyPositions(existing ? positions.map(p => p.ticker === ticker ? next : p) : [...positions, next]); $("#positionQuantity").value = ""; $("#positionAverageCost").value = "";} catch (error) {$("#portfolioMessage").textContent = error.message;}});
  $("#portfolioExport").addEventListener("click", () => {const blob = new Blob([JSON.stringify({schema_version: 1, base_currency: "CAD", positions}, null, 2) + "\n"], {type: "application/json"}); const url = URL.createObjectURL(blob), anchor = el("a"); anchor.href = url; anchor.download = "portefeuille-savy.json"; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);});
  $("#portfolioPositionsToggle").addEventListener("click", () => {positionsVisible = !positionsVisible; save(POSITIONS_VISIBLE_KEY, positionsVisible); renderPositionsVisibility();});
  for (const button of document.querySelectorAll("[data-portfolio-sort]")) button.addEventListener("click", () => {const key = button.dataset.portfolioSort; sortDescending = key === sortKey ? !sortDescending : true; sortKey = key; render();});
  window.SavyPortfolio = {refresh};
})();
