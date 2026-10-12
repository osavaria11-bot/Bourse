(() => {
  "use strict";
  const URL = "https://biquote.io/api/USDCAD";
  let quote = null;
  function parse(payload, now = Date.now()) {
    const timestamp = Date.parse(payload?.timestamp);
    const rate = payload?.mid;
    const closed = payload?.marketState === "closed";
    const age = now - timestamp;
    if (payload?.symbol !== "USDCAD" || !Number.isFinite(rate) || rate < .5 || rate > 3 ||
        !Number.isFinite(timestamp) || age < -300000 || age > (closed ? 4 * 86400000 : 10 * 60000) ||
        !["open", "closed"].includes(payload.marketState)) throw new Error("Cotation de change absente ou ancienne");
    return {rate, timestamp: payload.timestamp, fetched_at: new Date(now).toISOString(), closed, source: "biquote"};
  }
  function current() {
    if (!quote) return null;
    const age = Date.now() - Date.parse(quote.timestamp);
    return age <= (quote.closed ? 4 * 86400000 : 10 * 60000) ? quote : null;
  }
  async function refresh() {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 9000);
    try {
      const response = await fetch(URL, {cache: "no-store", signal: controller.signal});
      if (!response.ok) throw new Error("Source de change inaccessible");
      quote = parse(await response.json());
    } catch {
      quote = current();
    } finally {
      clearTimeout(timeout);
      document.dispatchEvent(new Event("savy:fx"));
    }
  }
  window.SavyLiveFX = {current, refresh, source_url: "https://biquote.io/forex/usdcad"};
  refresh();
  setInterval(() => {if (document.visibilityState === "visible") refresh();}, 60000);
  document.addEventListener("visibilitychange", () => {if (document.visibilityState === "visible") refresh();});
})();
