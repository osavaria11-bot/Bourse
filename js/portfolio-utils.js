(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./macro-utils.js"));
  else root.PortfolioUtils = factory(root.MacroUtils);
})(typeof globalThis !== "undefined" ? globalThis : this, function (U) {
  "use strict";
  const RANGES = [{key: "YTD", label: "YTD"}, {key: "6M", label: "6 mois"}, {key: "3M", label: "3 mois"},
    {key: "1M", label: "1 mois"}, {key: "1W", label: "1 semaine"}, {key: "3D", label: "3 jours"}];
  function normalizePrices(payload, catalog) {
    if (catalog?.schema_version !== 1 || !Array.isArray(catalog.series) || payload?.kind !== "security_prices" ||
        !Number.isFinite(U.parseTimestamp(payload.generated_at)) || U.parseTimestamp(payload.generated_at) > Date.now() + 300000) throw new Error("Cotations invalides");
    const data = U.normalizeDataset(payload), byId = new Map(data.series.map(p => [p.id, p]));
    const definitions = [...catalog.series, {id: "USDCAD", currency: "CAD", quote_symbol: "CAD=X", title: "USD/CAD", decimals: 6}];
    if (definitions.length !== data.series.length) throw new Error("Catalogue de cotations incomplet");
    data.series = definitions.map(definition => {
      const point = byId.get(definition.id);
      if (!point || point.currency !== definition.currency || point.quote_symbol !== definition.quote_symbol ||
          !["USD", "CAD"].includes(point.currency)) throw new Error("Symbole ou devise de cotation incohérent");
      const history = point.history.map(row => [row[0], row[1] !== null && row[1] > 0 ? row[1] : null]);
      const valid = history.filter(row => row[1] !== null);
      if (point.value !== null && (point.value <= 0 || valid.length < 2 || valid.at(-1)[0] !== point.date || valid.at(-1)[1] !== point.value)) throw new Error("Clôture de cotation incohérente");
      return {...point, ...definition, history, source_url: "https://finance.yahoo.com/quote/" + encodeURIComponent(definition.quote_symbol) + "/"};
    });
    return data;
  }
  function normalizePositions(input, catalog) {
    const supplied = Array.isArray(input) ? input : input?.positions;
    if (!Array.isArray(supplied) || supplied.length > 200) throw new Error("Le fichier doit contenir une liste de positions");
    const definitions = new Map(catalog.series.map(p => [p.id, p])), seen = new Set();
    return supplied.map(item => {
      const row = Array.isArray(item) ? {ticker: item[0], quantity: item[1], currency: item[2], average_cost: item[3]} : item;
      if (!row || typeof row.ticker !== "string") throw new Error("Ticker manquant");
      const ticker = row.ticker.trim().toUpperCase(), definition = definitions.get(ticker);
      if (!definition) throw new Error("Cotation non configurée pour " + ticker);
      if (seen.has(ticker)) throw new Error("Ticker présent deux fois : " + ticker);
      seen.add(ticker);
      const quantity = typeof row.quantity === "string" ? Number(row.quantity.trim().replace(",", ".")) : row.quantity;
      if (!U.validNumber(quantity) || quantity <= 0 || quantity > 1e9) throw new Error("Quantité positive requise pour " + ticker);
      if (row.currency && row.currency !== definition.currency) throw new Error("Devise inattendue pour " + ticker);
      const suppliedCost = row.average_cost;
      const averageCost = typeof suppliedCost === "string" ? Number(suppliedCost.trim().replace(",", ".")) : suppliedCost;
      if (suppliedCost !== undefined && suppliedCost !== null && (!U.validNumber(averageCost) || averageCost <= 0 || averageCost > 1e9)) throw new Error("Prix moyen positif requis pour " + ticker);
      return {ticker, quantity, currency: definition.currency, ...(suppliedCost !== undefined && suppliedCost !== null ? {average_cost: averageCost} : {})};
    });
  }
  function observationAt(history, day) {
    let low = 0, high = history.length - 1, index = -1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      if (history[middle][0] <= day) {index = middle; low = middle + 1;} else high = middle - 1;
    }
    while (index >= 0 && !U.validNumber(history[index][1])) index--;
    if (index < 0 || Date.parse(day) - Date.parse(history[index][0]) > 7 * 86400000) return null;
    return history[index];
  }
  function valuationAt(positions, data, day) {
    const prices = new Map(data.series.map(p => [p.id, p])), fxSeries = prices.get("USDCAD");
    const fx = fxSeries ? observationAt(fxSeries.history, day) : null;
    let total = 0, cad = 0, usd = 0, cost = 0, unrealized = 0, costsAvailable = 0;
    const missing = [], rows = positions.map(position => {
      const security = prices.get(position.ticker), quote = security ? observationAt(security.history, day) : null;
      const nativeValue = quote ? position.quantity * quote[1] : null;
      const value = nativeValue !== null && (position.currency === "CAD" || fx) ? nativeValue * (position.currency === "USD" ? fx[1] : 1) : null;
      const nativeCost = U.validNumber(position.average_cost) ? position.average_cost * position.quantity : null;
      const nativeGain = nativeValue !== null && nativeCost !== null ? nativeValue - nativeCost : null;
      const convertedCost = nativeCost !== null && (position.currency === "CAD" || fx) ? nativeCost * (position.currency === "USD" ? fx[1] : 1) : null;
      const convertedGain = nativeGain !== null && (position.currency === "CAD" || fx) ? nativeGain * (position.currency === "USD" ? fx[1] : 1) : null;
      if (convertedGain !== null) {cost += convertedCost; unrealized += convertedGain; costsAvailable++;}
      if (value === null) missing.push(position.ticker); else total += value;
      if (nativeValue !== null) {if (position.currency === "CAD") cad += nativeValue; else usd += nativeValue;}
      return {...position, title: security?.title || position.ticker, price: quote?.[1] ?? null,
        price_date: quote?.[0] || null, native_value: nativeValue, value_cad: value, fetch_status: security?.fetch_status,
        cost_native: nativeCost, unrealized_native: nativeGain, unrealized_cad: convertedGain,
        unrealized_percent: nativeGain !== null && nativeCost > 0 ? nativeGain / nativeCost * 100 : null,
        source_url: security?.source_url, decimals: security?.decimals || 2};
    });
    const costComplete = positions.length > 0 && costsAvailable === positions.length;
    return {date: day, total, cad, usd, fx: fx?.[1] ?? null, fx_date: fx?.[0] || null, rows, missing, complete: positions.length > 0 && missing.length === 0,
      cost_converted: costComplete ? cost : null, unrealized_cad: costComplete ? unrealized : null,
      unrealized_percent: costComplete && cost > 0 ? unrealized / cost * 100 : null, costs_available: costsAvailable};
  }
  function historyFor(positions, data) {
    const held = new Set(positions.map(p => p.ticker)), days = new Set();
    for (const security of data.series) if (held.has(security.id)) for (const row of security.history) if (U.validNumber(row[1])) days.add(row[0]);
    return [...days].sort().map(day => {
      const value = valuationAt(positions, data, day);
      return [day, value.complete ? value.total : null];
    });
  }
  function period(history, range) {
    if (!history.length) return {history: [], change: null, percent: null, incomplete: true};
    const anchor = history.at(-1)[0];
    let startIndex, requestedStart;
    if (range === "1W" || range === "3D") {
      const sessions = range === "1W" ? 5 : 3;
      startIndex = Math.max(0, history.length - sessions - 1);
      requestedStart = history[startIndex][0];
    } else {
      requestedStart = range === "YTD" ? (Number(anchor.slice(0, 4)) - 1) + "-12-31" : U.rangeStart(anchor, range);
      startIndex = 0;
      for (let i = 0; i < history.length && history[i][0] <= requestedStart; i++) startIndex = i;
    }
    const selected = history.slice(startIndex), first = selected[0], last = selected.at(-1);
    const incomplete = first[0] > requestedStart || !U.validNumber(first[1]) || !U.validNumber(last[1]) ||
      ((range === "1W" || range === "3D") && selected.length < (range === "1W" ? 6 : 4));
    const validComparison = !incomplete && first[1] > 0;
    return {history: selected, start: first[0], end: last[0], incomplete,
      change: validComparison ? last[1] - first[1] : null,
      percent: validComparison ? (last[1] / first[1] - 1) * 100 : null};
  }
  function sortRows(rows, key, descending = true) {
    return [...rows].sort((a, b) => {
      const first = U.validNumber(a[key]), second = U.validNumber(b[key]);
      if (first !== second) return first ? -1 : 1;
      if (first && a[key] !== b[key]) return (a[key] - b[key]) * (descending ? -1 : 1);
      return a.ticker.localeCompare(b.ticker, "en");
    });
  }
  function performanceFor(positions, data, day, range = "1M") {
    let start = null;
    if (U.isDate(day) && RANGES.some(item => item.key === range)) {
      if (range === "1W" || range === "3D") {
        const held = new Set(positions.map(p => p.ticker)), days = new Set();
        for (const security of data.series) if (held.has(security.id)) for (const row of security.history)
          if (row[0] <= day && U.validNumber(row[1])) days.add(row[0]);
        const sessions = range === "1W" ? 5 : 3, dates = [...days].sort();
        start = dates.length > sessions ? dates[dates.length - sessions - 1] : null;
      } else start = range === "YTD" ? (Number(day.slice(0, 4)) - 1) + "-12-31" : U.rangeStart(day, range);
    }
    if (!start) return {start: null, end: U.isDate(day) ? day : null, rows: [], missing: positions.map(p => p.ticker)};
    const current = valuationAt(positions, data, day), baseline = valuationAt(positions, data, start);
    const previous = new Map(baseline.rows.map(row => [row.ticker, row])), missing = [], rows = [];
    for (const row of current.rows) {
      const old = previous.get(row.ticker);
      if (!U.validNumber(row.value_cad) || !U.validNumber(old?.value_cad) || old.value_cad <= 0) {missing.push(row.ticker); continue;}
      rows.push({...row, start_price_date: old.price_date, change_cad: row.value_cad - old.value_cad,
        percent: (row.value_cad / old.value_cad - 1) * 100});
    }
    return {start, end: day, rows: sortRows(rows, "percent"), missing};
  }
  function monthlyPerformance(positions, data, day) {return performanceFor(positions, data, day, "1M");}
  return {RANGES, normalizePrices, normalizePositions, observationAt, valuationAt, historyFor, period, sortRows, performanceFor, monthlyPerformance};
});
