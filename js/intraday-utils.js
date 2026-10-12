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
      let day, localDay;
      try {localDay = new Intl.DateTimeFormat("en-CA", {timeZone: row.exchange_timezone}); day = localDay.format(stamp);} catch {continue;}
      if (!row || typeof row.id !== "string" || !/^[A-Z0-9]+$/.test(row.id) || seen.has(row.id) ||
          typeof row.quote_symbol !== "string" || !/^[A-Za-z0-9^.=\-]+$/.test(row.quote_symbol) ||
          !U.validNumber(row.price) || row.price <= 0 || !Number.isFinite(stamp) || !Number.isFinite(fetched) ||
          stamp > now + 300000 || fetched > now + 300000 || stamp > fetched + 300000 ||
          (row.id === "USDCAD" && (row.quote_symbol !== "CAD=X" || row.currency !== "CAD" || row.price <= .5 || row.price >= 3)) ||
          !U.isDate(row.session_date) || row.session_date !== day || !["regular", "closed"].includes(row.market_state) ||
          !["fresh", "cached"].includes(row.fetch_status)) continue;
      seen.add(row.id);
      const minutes = new Map();
      if (Array.isArray(row.intraday_history) && row.intraday_history.length <= 1600) for (const point of row.intraday_history) {
        const time = U.parseTimestamp(point?.[0]);
        if (Number.isFinite(time) && time <= stamp && time <= now && U.validNumber(point?.[1]) && point[1] > 0 &&
            (row.id !== "USDCAD" || (point[1] > .5 && point[1] < 3)) && localDay.format(time) === day)
          minutes.set(new Date(time).toISOString(), point[1]);
      }
      if (minutes.size) minutes.set(new Date(stamp).toISOString(), row.price);
      const intraday_history = [...minutes].sort((a, b) => a[0].localeCompare(b[0]));
      const intraday_sessions = {};
      if (row.id === "USDCAD" && row.quote_symbol === "CAD=X" && row.currency === "CAD" &&
          row.intraday_sessions && typeof row.intraday_sessions === "object" && Object.keys(row.intraday_sessions).length <= 8) {
        for (const [session, rows] of Object.entries(row.intraday_sessions)) {
          if (!U.isDate(session) || !Array.isArray(rows) || rows.length > 1600) continue;
          const valid = new Map();
          for (const point of rows) {
            const time = U.parseTimestamp(point?.[0]);
            if (Number.isFinite(time) && time <= stamp && now - time <= 7 * DAY && U.validNumber(point?.[1]) && point[1] > .5 && point[1] < 3 && localDay.format(time) === session)
              valid.set(new Date(time).toISOString(), point[1]);
          }
          intraday_sessions[session] = [...valid].sort((a, b) => a[0].localeCompare(b[0]));
        }
      }
      quotes.push({...row, intraday_history, intraday_sessions, previous_close: U.validNumber(row.previous_close) && row.previous_close > 0 ? row.previous_close : null,
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
  function isCurrent(row, now = Date.now()) {
    if (!row || row.stale || row.fetch_status !== "fresh") return false;
    const collectedAge = now - U.parseTimestamp(row.fetched_at), tradeAge = now - U.parseTimestamp(row.timestamp);
    return collectedAge >= -300000 && collectedAge <= 12 * 60000 && tradeAge >= -300000 &&
      tradeAge <= (row.active ? 30 * 60000 : 7 * DAY);
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
  function marketSession(point, payload, now = Date.now()) {
    const received = point ? choose(payload, point.id, {quote_symbol: point.quote_symbol, currency: point.currency}, now) : null;
    const current = isCurrent(received, now), quote = received ? {...received, stale: !current} : null;
    // A delayed refresh does not invalidate the actual, dated session history.
    const history = quote?.intraday_history || [], available = history.length >= 2;
    const base = quote?.previous_close, comparable = available && U.validNumber(base) && base > 0;
    return {quote: available ? quote : null, history: available ? history : [], available, current, incomplete: !comparable,
      start: available ? history[0][0] : null, end: available ? history.at(-1)[0] : null,
      baseline: comparable ? base : null, change: comparable ? quote.price - base : null,
      percent: comparable ? (quote.price / base - 1) * 100 : null};
  }
  function clock(value) {
    return new Intl.DateTimeFormat("fr-CA", {timeZone: "America/Toronto", hour: "2-digit", minute: "2-digit"}).format(typeof value === "number" ? value : U.parseTimestamp(value));
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
  return {normalize, choose, label, shortLabel, isCurrent, clock, marketSession, overlay, marketPoint, portfolioView};
});
