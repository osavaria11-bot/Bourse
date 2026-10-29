(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./portfolio-utils.js"), require("./macro-utils.js"));
  else root.PortfolioAnalyticsUtils = factory(root.PortfolioUtils, root.MacroUtils);
})(typeof globalThis !== "undefined" ? globalThis : this, function (P, U) {
  "use strict";
  const MIN_VOLATILITY_RETURNS = 20, MIN_BETA_RETURNS = 30, MIN_RATIO_RETURNS = 30, SESSIONS_PER_YEAR = 252;
  // Fixed comparison assumption, not a claim about today's money-market rate.
  const RISK_FREE_RATE = .0238, VARIANCE_EPSILON = 1e-12;
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
    return {meanFirst, meanSecond, firstVariance: firstSquares / (n - 1), secondVariance: secondSquares / (n - 1), covariance: cross / (n - 1)};
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
  function riskFor(positions, data, selected, benchmarkId = "FEQT") {
    const empty = () => ({period_return: null, active_return: null, volatility: null, drawdown: null, beta: null,
      sharpe: null, sortino: null, information: null, treynor: null, alpha: null, tracking_error: null, correlation: null});
    const unavailable = {available: false, reason: "missing_history", start: selected?.start, end: selected?.end, observations: 0,
      risk_free_rate: RISK_FREE_RATE, portfolio: empty(), benchmark: empty()};
    if (!positions?.length || !data || selected?.incomplete || !selected?.history?.length ||
        selected.history.some(row => !U.validNumber(row[1]) || row[1] <= 0)) return unavailable;
    const byId = new Map(data.series.map(row => [row.id, row])), feqt = byId.get(benchmarkId);
    if (!Object.hasOwn(P.BENCHMARKS, benchmarkId) || feqt?.currency !== "CAD" || feqt.quote_symbol !== P.BENCHMARKS[benchmarkId]) return unavailable;
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
      if (!U.validNumber(value) || value <= 0) return unavailable;
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
    const canVolatility = n >= MIN_VOLATILITY_RETURNS, canRatio = n >= MIN_RATIO_RETURNS;
    const canBeta = n >= MIN_BETA_RETURNS && stats.secondVariance > VARIANCE_EPSILON;
    const dailyRiskFree = Math.expm1(Math.log1p(RISK_FREE_RATE) / SESSIONS_PER_YEAR);
    const active = portfolioReturns.map((value, i) => value - benchmarkReturns[i]);
    const activeStats = n > 1 ? moments(active, active) : null;
    function measures(returns, key, variance, mean, beta) {
      const annualExcess = canRatio ? (mean - dailyRiskFree) * SESSIONS_PER_YEAR : null;
      // Lower partial moment over ALL observations, not just the losing days.
      const downsideVariance = returns.reduce((sum, value) => sum + Math.min(0, value - dailyRiskFree) ** 2, 0) / n;
      return {period_return: (points.at(-1)[key] / points[0][key] - 1) * 100,
        volatility: canVolatility ? Math.sqrt(variance * SESSIONS_PER_YEAR) * 100 : null,
        drawdown: drawdown(points, key), beta,
        sharpe: canRatio && variance > VARIANCE_EPSILON ? annualExcess / Math.sqrt(variance * SESSIONS_PER_YEAR) : null,
        sortino: canRatio && downsideVariance > VARIANCE_EPSILON ? annualExcess / Math.sqrt(downsideVariance * SESSIONS_PER_YEAR) : null,
        treynor: canRatio && beta > 1e-8 ? annualExcess / beta * 100 : null};
    }
    const portfolio = measures(portfolioReturns, "portfolio", stats?.firstVariance, stats?.meanFirst, canBeta ? stats.covariance / stats.secondVariance : null);
    const benchmark = measures(benchmarkReturns, "benchmark", stats?.secondVariance, stats?.meanSecond, canBeta ? 1 : null);
    Object.assign(portfolio, {
      active_return: canRatio ? activeStats.meanFirst * SESSIONS_PER_YEAR * 100 : null,
      tracking_error: canVolatility ? Math.sqrt(activeStats.firstVariance * SESSIONS_PER_YEAR) * 100 : null,
      information: canRatio && activeStats.firstVariance > VARIANCE_EPSILON ? activeStats.meanFirst * Math.sqrt(SESSIONS_PER_YEAR / activeStats.firstVariance) : null,
      alpha: canRatio && canBeta ? ((stats.meanFirst - dailyRiskFree) - portfolio.beta * (stats.meanSecond - dailyRiskFree)) * SESSIONS_PER_YEAR * 100 : null,
      correlation: canBeta && stats.firstVariance > VARIANCE_EPSILON ? Math.max(-1, Math.min(1, stats.covariance / Math.sqrt(stats.firstVariance * stats.secondVariance))) : null});
    Object.assign(benchmark, {active_return: canRatio ? 0 : null, tracking_error: canVolatility ? 0 : null,
      information: null, alpha: canRatio && canBeta ? 0 : null, correlation: canBeta ? 1 : null});
    return {available: true, reason: null, start: points[0].date, end: points.at(-1).date, requested_start: selected.start,
      requested_end: selected.end, observations: n, matched_closes: points.length, skipped_closes: candidates.length - points.length,
      risk_free_rate: RISK_FREE_RATE, portfolio, benchmark,
      beta_reason: n < MIN_BETA_RETURNS ? "short_history" : !canBeta ? "constant_benchmark" : null};
  }
  function safeHTTPS(value) {
    try {const url = new URL(value); return url.protocol === "https:" && !!url.hostname && !url.username && !url.password;} catch {return false;}
  }
  function validDay(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  }
  function localDay(now = Date.now()) {
    const parts = new Intl.DateTimeFormat("en-US", {timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit"}).formatToParts(now);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return values.year + "-" + values.month + "-" + values.day;
  }
  function shiftDay(day, count) {return new Date(Date.parse(day) + count * 86400000).toISOString().slice(0, 10);}
  function weekFor(day = localDay()) {
    if (!validDay(day)) throw new Error("Date de semaine invalide");
    const weekday = new Date(day).getUTCDay(), start = shiftDay(day, -(weekday === 0 ? 6 : weekday - 1));
    return {start, end: shiftDay(start, 6), days: Array.from({length: 7}, (_, i) => shiftDay(start, i))};
  }
  function earningsOutcome(metric) {
    if (!U.validNumber(metric?.actual)) return {status: "pending", label: "À venir", difference: null, percent: null};
    if (!U.validNumber(metric.estimate)) return {status: "unknown", label: "Consensus N/D", difference: null, percent: null};
    if (metric.estimate_currency && metric.estimate_currency !== metric.currency)
      return {status: "unknown", label: "Devises non comparables", difference: null, percent: null};
    if (metric.actual_basis && metric.estimate_basis && metric.actual_basis !== metric.estimate_basis)
      return {status: "unknown", label: "Bases comptables non comparables", difference: null, percent: null};
    const difference = metric.actual - metric.estimate, status = Math.abs(difference) < 1e-9 ? "inline" : difference > 0 ? "beat" : "miss";
    return {status, label: status === "beat" ? "Au-dessus des attentes" : status === "miss" ? "Sous les attentes" : "Conforme aux attentes",
      difference, percent: metric.estimate !== 0 ? difference / Math.abs(metric.estimate) * 100 : null};
  }
  function normalizeEarnings(payload, catalog, now = Date.now()) {
    if (payload?.schema_version !== 1 || payload.kind !== "portfolio_earnings" || payload.timezone !== "America/Toronto" ||
        !Number.isFinite(U.parseTimestamp(payload.generated_at)) || U.parseTimestamp(payload.generated_at) > now + 300000 ||
        !validDay(payload.window?.start) || !validDay(payload.window?.end) || payload.window.end < payload.window.start ||
        Date.parse(payload.window.end) - Date.parse(payload.window.start) > 150 * 86400000 ||
        !payload.instruments || typeof payload.instruments !== "object" || Array.isArray(payload.instruments)) throw new Error("Résultats invalides");
    const definitions = new Set(catalog.series.map(row => row.id)), instruments = {}, today = localDay(now);
    for (const [id, feed] of Object.entries(payload.instruments)) {
      if (!definitions.has(id) || !["fresh", "cached", "unavailable", "not_applicable"].includes(feed?.fetch_status) ||
          !safeHTTPS(feed.source_url) || !Array.isArray(feed.events) || feed.events.length > 8 ||
          typeof feed.company_symbol !== "string" || !feed.company_symbol.trim() || feed.company_symbol.length > 30 ||
          (feed.fetch_status === "not_applicable" && feed.events.length) ||
          (feed.fetch_status !== "unavailable" && !Number.isFinite(U.parseTimestamp(feed.fetched_at))) ||
          (feed.fetched_at !== null && (!Number.isFinite(U.parseTimestamp(feed.fetched_at)) || U.parseTimestamp(feed.fetched_at) > now + 300000))) throw new Error("Calendrier de titre invalide");
      const seen = new Set();
      instruments[id] = {...feed, events: feed.events.map(event => {
        if (!/^[a-f0-9]{16}$/.test(event?.id || "") || seen.has(event.id) || !validDay(event.report_date) ||
            event.report_date < payload.window.start || event.report_date > payload.window.end ||
            !["reported", "estimated", "calendar"].includes(event.date_status) ||
            (event.quarter !== null && !/^Q[1-4] \d{4}$/.test(event.quarter)) ||
            (event.report_at !== null && (!Number.isFinite(U.parseTimestamp(event.report_at)) || localDay(U.parseTimestamp(event.report_at)) !== event.report_date)) ||
            (event.report_url !== null && !safeHTTPS(event.report_url)) ||
            !Array.isArray(event.messages) || event.messages.length > 4 || !Array.isArray(event.sources) || !event.sources.length || event.sources.length > 4) throw new Error("Événement de résultats invalide");
        for (const key of ["eps", "revenue"]) {
          const metric = event[key];
          if (!metric || ![null, "USD", "CAD"].includes(metric.currency) || !safeHTTPS(metric.source_url) ||
              (metric.estimate_currency !== undefined && !["USD", "CAD"].includes(metric.estimate_currency)) ||
              [metric.actual_basis, metric.estimate_basis].some(basis => basis !== undefined && !["gaap", "adjusted"].includes(basis)) ||
              [metric.actual, metric.estimate].some(value => value !== null && (!U.validNumber(value) || (key === "revenue" && value < 0)))) throw new Error("Comparaison de résultats invalide");
        }
        if (event.sources.some(source => typeof source.label !== "string" || !source.label.trim() || source.label.length > 100 || !safeHTTPS(source.url)) ||
            event.messages.some(message => typeof message.text !== "string" || !message.text.trim() || message.text.length > 450 || !["fr", "en"].includes(message.language) || !safeHTTPS(message.source_url))) throw new Error("Message ou source de résultats invalide");
        const actual = U.validNumber(event.eps.actual) || U.validNumber(event.revenue.actual);
        if (event.date_status === "reported" && !actual || event.date_status !== "reported" && (actual || event.messages.length) ||
            actual && (event.report_date > today || event.report_at && U.parseTimestamp(event.report_at) > now)) throw new Error("Résultats non encore publiés");
        seen.add(event.id); return {...event, eps: {...event.eps}, revenue: {...event.revenue}, messages: event.messages.map(row => ({...row}))};
      })};
    }
    return {...payload, instruments};
  }
  function earningsMessages(event) {
    const messages = event?.messages;
    return event?.date_status === "reported" && Array.isArray(messages) && messages.length >= 3 && messages.length <= 4 &&
      messages.every(message => message.language === "fr" && message.kind === "reviewed_summary" &&
        typeof message.text === "string" && message.text.trim() && message.text.length <= 450) ? messages : [];
  }
  function selectEarnings(current, earnings, {ticker = "", week = weekFor(), now = Date.now()} = {}) {
    const events = new Map(), unavailable = [], cached = [], notApplicable = [];
    let covered = 0;
    for (const position of current?.rows || []) {
      if (ticker && position.ticker !== ticker) continue;
      const feed = earnings?.instruments[position.ticker];
      if (!feed || feed.fetch_status === "unavailable") {unavailable.push(position.ticker); continue;}
      if (feed.fetch_status === "not_applicable") {notApplicable.push(position.ticker); continue;}
      covered++;
      if (feed.fetch_status === "cached" || now - U.parseTimestamp(feed.fetched_at) > 36 * 3600000) cached.push(position.ticker);
      const weight = current.complete && current.total > 0 && U.validNumber(position.value_cad) ? position.value_cad / current.total * 100 : null;
      for (const event of feed.events) {
        if (event.report_date < week.start || event.report_date > week.end) continue;
        if (!events.has(event.id)) events.set(event.id, {...event, company_symbol: feed.company_symbol, fetched_at: feed.fetched_at, cached: cached.includes(position.ticker), holdings: []});
        else if (cached.includes(position.ticker)) events.get(event.id).cached = true;
        events.get(event.id).holdings.push({ticker: position.ticker, title: position.title, weight, listing_note: feed.listing_note});
      }
    }
    const rows = [...events.values()].sort((a, b) => a.report_date.localeCompare(b.report_date) || a.company_symbol.localeCompare(b.company_symbol));
    return {rows, week, covered, unavailable, cached, notApplicable,
      reported: rows.filter(row => row.date_status === "reported").length,
      pending: rows.filter(row => row.date_status !== "reported").length,
      inWindow: !!earnings && week.start >= earnings.window.start && week.end <= earnings.window.end};
  }
  return {contributionsFor, riskFor, normalizeEarnings, selectEarnings, earningsOutcome, earningsMessages, weekFor, localDay, shiftDay,
    MIN_VOLATILITY_RETURNS, MIN_BETA_RETURNS, MIN_RATIO_RETURNS, SESSIONS_PER_YEAR, RISK_FREE_RATE};
});
