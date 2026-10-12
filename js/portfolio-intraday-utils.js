(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./portfolio-utils.js"), require("./intraday-utils.js"), require("./macro-utils.js"));
  else root.PortfolioIntradayUtils = factory(root.PortfolioUtils, root.IntradayUtils, root.MacroUtils);
})(typeof globalThis !== "undefined" ? globalThis : this, function (P, I, U) {
  "use strict";
  function unavailable(missing = []) {return {available: false, missing, data: null, fx: null, session_date: null,
    selected: {intraday: true, history: [], start: null, end: null, percent: null, change: null, incomplete: true},
    comparison: {available: false, normalized: false, points: [], start: null, end: null, portfolio_percent: null, benchmark_percent: null, difference: null}};}
  function session(positions, prices, payload, benchmarkId = "FEQT", liveFx = null, now = Date.now()) {
    if (!positions?.length || !prices?.series) return unavailable();
    const sources = new Map(prices.series.map(point => [point.id, point])), quotes = new Map();
    function quoteFor(id) {
      const base = sources.get(id), quote = base && I.choose(payload, id, {quote_symbol: base.quote_symbol, currency: base.currency}, now);
      return I.isCurrent(quote, now) ? quote : null;
    }
    const missing = [];
    for (const position of positions) {const q = quoteFor(position.ticker); if (q) quotes.set(position.ticker, q); else missing.push(position.ticker);}
    if (missing.length) return unavailable(missing);
    const day = [...quotes.values()].map(q => q.session_date).sort().at(-1);
    const trading = [...quotes.values()].filter(q => q.session_date === day);
    for (const q of trading) if (q.intraday_history.length < 2) missing.push(q.id);
    if (missing.length) return unavailable(missing);
    const daily = P.historyFor(positions, prices).filter(row => row[0] < day && U.validNumber(row[1]));
    const previousDay = daily.at(-1)?.[0];
    if (!previousDay || Date.parse(day) - Date.parse(previousDay) > 7 * 86400000) return unavailable();
    const stamps = new Set(trading.flatMap(q => q.intraday_history.map(row => row[0])));
    const first = [...stamps].sort()[0], equityEnd = [...stamps].sort().at(-1);
    const sessionActive = trading.some(q => q.active);
    const usd = positions.some(p => p.currency === "USD"), fxQuote = usd ? quoteFor("USDCAD") : null;
    const originalFx = sources.get("USDCAD"), fxBase = P.observationAt(originalFx?.history || [], previousDay);
    let fxHistory = [], fxSource = "Yahoo Finance";
    if (usd) {
      if (!fxQuote || fxQuote.session_date !== day || fxQuote.intraday_history.length < 2 || !fxBase) return unavailable(["USDCAD"]);
      fxHistory = fxQuote.intraday_history.map(row => [...row]);
      const fxStamp = U.parseTimestamp(liveFx?.timestamp), liveAge = now - fxStamp;
      const localDay = Number.isFinite(fxStamp) ? new Intl.DateTimeFormat("en-CA", {timeZone: "America/Toronto"}).format(fxStamp) : null;
      if (sessionActive && localDay === day && U.validNumber(liveFx?.rate) && liveFx.rate > .5 && liveFx.rate < 3 &&
          liveAge >= 0 && liveAge <= 600000 && fxStamp > U.parseTimestamp(fxHistory.at(-1)[0])) {
        fxHistory.push([new Date(fxStamp).toISOString(), liveFx.rate]); fxSource = "biquote";
      }
      const openingFx = fxHistory.filter(row => row[0] <= first).at(-1);
      if (!openingFx || U.parseTimestamp(first) - U.parseTimestamp(openingFx[0]) > 30 * 60000) return unavailable(["USDCAD"]);
      const end = sessionActive ? (fxHistory.at(-1)[0] > equityEnd ? fxHistory.at(-1)[0] : equityEnd) : equityEnd;
      for (const row of fxHistory) if (row[0] >= first && row[0] <= end) stamps.add(row[0]);
    }
    const byId = new Map(prices.series.map(point => [point.id, {...point}]));
    function withSession(id, q) {
      const point = sources.get(id), old = P.observationAt(point.history, previousDay);
      const base = q.session_date < day ? q.price : q.previous_close ?? old?.[1];
      if (!(base > 0)) return false;
      const history = [[previousDay, base], ...(q.session_date === day ? q.intraday_history.map(row => [...row]) : [])];
      byId.set(id, {...point, history, date: history.at(-1)[0], value: history.at(-1)[1], current_quote: q}); return true;
    }
    for (const [id, q] of quotes) if (!withSession(id, q)) missing.push(id);
    if (missing.length) return unavailable(missing);
    if (usd) byId.set("USDCAD", {...originalFx, history: [[previousDay, fxBase[1]], ...fxHistory], date: fxHistory.at(-1)[0], value: fxHistory.at(-1)[1]});
    const benchmarkQuote = quoteFor(benchmarkId);
    if (!benchmarkQuote || !withSession(benchmarkId, benchmarkQuote)) byId.set(benchmarkId, {...sources.get(benchmarkId), history: [], value: null, date: null});
    const data = {...prices, series: [...byId.values()]};
    const baseline = P.valuationAt(positions, data, previousDay);
    if (!baseline.complete || !(baseline.total > 0)) return unavailable();
    const history = [...stamps].sort().map(stamp => {const current = P.valuationAt(positions, data, stamp); return [stamp, current.complete ? current.total : null];});
    if (history.length < 2 || !U.validNumber(history.at(-1)[1])) return unavailable();
    const end = history.at(-1)[0], final = history.at(-1)[1];
    const selected = {intraday: true, session_date: day, history, start: previousDay, end, incomplete: false,
      change: final - baseline.total, percent: (final / baseline.total - 1) * 100};
    const comparison = P.benchmarkFor({...selected, history: [[previousDay, baseline.total], ...history]}, byId.get(benchmarkId), benchmarkId);
    comparison.points = comparison.points.slice(1);
    const lastFx = usd ? P.observationAt(byId.get("USDCAD").history, end) : null;
    return {available: true, missing: [], data, selected, comparison, session_date: day, active: sessionActive,
      fx: lastFx ? {rate: lastFx[1], timestamp: lastFx[0], closed: !sessionActive, source: fxSource} : null};
  }
  return {session};
});
