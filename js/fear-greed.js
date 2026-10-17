(() => {
  "use strict";
  const F = window.FearGreedUtils, U = window.MacroUtils, $ = id => document.getElementById(id);
  const KEY = "savy:cnn-fear-greed:v1";
  let data = null, copy = false, pending = null, range = "1Y";
  function renderTimeline() {
    const host = $("fearGreedTimeline"), rows = F.visibleHistory(data, range);
    for (const button of $("fearGreedRanges").querySelectorAll("button")) {
      button.setAttribute("aria-pressed", String(button.dataset.range === range));
      button.disabled = !data?.history?.length;
    }
    if (!rows.length) {
      host.innerHTML = '<p class="meta">Historique CNN indisponible pour le moment.</p>';
      $("fearGreedHistoryStatus").textContent = "";
      return;
    }
    const width = Math.max(220, host.clientWidth), height = 178, left = 30, right = width - 10, top = 10, bottom = height - 26;
    const start = Date.parse(rows[0][0]), end = Date.parse(rows.at(-1)[0]);
    const x = row => start === end ? (left + right) / 2 : left + (Date.parse(row[0]) - start) / (end - start) * (right - left);
    const y = row => bottom - row[1] / 100 * (bottom - top);
    const coords = row => x(row).toFixed(2) + " " + y(row).toFixed(2);
    const line = rows.map((row, index) => (index ? "L" : "M") + coords(row)).join(" ");
    const ticks = [0, 25, 50, 75, 100].map(value => {
      const pos = y([null, value]);
      return '<line class="fear-history-grid' + (value === 50 ? ' fear-history-neutral' : '') + '" x1="' + left + '" x2="' + right + '" y1="' + pos + '" y2="' + pos + '"/>' +
        (value % 50 === 0 ? '<text class="fear-history-label" x="' + (left - 8) + '" y="' + (pos + 3) + '" text-anchor="end">' + value + '</text>' : '');
    }).join("");
    const shortDate = day => new Intl.DateTimeFormat("fr-CA", {timeZone: "UTC", day: "numeric", month: "short"}).format(new Date(day + "T00:00:00Z"));
    const dates = start === end ? '<text class="fear-history-label" x="' + x(rows[0]) + '" y="' + (height - 6) + '" text-anchor="middle">' + shortDate(rows[0][0]) + '</text>' :
      '<text class="fear-history-label" x="' + left + '" y="' + (height - 6) + '">' + shortDate(rows[0][0]) + '</text>' +
      '<text class="fear-history-label" x="' + right + '" y="' + (height - 6) + '" text-anchor="end">' + shortDate(rows.at(-1)[0]) + '</text>';
    const area = rows.length > 1 ? '<path class="fear-history-area" d="' + line + ' L' + right + ' ' + bottom + ' L' + left + ' ' + bottom + ' Z"/>' : '';
    host.innerHTML = '<svg role="img" tabindex="0" viewBox="0 0 ' + width + ' ' + height + '" aria-label="Historique du Fear &amp; Greed de CNN, ' + rows.length + ' observations, échelle de 0 à 100" aria-describedby="fearGreedHistoryHint fearGreedHistoryStatus">' +
      ticks + area + '<path class="fear-history-line" d="' + line + '"/>' +
      '<circle class="fear-history-dot" cx="' + x(rows.at(-1)) + '" cy="' + y(rows.at(-1)) + '" r="3.5"/>' + dates +
      '<g class="fear-history-selection" hidden><line class="fear-history-crosshair" y1="' + top + '" y2="' + bottom + '"/><circle class="fear-history-dot" r="4"/></g></svg>' +
      '<div class="fear-history-tooltip" role="status" hidden></div>';
    $("fearGreedHistoryStatus").textContent = U.observationLabel(rows[0][0]) + " — " + U.observationLabel(rows.at(-1)[0]) +
      " · " + rows.length + (rows.length > 1 ? " observations" : " observation") +
      (copy || data.fetch_status === "cached" || data.history_status === "cached" ? " · historique conservé" : " · CNN");
    const svg = host.querySelector("svg"), selection = host.querySelector(".fear-history-selection"), tooltip = host.querySelector(".fear-history-tooltip");
    let selected = rows.length - 1;
    function show(index) {
      selected = Math.max(0, Math.min(rows.length - 1, index));
      const row = rows[selected], px = x(row), py = y(row);
      selection.removeAttribute("hidden"); tooltip.hidden = false;
      selection.querySelector("line").setAttribute("x1", px); selection.querySelector("line").setAttribute("x2", px);
      selection.querySelector("circle").setAttribute("cx", px); selection.querySelector("circle").setAttribute("cy", py);
      tooltip.textContent = U.observationLabel(row[0]) + " · " + U.formatNumber(row[1], 1) + " / 100";
      tooltip.style.left = Math.max(4, Math.min(host.clientWidth - tooltip.offsetWidth - 4, px - tooltip.offsetWidth / 2)) + "px";
    }
    function hide() {selection.setAttribute("hidden", ""); tooltip.hidden = true;}
    const pointer = event => {
      const rect = svg.getBoundingClientRect(), px = (event.clientX - rect.left) / rect.width * width;
      let nearest = 0;
      for (let index = 1; index < rows.length; index++) if (Math.abs(x(rows[index]) - px) < Math.abs(x(rows[nearest]) - px)) nearest = index;
      show(nearest);
    };
    svg.addEventListener("pointermove", pointer);
    svg.addEventListener("pointerdown", pointer);
    svg.addEventListener("pointerleave", () => {if (document.activeElement !== svg) hide();});
    svg.addEventListener("focus", () => show(selected));
    svg.addEventListener("blur", hide);
    svg.addEventListener("keydown", event => {
      const index = {ArrowLeft: selected - 1, ArrowRight: selected + 1, Home: 0, End: rows.length - 1}[event.key];
      if (index !== undefined) {event.preventDefault(); show(index);}
    });
  }
  function render() {
    const available = F.validScore(data?.score), host = $("fearGreed"), meter = $("fearGreedMeter");
    host.dataset.rating = available ? data.rating.replaceAll(" ", "-") : "unavailable";
    $("fearGreedValue").textContent = available ? U.formatNumber(data.score, 0) : "—";
    $("fearGreedRating").textContent = available ? F.RATINGS[data.rating] : "Indisponible";
    $("fearGreedChart").hidden = !available;
    const change = F.changeLabel(data);
    $("fearGreedChange").textContent = change; $("fearGreedChange").hidden = !change;
    let status = "CNN est indisponible pour le moment.";
    if (available) {
      meter.style.setProperty("--fear-score", data.score + "%");
      meter.setAttribute("aria-valuenow", String(data.score));
      meter.setAttribute("aria-valuetext", U.formatNumber(data.score, 0) + " sur 100 · " + F.RATINGS[data.rating]);
      status = "Publication CNN · " + U.timestampLabel(data.timestamp);
      if (copy || data.fetch_status === "cached") status += " · dernière valeur conservée";
      else if (Date.now() - U.parseTimestamp(data.timestamp) > 7 * 86400000) status += " · publication ancienne conservée";
    }
    $("fearGreedStatus").textContent = status;
    renderTimeline();
  }
  try {data = F.normalize(JSON.parse(localStorage.getItem(KEY))); copy = true; render();} catch { /* Use the published file. */ }
  async function refresh() {
    if (pending) return pending;
    pending = (async () => {
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch("data/fear-greed.json?v=" + Date.now(), {cache: "no-store", signal: controller.signal});
        if (!response.ok) throw new Error("CNN indisponible");
        const next = F.normalize(await response.json());
        if (F.validScore(data?.score) && (!F.validScore(next.score) || U.parseTimestamp(next.timestamp) < U.parseTimestamp(data.timestamp))) {
          copy = true; return;
        }
        data = next; copy = false;
        if (F.validScore(data.score)) try {localStorage.setItem(KEY, JSON.stringify(data));} catch { /* Still usable this session. */ }
      } catch {copy = true;}
      finally {clearTimeout(timeout); render();}
    })();
    try {await pending;} finally {pending = null;}
  }
  $("refreshButton").addEventListener("click", refresh);
  $("fearGreedRanges").addEventListener("click", event => {
    const button = event.target.closest("button[data-range]");
    if (button && !button.disabled) {range = button.dataset.range; renderTimeline();}
  });
  let chartWidth = 0;
  new ResizeObserver(entries => {
    const width = Math.round(entries[0].contentRect.width);
    if (width !== chartWidth) {chartWidth = width; if (data) renderTimeline();}
  }).observe($("fearGreedTimeline"));
  document.addEventListener("visibilitychange", () => {if (document.visibilityState === "visible") refresh();});
  setInterval(() => {if (document.visibilityState === "visible") refresh();}, 5 * 60000);
  refresh();
})();
