(() => {
  "use strict";
  const F = window.FearGreedUtils, U = window.MacroUtils, $ = id => document.getElementById(id);
  const KEY = "savy:cnn-fear-greed:v1";
  let data = null, copy = false, pending = null;
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
  document.addEventListener("visibilitychange", () => {if (document.visibilityState === "visible") refresh();});
  setInterval(() => {if (document.visibilityState === "visible") refresh();}, 5 * 60000);
  refresh();
})();
