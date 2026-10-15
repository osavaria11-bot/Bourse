(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./macro-utils.js"), require("./portfolio-utils.js"));
  else root.PortfolioHeatmapUtils = factory(root.MacroUtils, root.PortfolioUtils);
})(typeof globalThis !== "undefined" ? globalThis : this, function (U, P) {
  "use strict";
  const RANGES = [{key: "1D", label: "Jour", limit: 3}, {key: "1W", label: "1 sem.", limit: 8},
    {key: "1M", label: "1 mois", limit: 15}, {key: "3M", label: "3 mois", limit: 30}, {key: "YTD", label: "YTD", limit: 50}];
  function model(current, prices, quoteData = prices, range = "1D") {
    if (!RANGES.some(item => item.key === range)) throw new Error("Période de heatmap invalide");
    const securities = new Map((prices?.series || []).map(row => [row.id, row]));
    const quotes = new Map((quoteData?.series || []).filter(row => row.current_quote).map(row => [row.id, row.current_quote]));
    const held = new Set((current?.rows || []).map(row => row.ticker));
    const dated = (current?.rows || []).map(row => ({...row, quote: quotes.get(row.ticker),
      session_date: quotes.get(row.ticker)?.session_date || row.price_date?.slice(0, 10) || null}));
    const end = dated.map(row => row.session_date).filter(U.isDate).sort().at(-1) || null;
    let start = null;
    if (end && range === "1W") {
      const days = new Set([end]);
      for (const row of prices?.series || []) if (held.has(row.id)) for (const [day, value] of row.history || [])
        if (day <= end && U.isDate(day) && value > 0 && U.validNumber(value)) days.add(day);
      start = [...days].sort().at(-6) || null;
    } else if (end && range !== "1D") start = range === "YTD" ? (Number(end.slice(0, 4)) - 1) + "-12-31" : U.rangeStart(end, range);
    const rows = dated.map(row => {
      const security = securities.get(row.ticker);
      let percent = null, baseline_date = null, reason = null;
      if (!(row.price > 0) || !U.validNumber(row.price) || !U.isDate(row.session_date)) reason = "Cours indisponible";
      else if (row.session_date !== end) reason = "Cours d’une séance antérieure";
      else if (range === "1D") {
        const change = P.sessionChange(security, row.price, row.price_date, row.quote);
        if (change) percent = change.percent;
        else reason = "Clôture précédente indisponible";
      } else {
        const base = start && security ? P.observationAt(security.history, start) : null;
        if (base?.[1] > 0 && base[0] < end) {percent = (row.price / base[1] - 1) * 100; baseline_date = base[0];}
        else reason = "Historique insuffisant";
      }
      if (percent !== null && !U.validNumber(percent)) {percent = null; reason = "Variation indisponible";}
      if (percent !== null && Math.abs(percent) < .005) percent = 0;
      return {...row, percent, baseline_date, reason,
        weight: current?.complete && current.total > 0 && U.validNumber(row.value_cad) ? row.value_cad / current.total * 100 : null};
    });
    const valued = rows.filter(row => U.validNumber(row.value_cad) && row.value_cad > 0);
    return {rows, valued, start, end, range, complete: !!current?.complete,
      missing: rows.filter(row => !valued.includes(row)).map(row => row.ticker),
      unavailable: rows.filter(row => row.percent === null).map(row => row.ticker)};
  }
  // Balanced binary treemap. Every outer tile area is exactly proportional to
  // its CAD value; tiny holdings are never enlarged or silently dropped.
  function layout(rows, width, height) {
    if (!(width > 0 && height > 0) || !Number.isFinite(width + height)) return [];
    const sorted = rows.filter(row => U.validNumber(row.value_cad) && row.value_cad > 0)
      .slice().sort((a, b) => b.value_cad - a.value_cad || a.ticker.localeCompare(b.ticker, "en"));
    const output = [];
    function split(items, x, y, w, h) {
      if (!items.length) return;
      if (items.length === 1) {output.push({...items[0], x, y, width: w, height: h}); return;}
      const total = items.reduce((sum, row) => sum + row.value_cad, 0);
      let sum = 0, best = Infinity, index = 1, first = items[0].value_cad;
      for (let i = 1; i < items.length; i++) {
        sum += items[i - 1].value_cad;
        const distance = Math.abs(total / 2 - sum);
        if (distance < best) {best = distance; index = i; first = sum;}
      }
      const fraction = first / total;
      if (w >= h) {
        split(items.slice(0, index), x, y, w * fraction, h);
        split(items.slice(index), x + w * fraction, y, w * (1 - fraction), h);
      } else {
        split(items.slice(0, index), x, y, w, h * fraction);
        split(items.slice(index), x, y + h * fraction, w, h * (1 - fraction));
      }
    }
    split(sorted, 0, 0, width, height);
    return output;
  }
  function color(percent, limit) {
    if (!U.validNumber(percent) || !(limit > 0)) return "#263747";
    const neutral = [38, 55, 71], target = percent < 0 ? [174, 55, 70] : [22, 120, 77];
    const strength = Math.pow(Math.min(Math.abs(percent) / limit, 1), .65);
    return "#" + neutral.map((value, index) => Math.round(value + (target[index] - value) * strength).toString(16).padStart(2, "0")).join("");
  }
  return {RANGES, model, layout, color};
});
