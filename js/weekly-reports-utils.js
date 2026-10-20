(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./macro-utils.js"));
  else root.WeeklyReportsUtils = factory(root.MacroUtils);
})(typeof globalThis !== "undefined" ? globalThis : this, function (U) {
  "use strict";
  const KINDS = ["real_estate", "stocks"];
  const text = (value, max = 2000) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
  function localDay(now = Date.now()) {
    return new Intl.DateTimeFormat("en-CA", {timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit"}).format(new Date(now));
  }
  function normalizeReport(value, kind, now = Date.now()) {
    if (!KINDS.includes(kind) || !value || !U.isDate(value.edition_date) || value.edition_date < "2000-01-01" || value.edition_date > localDay(now) ||
        !text(value.title, 180) || !text(value.summary) || !["full", "summary"].includes(value.document_scope)) throw new Error("Édition hebdomadaire invalide");
    const folder = kind === "real_estate" ? "real-estate" : "stocks", doc = value.document;
    if (doc?.path !== "reports/" + folder + "/" + value.edition_date + ".pdf" || doc.mime_type !== "application/pdf" ||
        !text(doc.label, 120) || !Number.isInteger(doc.pages) || doc.pages < 1 || !Number.isInteger(doc.size_bytes) || doc.size_bytes < 100 ||
        !/^[a-f0-9]{64}$/.test(doc.sha256 || "")) throw new Error("Document hebdomadaire invalide");
    const highlights = Array.isArray(value.highlights) ? value.highlights.filter(row => text(row, 1200)).slice(0, 6) : [];
    if (kind === "stocks") {
      if (!Array.isArray(value.stocks) || value.stocks.length > 5 || !U.isDate(value.reference_date) || value.reference_date > value.edition_date ||
          !text(value.method_note, 1000)) throw new Error("Classement hebdomadaire invalide");
      const seen = new Set();
      for (const [index, row] of value.stocks.entries()) {
        if (row.rank !== index + 1 || !/^[A-Z][A-Z0-9.-]{0,14}$/.test(row.ticker || "") || seen.has(row.ticker) ||
            !text(row.company, 120) || !text(row.summary, 1200) || !["BUY", "HOLD", "SELL", null].includes(row.decision) ||
            (row.rating !== null && (!U.validNumber(row.rating) || row.rating < 0 || row.rating > 5)) ||
            !text(row.central_label, 180) || !text(row.risk, 600)) throw new Error("Titre hebdomadaire invalide");
        seen.add(row.ticker);
      }
    }
    const opportunities = kind === "real_estate" && Array.isArray(value.opportunities) ? value.opportunities.filter(row =>
      text(row.address, 180) && text(row.city, 120) && text(row.detail, 600)).slice(0, 3) : [];
    return {...value, highlights, opportunities};
  }
  function normalize(payload, now = Date.now()) {
    const generated = typeof payload?.generated_at === "string" ? U.parseTimestamp(payload.generated_at) : NaN;
    if (payload?.schema_version !== 1 || payload.kind !== "savy_weekly_reports" || !payload.reports ||
        !Number.isFinite(generated) || generated > now + 300000) throw new Error("Rapports hebdomadaires indisponibles");
    const reports = {};
    for (const kind of KINDS) {
      try {reports[kind] = normalizeReport(payload.reports[kind], kind, now);} catch {reports[kind] = null;}
    }
    return {...payload, reports};
  }
  const PERFORMANCE_IDS = ["top5", "others", "spy"];
  function normalizePerformance(value, now = Date.now()) {
    if (value?.schema_version !== 1 || value.kind !== "savy_finviz_performance" || value.currency !== "USD" ||
        value.return_basis !== "price_return" || value.initial_capital !== 10000 || value.launch_date !== "2026-09-30" ||
        !Number.isFinite(U.parseTimestamp(value.generated_at)) || U.parseTimestamp(value.generated_at) > now + 300000 ||
        !Array.isArray(value.dates) || !value.dates.length || value.dates.length > 10000 || value.dates[0] !== value.launch_date ||
        value.as_of !== value.dates.at(-1) || !value.dates.includes(value.period_start) || !text(value.method_note, 2000))
      throw new Error("Suivi Finviz invalide");
    value.dates.forEach((day, i) => {
      if (!U.isDate(day) || day > localDay(now) || (i && day <= value.dates[i-1])) throw new Error("Dates du suivi incompatibles");
    });
    const values = {};
    for (const id of PERFORMANCE_IDS) {
      const series = value.values?.[id];
      if (!Array.isArray(series) || series.length !== value.dates.length || series[0] !== value.initial_capital ||
          series.some(v => !U.validNumber(v) || v <= 0)) throw new Error("Valeurs du suivi incompatibles");
      values[id] = [...series];
    }
    // Explicit public projection: never retain private fields from the source state.
    return {schema_version:1, kind:value.kind, generated_at:value.generated_at, currency:"USD", return_basis:"price_return",
      initial_capital:10000, launch_date:value.launch_date, as_of:value.as_of, period_start:value.period_start,
      dates:[...value.dates], values, method_note:value.method_note};
  }
  function continuePerformance(previous, next) {
    if (previous && (next.dates.length < previous.dates.length || previous.dates.some((day,i) => day !== next.dates[i] ||
        PERFORMANCE_IDS.some(id => previous.values[id][i] !== next.values[id][i]))))
      throw new Error("L’historique Finviz publié doit être conservé");
    return next;
  }
  function performanceRows(data) {
    const start = data.dates.indexOf(data.period_start), total = id => data.values[id].at(-1) / data.initial_capital - 1;
    const period = id => data.values[id].at(-1) / data.values[id][start] - 1;
    return PERFORMANCE_IDS.map(id => ({id, value:data.values[id].at(-1), total:total(id), period:period(id),
      gap_total:total(id)-total("spy"), gap_period:period(id)-period("spy")}));
  }
  return {KINDS, localDay, normalizeReport, normalize, PERFORMANCE_IDS, normalizePerformance, continuePerformance, performanceRows};
});
