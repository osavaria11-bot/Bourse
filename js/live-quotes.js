(() => {
  "use strict";
  const I = window.IntradayUtils, KEY = "savy:intraday-quotes:v1";
  const LIVE = "https://raw.githubusercontent.com/osavaria11-bot/Bourse/savy-live-quotes/intraday-quotes.json";
  let data = null, pending = null;
  const rejectedListings = new Map();
  try {data = I.normalize(JSON.parse(localStorage.getItem(KEY)));} catch { /* Daily closes remain available. */ }
  function merge(rows) {
    const byId = new Map((data?.quotes || []).map(q => [q.id, q]));
    for (const q of rows) {
      const old = byId.get(q.id);
      const rejected = rejectedListings.get(q.id);
      if (!old && rejected && (rejected.quote_symbol !== q.quote_symbol || rejected.currency !== q.currency)) continue;
      if (old && (old.quote_symbol !== q.quote_symbol || old.currency !== q.currency)) {
        // An explicit listing/currency violation invalidates that provider's
        // previous quote. A separately verified source remains usable.
        if (q.source_provider !== "yahoo") byId.set(q.id, q);
        else if (old.source_provider === q.source_provider && Date.parse(q.fetched_at) >= Date.parse(old.fetched_at)) {
          byId.delete(q.id); rejectedListings.set(q.id, old);
        }
        continue;
      }
      if (!old || (old.quote_symbol === q.quote_symbol && old.currency === q.currency &&
          (Date.parse(q.timestamp) > Date.parse(old.timestamp) ||
           (Date.parse(q.timestamp) === Date.parse(old.timestamp) && Date.parse(q.fetched_at) >= Date.parse(old.fetched_at))))) {
        byId.set(q.id, q); rejectedListings.delete(q.id);
      }
    }
    if (data) data = {...data, quotes: [...byId.values()]};
  }
  async function directIndices() {
    const J = window.IndexQuoteUtils;
    if (!J || J.definitions.every(d => {
      const q = I.choose(data, d.id);
      return q && I.collectionIsCurrent(q) && Date.now() - Date.parse(q.fetched_at) < 5 * 60000 && !q.stale;
    })) return;
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch("https://app-money.tmx.com/graphql?" + new URLSearchParams(J.request()),
        {cache: "no-store", signal: controller.signal});
      if (!response.ok) throw new Error("Indices TMX indisponibles");
      const checked = Date.now(), rows = J.parse(await response.json(), checked);
      if (!data && rows.length) data = {schema_version: 1, kind: "intraday_quotes", generated_at: new Date(checked).toISOString(), quotes: []};
      merge(I.normalize({schema_version: 1, kind: "intraday_quotes", generated_at: new Date(checked).toISOString(), quotes: rows}).quotes);
    } catch { /* Keep actual dated observations from the other provider. */ }
    finally {clearTimeout(timeout); document.dispatchEvent(new Event("savy:quotes"));}
  }
  async function publishedQuotes(url) {
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch(url + "?v=" + Date.now(), {cache: "no-store", signal: controller.signal});
        if (!response.ok) throw new Error("Cotations en séance indisponibles");
        const next = I.normalize(await response.json());
        if (!data) data = {...next, quotes: []};
        const quotes = data.quotes;
        if (Date.parse(next.generated_at) >= Date.parse(data.generated_at)) data = {...next, quotes};
        merge(next.quotes);
      } catch { /* Keep the last dated quote; never relabel it as fresh. */ }
      finally {clearTimeout(timeout); document.dispatchEvent(new Event("savy:quotes"));}
  }
  async function refresh() {
    if (pending) return pending;
    pending = (async () => {
      try {await Promise.allSettled([publishedQuotes(LIVE), publishedQuotes("data/intraday-quotes.json"), directIndices()]);
        try {localStorage.setItem(KEY, JSON.stringify(data));} catch { /* Session still usable. */ }
      } finally {pending = null; document.dispatchEvent(new Event("savy:quotes"));}
    })();
    return pending;
  }
  window.SavyLiveQuotes = {refresh, dataset: () => data, current: (id, base) => I.choose(data, id, base),
    marketPoint: point => I.marketPoint(point, data), marketSession: point => I.marketSession(point, data),
    portfolioView: (prices, positions, fx) => I.portfolioView(prices, positions, data, fx)};
  refresh();
  setInterval(() => {if (document.visibilityState === "visible") refresh();}, 60000);
  document.addEventListener("visibilitychange", () => {if (document.visibilityState === "visible") refresh();});
  window.addEventListener("focus", refresh);
  window.addEventListener("online", refresh);
})();
