(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./macro-utils.js"));
  else root.IntradayUtils = factory(root.MacroUtils);
})(typeof globalThis !== "undefined" ? globalThis : this, function (U) {
  "use strict";
  const DAY = 86400000;
  function normalize(payload, now = Date.now()) {
    const generated = U.parseTimestamp(payload?.generated_at);
    if (payload?.schema_version !== 1 || payload.kind !== "intraday_quotes" || !Array.isArray(payload.quotes) ||
        !Number.isFinite(generated) || generated > now + 300000) throw new Error("Cotations en séance invalides");
    const quotes = [], seen = new Set();
    for (const row of payload.quotes) {
      const stamp = U.parseTimestamp(row?.timestamp), fetched = U.parseTimestamp(row?.fetched_at);
      let day;
      try {day = new Intl.DateTimeFormat("en-CA", {timeZone: row.exchange_timezone}).format(stamp);} catch {continue;}
      if (!row || typeof row.id !== "string" || !/^[A-Z0-9]+$/.test(row.id) || seen.has(row.id) ||
          typeof row.quote_symbol !== "string" || !/^[A-Za-z0-9^.=\-]+$/.test(row.quote_symbol) ||
          !U.validNumber(row.price) || row.price <= 0 || !Number.isFinite(stamp) || !Number.isFinite(fetched) ||
          stamp > now + 300000 || fetched > now + 300000 || stamp > fetched + 300000 ||
          !U.isDate(row.session_date) || row.session_date !== day || !["regular", "closed"].includes(row.market_state) ||
          !["fresh", "cached"].includes(row.fetch_status)) continue;
      seen.add(row.id);
      quotes.push({...row, previous_close: U.validNumber(row.previous_close) && row.previous_close > 0 ? row.previous_close : null,
        source_label: "Yahoo Finance", source_url: "https://finance.yahoo.com/quote/" + encodeURIComponent(row.quote_symbol) + "/"});
    }
    return {...payload, quotes};
  }
  function choose(payload, id, base = null, now = Date.now()) {
    const row = payload?.quotes.find(p => p.id === id);
    if (!row || now - U.parseTimestamp(row.timestamp) > 7 * DAY ||
        (base && (row.quote_symbol !== base.quote_symbol || (base.currency && row.currency !== base.currency) || row.session_date < base.date ||
          (row.session_date === base.date && U.parseTimestamp(base.last_successful_fetch) > U.parseTimestamp(row.fetched_at))))) return null;
    const sessionEnd = U.parseTimestamp(row.session_end);
    const active = row.market_state === "regular" && (!Number.isFinite(sessionEnd) || now < sessionEnd);
    const stale = row.fetch_status === "cached" || (active && (now - U.parseTimestamp(row.fetched_at) > 12 * 60000 || now - U.parseTimestamp(row.timestamp) > 30 * 60000));
    return {...row, active, stale};
  }
  function label(row) {
    if (!row) return "Clôture quotidienne · cotation en séance indisponible";
    return (row.stale ? "Cotation conservée · " : row.active ? "En séance · " : "Marché fermé · dernier cours · ") +
      U.timestampLabel(row.timestamp) + " · Yahoo Finance" + (row.provider_delay_minutes > 0 ? " · retard fournisseur " + row.provider_delay_minutes + " min" : "");
  }
  function shortLabel(row) {
    if (!row) return "Clôture quotidienne";
    const time = new Intl.DateTimeFormat("fr-CA", {timeZone: "America/Toronto", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit"}).format(U.parseTimestamp(row.timestamp)).replace(/(\d{1,2}) h (\d{2})/, "$1\u00a0h\u00a0$2");
    return (row.stale ? "Cotation conservée" : row.active ? "En séance" : "Marché fermé") + " · " + time +
      (row.provider_delay_minutes > 0 ? " · retard " + row.provider_delay_minutes + " min" : "");
  }
  function overlay(point, row) {
    if (!row) return point;
    return {...point, value: row.price, date: row.session_date,
      history: [...(point.history || []).filter(p => p[0] < row.session_date), [row.session_date, row.price]], current_quote: row};
  }
  function marketPoint(point, payload, now = Date.now()) {
    return overlay(point, point ? choose(payload, point.id, point, now) : null);
  }
  function portfolioView(data, positions, payload, fx, now = Date.now()) {
    if (!data) return data;
    const series = data.series.map(point => overlay(point, choose(payload, point.id, point, now)));
    const held = new Set(positions.map(p => p.ticker));
    if (!series.some(p => held.has(p.id) && p.current_quote)) return data;
    const end = series.filter(p => held.has(p.id)).map(p => p.date).sort().at(-1);
    const fxTime = U.parseTimestamp(fx?.timestamp);
    const fxDay = Number.isFinite(fxTime) ? new Intl.DateTimeFormat("en-CA", {timeZone: "America/Toronto"}).format(fxTime) : null;
    const useFx = fx && U.validNumber(fx.rate) && fx.rate > .5 && fx.rate < 3 && fxDay === end &&
      now - U.parseTimestamp(fx.timestamp) >= -300000 && now - U.parseTimestamp(fx.timestamp) <= (fx.closed ? 4 * DAY : 600000);
    if (useFx) {
      const index = series.findIndex(p => p.id === "USDCAD");
      if (index >= 0) series[index] = {...series[index], date: end, value: fx.rate,
        history: [...series[index].history.filter(p => p[0] < end), [end, fx.rate]]};
    }
    return {...data, series};
  }
  return {normalize, choose, label, shortLabel, overlay, marketPoint, portfolioView};
});
