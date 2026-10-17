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
  return {KINDS, localDay, normalizeReport, normalize};
});
