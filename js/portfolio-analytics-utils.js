(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./portfolio-utils.js"), require("./macro-utils.js"));
  else root.PortfolioAnalyticsUtils = factory(root.PortfolioUtils, root.MacroUtils);
})(typeof globalThis !== "undefined" ? globalThis : this, function (P, U) {
  "use strict";
  const MIN_VOLATILITY_RETURNS = 20, MIN_BETA_RETURNS = 30, SESSIONS_PER_YEAR = 252;
  const NEWS_DAYS = 7;
  const EVENTS = {
    earnings: {label: "Résultats", importance: 5, reason: "À surveiller : bénéfices, marges et réaction du marché aux résultats."},
    earnings_calendar: {label: "Calendrier des résultats", importance: 3, reason: "À surveiller : date des résultats et prochaine mise à jour des perspectives."},
    guidance: {label: "Prévisions", importance: 5, reason: "À surveiller : changement des perspectives de revenus ou de bénéfices."},
    deal: {label: "Transaction / contrat", importance: 4, reason: "À surveiller : effet du contrat ou de la transaction sur la croissance et le financement."},
    regulatory: {label: "Réglementation", importance: 4, reason: "À surveiller : contraintes réglementaires, coûts et accès aux marchés."},
    operations: {label: "Activité de l’entreprise", importance: 3, reason: "À surveiller : évolution des ventes, de la production et des investissements."},
    dividend: {label: "Distribution / rachat", importance: 2, reason: "À surveiller : distributions, rachats d’actions et allocation du capital."},
    market: {label: "Marché", importance: 1, reason: "À surveiller : mouvement du titre et contexte de marché présenté dans l’article."},
  };
  function contributionsFor(positions, data, selected) {
    const unavailable = {available: false, start: selected?.start, end: selected?.end, rows: [], total: null, change_cad: null};
    if (!positions?.length || !data || !selected?.start || !selected.end || selected.incomplete) return unavailable;
    const start = P.valuationAt(positions, data, selected.start), end = P.valuationAt(positions, data, selected.end);
    if (!start.complete || !end.complete || !(start.total > 0)) return unavailable;
    const previous = new Map(start.rows.map(row => [row.ticker, row]));
    const rows = end.rows.map(row => {
      const old = previous.get(row.ticker), change = row.value_cad - old.value_cad;
      return {ticker: row.ticker, title: row.title, currency: row.currency, start_value: old.value_cad,
        end_value: row.value_cad, start_weight: old.value_cad / start.total * 100,
        percent: (row.value_cad / old.value_cad - 1) * 100, change_cad: change,
        contribution: change / start.total * 100, start_quote: old.price_date, end_quote: row.price_date};
    });
    return {available: true, start: selected.start, end: selected.end, start_value: start.total,
      change_cad: end.total - start.total, total: rows.reduce((sum, row) => sum + row.contribution, 0),
      rows: P.sortRows(rows, "contribution")};
  }
  function moments(first, second) {
    const n = first.length, meanFirst = first.reduce((sum, value) => sum + value, 0) / n;
    const meanSecond = second.reduce((sum, value) => sum + value, 0) / n;
    let firstSquares = 0, secondSquares = 0, cross = 0;
    for (let i = 0; i < n; i++) {
      const a = first[i] - meanFirst, b = second[i] - meanSecond;
      firstSquares += a * a; secondSquares += b * b; cross += a * b;
    }
    return {firstVariance: firstSquares / (n - 1), secondVariance: secondSquares / (n - 1), covariance: cross / (n - 1)};
  }
  function drawdown(points, key) {
    let peak = points[0][key], peakDate = points[0].date, worst = 0, from = peakDate, to = peakDate;
    for (const row of points) {
      if (row[key] > peak) {peak = row[key]; peakDate = row.date;}
      const fall = (row[key] / peak - 1) * 100;
      if (fall < worst) {worst = fall; from = peakDate; to = row.date;}
    }
    return {value: worst, peak_date: from, trough_date: to};
  }
  function riskFor(positions, data, selected) {
    const unavailable = {available: false, reason: "missing_history", start: selected?.start, end: selected?.end, observations: 0,
      portfolio: {volatility: null, drawdown: null, beta: null}, benchmark: {volatility: null, drawdown: null, beta: null}};
    if (!positions?.length || !data || selected?.incomplete || !selected?.history?.length ||
        selected.history.some(row => !U.validNumber(row[1]) || row[1] <= 0)) return unavailable;
    const byId = new Map(data.series.map(row => [row.id, row])), feqt = byId.get("FEQT");
    if (feqt?.currency !== "CAD" || feqt.quote_symbol !== "FEQT.NE") return unavailable;
    const required = [...new Set(positions.map(row => row.ticker))];
    if (positions.some(row => row.currency === "USD")) required.push("USDCAD");
    if (required.some(id => !byId.has(id))) return unavailable;
    // Exact common closes avoid creating zero returns from carried holiday/stale quotes.
    const maps = new Map(required.map(id => [id, new Map(byId.get(id).history.filter(row => U.validNumber(row[1]) && row[1] > 0))]));
    const candidates = feqt.history.filter(row => row[0] >= selected.start && row[0] <= selected.end && U.validNumber(row[1]) && row[1] > 0);
    const points = [];
    for (const [date, benchmark] of candidates) {
      if (required.some(id => !maps.get(id).has(date))) continue;
      const value = positions.reduce((total, row) => total + row.quantity * maps.get(row.ticker).get(date) *
        (row.currency === "USD" ? maps.get("USDCAD").get(date) : 1), 0);
      points.push({date, portfolio: value, benchmark});
    }
    if (points.length < 2) return {...unavailable, reason: "short_history", observations: Math.max(0, points.length - 1)};
    // Missing chunks must not be treated as ordinary daily observations.
    if (points.length / candidates.length < .8 || points.some((row, i) => i > 0 && Date.parse(row.date) - Date.parse(points[i - 1].date) > 7 * 86400000) ||
        Date.parse(points[0].date) - Date.parse(selected.start) > 7 * 86400000 ||
        Date.parse(selected.end) - Date.parse(points.at(-1).date) > 7 * 86400000) return {...unavailable, reason: "incomplete_common_history"};
    const portfolioReturns = [], benchmarkReturns = [];
    for (let i = 1; i < points.length; i++) {
      portfolioReturns.push(points[i].portfolio / points[i - 1].portfolio - 1);
      benchmarkReturns.push(points[i].benchmark / points[i - 1].benchmark - 1);
    }
    const n = portfolioReturns.length, stats = n > 1 ? moments(portfolioReturns, benchmarkReturns) : null;
    const canVolatility = n >= MIN_VOLATILITY_RETURNS, canBeta = n >= MIN_BETA_RETURNS && stats.secondVariance > 1e-12;
    return {available: true, reason: null, start: points[0].date, end: points.at(-1).date, requested_start: selected.start,
      requested_end: selected.end, observations: n, matched_closes: points.length, skipped_closes: candidates.length - points.length,
      portfolio: {volatility: canVolatility ? Math.sqrt(stats.firstVariance * SESSIONS_PER_YEAR) * 100 : null,
        drawdown: drawdown(points, "portfolio"), beta: canBeta ? stats.covariance / stats.secondVariance : null},
      benchmark: {volatility: canVolatility ? Math.sqrt(stats.secondVariance * SESSIONS_PER_YEAR) * 100 : null,
        drawdown: drawdown(points, "benchmark"), beta: canBeta ? 1 : null},
      beta_reason: n < MIN_BETA_RETURNS ? "short_history" : !canBeta ? "constant_benchmark" : null};
  }
  function safeHTTPS(value) {
    try {const url = new URL(value); return url.protocol === "https:" && !!url.hostname && !url.username && !url.password;} catch {return false;}
  }
  function normalizeNews(payload, catalog, now = Date.now()) {
    if (payload?.schema_version !== 1 || payload.kind !== "portfolio_news" || !Number.isFinite(U.parseTimestamp(payload.generated_at)) ||
        U.parseTimestamp(payload.generated_at) > now + 300000 || !payload.instruments || typeof payload.instruments !== "object" || Array.isArray(payload.instruments)) throw new Error("Actualités invalides");
    const definitions = new Set(catalog.series.map(row => row.id)), instruments = {};
    for (const [id, feed] of Object.entries(payload.instruments)) {
      if (!definitions.has(id) || !["fresh", "cached", "unavailable"].includes(feed?.fetch_status) || !Array.isArray(feed.items) || feed.items.length > 12 ||
          (feed.fetched_at !== null && (!Number.isFinite(U.parseTimestamp(feed.fetched_at)) || U.parseTimestamp(feed.fetched_at) > now + 300000))) throw new Error("Flux d’actualités invalide");
      const seen = new Set();
      instruments[id] = {...feed, items: feed.items.map(item => {
        const published = U.parseTimestamp(item?.published_at);
        if (!/^[a-f0-9]{16}$/.test(item?.id || "") || seen.has(item.id) || !Number.isFinite(published) || published > now + 300000 ||
            typeof item.title !== "string" || !item.title.trim() || item.title.length > 350 || typeof item.publisher !== "string" || !item.publisher.trim() || item.publisher.length > 100 ||
            !safeHTTPS(item.source_url) || !safeHTTPS(item.publisher_url) || !EVENTS[item.event]) throw new Error("Article d’actualités invalide");
        seen.add(item.id); return {...item};
      })};
    }
    return {...payload, instruments};
  }
  function selectNews(current, news, {ticker = "", event = "all", now = Date.now(), limit = 8} = {}) {
    if (!current?.rows?.length || !news) return {rows: [], covered: 0, unavailable: [], cached: [], total: 0};
    const rows = new Map(), unavailable = [], cached = [], cutoff = now - NEWS_DAYS * 86400000;
    let covered = 0;
    for (const position of current.rows) {
      if (ticker && position.ticker !== ticker) continue;
      const feed = news.instruments[position.ticker];
      if (!feed || feed.fetch_status === "unavailable") unavailable.push(position.ticker);
      if (feed?.fetch_status === "cached" || (feed?.fetched_at && now - U.parseTimestamp(feed.fetched_at) > 36 * 3600000)) cached.push(position.ticker);
      const weight = current.complete && current.total > 0 ? position.value_cad / current.total * 100 : null;
      let found = false;
      for (const item of feed?.items || []) {
        const stamp = U.parseTimestamp(item.published_at);
        if (stamp < cutoff || stamp > now || (event === "results" && !["earnings", "earnings_calendar", "guidance"].includes(item.event))) continue;
        found = true;
        if (!rows.has(item.id)) rows.set(item.id, {...item, holdings: []});
        rows.get(item.id).holdings.push({ticker: position.ticker, title: position.title, weight});
      }
      if (found) covered++;
    }
    const ranked = [...rows.values()].map(item => {
      const weight = item.holdings.reduce((sum, holding) => sum + (holding.weight || 0), 0);
      const age = Math.max(0, (now - U.parseTimestamp(item.published_at)) / 3600000);
      const publisherPriority = /Reuters|Bloomberg|Financial Times|Wall Street Journal|New York Times/.test(item.publisher) ? 1.25 : 1;
      return {...item, weight: current.complete ? weight : null,
        score: EVENTS[item.event].importance * publisherPriority * (1 + Math.sqrt(weight)) * Math.exp(-age / 72)};
    }).sort((a, b) => b.score - a.score || U.parseTimestamp(b.published_at) - U.parseTimestamp(a.published_at) || a.id.localeCompare(b.id));
    const selected = [], counts = new Map();
    for (const item of ranked) {
      if (item.holdings.every(holding => (counts.get(holding.ticker) || 0) >= 2)) continue;
      selected.push(item);
      for (const holding of item.holdings) counts.set(holding.ticker, (counts.get(holding.ticker) || 0) + 1);
      if (selected.length >= limit) break;
    }
    return {rows: selected, total: ranked.length, covered, unavailable, cached};
  }
  return {contributionsFor, riskFor, normalizeNews, selectNews, EVENTS, MIN_VOLATILITY_RETURNS, MIN_BETA_RETURNS, SESSIONS_PER_YEAR, NEWS_DAYS};
});
