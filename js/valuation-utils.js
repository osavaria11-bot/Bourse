(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ValuationUtils = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const finite = n => typeof n === "number" && Number.isFinite(n);
  const day = d => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d + "T00:00:00Z")) && new Date(d + "T00:00:00Z").toISOString().slice(0, 10) === d;
  const symbol = s => typeof s === "string" && /^[A-Z][A-Z0-9.-]{0,19}$/.test(s);
  const url = s => typeof s === "string" && /^https:\/\/[a-z0-9.-]+(?::\d+)?\//i.test(s);
  function universe(payload) {
    if (payload?.schema_version !== 1 || payload.kind !== "savy_valuation_universe" || !Array.isArray(payload.instruments)) throw new Error("Univers de valorisation indisponible");
    const seen = new Set();
    const instruments = payload.instruments.map(row => {
      if (!symbol(row.id) || seen.has(row.id) || row.type !== "stock" || typeof row.title !== "string" || !row.title.trim() || !symbol(row.symbol)) throw new Error("Action individuelle invalide");
      seen.add(row.id); return {...row};
    });
    const aliases = {};
    for (const [id, target] of Object.entries(payload.aliases || {})) if (symbol(id) && seen.has(target) && !seen.has(id)) aliases[id] = target;
    const editions = (payload.research_editions || []).filter(e => day(e.date) && Array.isArray(e.tickers)).map(e => ({...e, tickers: e.tickers.filter(id => seen.has(id))}));
    return {...payload, instruments, aliases, research_editions: editions};
  }
  function memberIds(config, holdings = {}) {
    const memberships = new Map(config.instruments.map(i => [i.id, []]));
    for (const [profile, rows] of Object.entries(holdings)) for (const position of rows || []) {
      const ticker = typeof position === "string" ? position : position.ticker;
      const id = config.aliases[ticker] || ticker;
      if (memberships.has(id) && (typeof position === "string" || (finite(position.quantity) && position.quantity > 0)) && !memberships.get(id).includes(profile)) memberships.get(id).push(profile);
    }
    const research = new Set(config.research_editions.flatMap(e => e.tickers));
    return config.instruments.map(row => ({...row, portfolios: memberships.get(row.id), research: research.has(row.id)}));
  }
  function snapshot(s, now = Date.now()) {
    if (!s || !day(s.date) || !Number.isFinite(Date.parse(s.observed_at)) || Date.parse(s.observed_at) > now + 300000 ||
        s.date !== new Intl.DateTimeFormat("en-CA", {timeZone: "America/Toronto"}).format(new Date(s.observed_at)) ||
        !url(s.source_url) || !/^[A-Z]{3}$/.test(s.currency) || !finite(s.price) || s.price <= 0 ||
        (s.enterprise_value_millions !== null && !finite(s.enterprise_value_millions)) || !Array.isArray(s.forecasts) ||
        !Number.isInteger(s.fiscal_month) || s.fiscal_month < 1 || s.fiscal_month > 12 ||
        (s.price_date !== null && (!day(s.price_date) || s.price_date > s.date))) throw new Error("Relevé de consensus invalide");
    const seen = new Set();
    for (const p of s.forecasts) {
      if (!day(p.period_end) || seen.has(p.period_end) || (p.eps !== null && !finite(p.eps)) || (p.ebitda_millions !== null && !finite(p.ebitda_millions))) throw new Error("Prévision annuelle invalide");
      seen.add(p.period_end);
    }
    return s;
  }
  function index(payload, config, now = Date.now()) {
    if (payload?.schema_version !== 1 || payload.kind !== "savy_valuations" || !Array.isArray(payload.instruments) ||
        !Number.isFinite(Date.parse(payload.generated_at)) || Date.parse(payload.generated_at) > now + 300000) throw new Error("Relevés de valorisation indisponibles");
    const expected = new Set(config.instruments.map(i => i.id)), seen = new Set();
    const instruments = payload.instruments.filter(row => expected.has(row.id)).map(row => {
      if (seen.has(row.id) || row.type !== "stock" || !["fresh", "cached", "unavailable"].includes(row.fetch_status)) throw new Error("Cotation ambiguë");
      seen.add(row.id); return {...row, latest: row.latest ? snapshot(row.latest, now) : null};
    });
    return {...payload, instruments};
  }
  function history(payload, id, now = Date.now()) {
    if (payload?.schema_version !== 1 || payload.kind !== "savy_stock_valuation" || payload.id !== id || !Array.isArray(payload.observations)) throw new Error("Historique de valorisation indisponible");
    let previous = "";
    const observations = payload.observations.map(s => {
      snapshot(s, now); if (s.date <= previous) throw new Error("Dates de consensus désordonnées"); previous = s.date; return s;
    });
    return {...payload, observations};
  }
  function denominator(s, key, horizon) {
    if (![1, 2].includes(horizon)) return null;
    const current = new Date(s.date + "T00:00:00Z"), month = s.fiscal_month;
    let year = current.getUTCFullYear();
    const endDate = y => new Date(Date.UTC(y, month, 0));
    if (current > endDate(year)) year++;
    year += horizon - 1;
    const anchor = new Date(+current);
    if (horizon === 2) {
      const y = current.getUTCFullYear() + 1, m = current.getUTCMonth();
      anchor.setUTCFullYear(y, m, Math.min(current.getUTCDate(), new Date(Date.UTC(y, m + 1, 0)).getUTCDate()));
    }
    const end = endDate(year), previous = endDate(year - 1), following = endDate(year + 1);
    const a = s.forecasts.find(p => p.period_end === end.toISOString().slice(0, 10))?.[key];
    const b = s.forecasts.find(p => p.period_end === following.toISOString().slice(0, 10))?.[key];
    const weight = (end - anchor) / (end - previous);
    if (!finite(a) || weight < 0 || weight > 1 || (weight < 1 && !finite(b))) return null;
    return a * weight + (b || 0) * (1 - weight);
  }
  function values(s, horizon, financial = false, basis = "blended") {
    const future = s.forecasts.filter(p => p.period_end >= s.date).sort((a,b) => a.period_end.localeCompare(b.period_end));
    const fiscal = future[horizon - 1];
    const eps = basis === "fiscal" ? fiscal?.eps : denominator(s, "eps", horizon);
    const ebitda = basis === "fiscal" ? fiscal?.ebitda_millions : denominator(s, "ebitda_millions", horizon);
    const ev = s.enterprise_value_millions;
    return {pe: finite(eps) && eps > 0 ? s.price / eps : null,
      ev_ebitda: !financial && finite(ev) && ev > 0 && finite(ebitda) && ebitda > 0 ? ev / ebitda : null,
      eps: finite(eps) ? eps : null, ebitda: finite(ebitda) ? ebitda : null, period_end: basis === "fiscal" ? fiscal?.period_end : null};
  }
  // Wilder RSI of changes in the multiple itself. A missing daily observation
  // resets the warmup: no linear interpolation or price-RSI substitution.
  function rsi(points, period = 14, previousSessions = new Map()) {
    if (!Number.isInteger(period) || period < 2 || period > 100) throw new Error("Période RSI invalide");
    let previous = null, gain = 0, loss = 0, count = 0;
    return points.map(([d, value]) => {
      if (previous && previousSessions.get(d) && previousSessions.get(d) !== previous[0]) {previous=null;gain=loss=count=0;}
      if (!finite(value) || value <= 0 || (previous && Date.parse(d) - Date.parse(previous[0]) > 5 * 86400000)) {
        previous = finite(value) && value > 0 ? [d, value] : null; gain = loss = count = 0; return [d, null];
      }
      if (!previous) {previous = [d, value]; return [d, null];}
      const diff = value - previous[1], up = Math.max(0, diff), down = Math.max(0, -diff);
      previous = [d, value]; count++;
      if (count <= period) {gain += up; loss += down; if (count < period) return [d, null]; gain /= period; loss /= period;}
      else {gain = (gain * (period - 1) + up) / period; loss = (loss * (period - 1) + down) / period;}
      return [d, gain === 0 && loss === 0 ? 50 : loss === 0 ? 100 : gain === 0 ? 0 : 100 - 100 / (1 + gain / loss)];
    });
  }
  function quantile(values, p) {
    if (!values.length) return null;
    const x = [...values].sort((a,b) => a-b), i = (x.length - 1) * p, a = Math.floor(i);
    return x[a] + (x[Math.ceil(i)] - x[a]) * (i - a);
  }
  function statistics(points, latest) {
    const values = points.map(p => p[1]).filter(v => finite(v) && v > 0);
    if (values.length < 30 || !finite(latest)) return {available: false, observations: values.length};
    const below = values.filter(v => v < latest).length, equal = values.filter(v => v === latest).length;
    return {available: true, observations: values.length, median: quantile(values, .5), low: quantile(values, .1), high: quantile(values, .9),
      percentile: 100 * (below + equal * .5) / values.length, premium: (latest / quantile(values, .5) - 1) * 100};
  }
  function model(data, latest, horizon, range = "5Y", basis = "blended", now = Date.now()) {
    const end = latest?.date || new Date(now).toISOString().slice(0, 10), start = new Date(end + "T00:00:00Z");
    if (range !== "MAX") start.setUTCFullYear(start.getUTCFullYear() - ({"1Y":1, "3Y":3, "5Y":5}[range] || 5));
    const cutoff = range === "MAX" ? "0000-01-01" : start.toISOString().slice(0, 10);
    const financial = data?.financial === true, observations = data?.observations || [];
    const present = latest ? values(latest, horizon, financial, basis) : {};
    const output = {};
    for (const key of ["pe", "ev_ebitda"]) {
      const all = observations.filter(s=>s.price_date===s.date).map(s => [s.date, s.complete_session === true ? values(s, horizon, financial, basis)[key] : null]);
      const previousSessions = new Map(observations.filter(s=>s.previous_session_date).map(s=>[s.date,s.previous_session_date]));
      const relativeStrength = rsi(all, 14, previousSessions);
      const shown = all.filter(p => p[0] >= cutoff && p[0] <= end);
      const shownRsi = relativeStrength.filter(p => p[0] >= cutoff && p[0] <= end);
      const latestRsi = relativeStrength.at(-1)?.[0] === latest?.date ? relativeStrength.at(-1)?.[1] : null;
      output[key] = {points: shown, rsi: shownRsi, latest: present[key] ?? null, latestRsi,
        stats: statistics(shown, present[key]), period_end: present.period_end};
    }
    return {end, start: cutoff, ...output};
  }
  return {finite, day, universe, memberIds, snapshot, index, history, denominator, values, rsi, quantile, statistics, model};
});
