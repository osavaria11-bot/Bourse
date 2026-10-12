(() => {
  "use strict";
  const I = window.IntradayUtils, KEY = "savy:intraday-quotes:v1";
  let data = null, pending = null;
  try {data = I.normalize(JSON.parse(localStorage.getItem(KEY)));} catch { /* Daily closes remain available. */ }
  async function refresh() {
    if (pending) return pending;
    pending = (async () => {
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch("data/intraday-quotes.json?v=" + Date.now(), {cache: "no-store", signal: controller.signal});
        if (!response.ok) throw new Error("Cotations en séance indisponibles");
        const next = I.normalize(await response.json());
        if (data && Date.parse(next.generated_at) < Date.parse(data.generated_at)) return;
        const byId = new Map(next.quotes.map(q => [q.id, q]));
        for (const old of data?.quotes || []) {
          const fresh = byId.get(old.id);
          if (!fresh || (fresh.quote_symbol === old.quote_symbol && Date.parse(old.timestamp) > Date.parse(fresh.timestamp)))
            byId.set(old.id, {...old, fetch_status: "cached"});
        }
        data = {...next, quotes: [...byId.values()]};
        try {localStorage.setItem(KEY, JSON.stringify(data));} catch { /* Session still usable. */ }
      } catch { /* Keep the last dated quote; never relabel it as fresh. */ }
      finally {clearTimeout(timeout); document.dispatchEvent(new Event("savy:quotes"));}
    })();
    try {await pending;} finally {pending = null;}
  }
  window.SavyLiveQuotes = {refresh, dataset: () => data, current: (id, base) => I.choose(data, id, base),
    marketPoint: point => I.marketPoint(point, data), portfolioView: (prices, positions, fx) => I.portfolioView(prices, positions, data, fx)};
  refresh();
  setInterval(() => {if (document.visibilityState === "visible") refresh();}, 60000);
  document.addEventListener("visibilitychange", () => {if (document.visibilityState === "visible") refresh();});
})();
