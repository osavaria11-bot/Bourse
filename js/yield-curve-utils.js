(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./macro-utils.js"));
  else root.YieldCurveUtils = factory(root.MacroUtils);
})(typeof globalThis !== "undefined" ? globalThis : this, function (U) {
  "use strict";
  const START = "2016-01-01";
  const CONTRACTS = {
    US: {title: "États-Unis · USD", currency: "USD", source_url: "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve",
      tenors: [["1M", "1 mois", 1, "1 Mo"], ["3M", "3 mois", 3, "3 Mo"], ["6M", "6 mois", 6, "6 Mo"], ["1Y", "1 an", 12, "1 Yr"], ["2Y", "2 ans", 24, "2 Yr"], ["3Y", "3 ans", 36, "3 Yr"], ["5Y", "5 ans", 60, "5 Yr"], ["7Y", "7 ans", 84, "7 Yr"], ["10Y", "10 ans", 120, "10 Yr"], ["20Y", "20 ans", 240, "20 Yr"], ["30Y", "30 ans", 360, "30 Yr"]]},
    CA: {title: "Canada · CAD", currency: "CAD", source_url: "https://www.bankofcanada.ca/rates/interest-rates/canadian-bonds/",
      tenors: [["1M", "1 mois", 1, "TB.CDN.30D.MID"], ["3M", "3 mois", 3, "TB.CDN.90D.MID"], ["6M", "6 mois", 6, "TB.CDN.180D.MID"], ["1Y", "1 an", 12, "TB.CDN.1Y.MID"], ["2Y", "2 ans", 24, "BD.CDN.2YR.DQ.YLD"], ["3Y", "3 ans", 36, "BD.CDN.3YR.DQ.YLD"], ["5Y", "5 ans", 60, "BD.CDN.5YR.DQ.YLD"], ["7Y", "7 ans", 84, "BD.CDN.7YR.DQ.YLD"], ["10Y", "10 ans", 120, "BD.CDN.10YR.DQ.YLD"], ["LONG", "Long", 360, "BD.CDN.LONG.DQ.YLD"]]}
  };
  function localDay(now = Date.now()) {return new Intl.DateTimeFormat("en-CA", {timeZone: "America/Toronto"}).format(now);}
  function normalize(payload, now = Date.now()) {
    const generated = U.parseTimestamp(payload?.generated_at), today = localDay(now);
    if (payload?.schema_version !== 1 || payload.kind !== "sovereign_yield_curves" || payload.unit !== "percent" || payload.timezone !== "America/Toronto" || payload.history_start !== START ||
        !Number.isFinite(generated) || generated > now + 300000 || !Array.isArray(payload.countries) || payload.countries.length !== 2) throw new Error("Courbes souveraines invalides");
    const seen = new Set(), countries = payload.countries.map(country => {
      const expected = CONTRACTS[country?.id];
      if (!expected || seen.has(country.id) || country.currency !== expected.currency || country.source_url !== expected.source_url ||
          !["fresh", "cached", "unavailable"].includes(country.fetch_status) || !Array.isArray(country.tenors) || country.tenors.length !== expected.tenors.length ||
          !Array.isArray(country.history) || country.history.length > 15000) throw new Error("Pays ou source de courbe incohérents");
      seen.add(country.id);
      const tenors = expected.tenors.map(([key, label, months, series_id], index) => {
        const supplied = country.tenors[index];
        if (!supplied || supplied.key !== key || supplied.months !== months || supplied.series_id !== series_id) throw new Error("Échéance ou série incohérente");
        return {key, label, months, series_id};
      });
      let previous = "";
      const history = country.history.map(row => {
        if (!Array.isArray(row) || row.length !== tenors.length + 1 || !U.isDate(row[0]) || row[0] < START || row[0] > today || row[0] <= previous || [0, 6].includes(new Date(row[0] + "T12:00:00Z").getUTCDay()) ||
            row.slice(1).some(value => value !== null && (!U.validNumber(value) || value < -20 || value > 100))) throw new Error("Observation de courbe invalide");
        previous = row[0]; return [...row];
      });
      const fetched = U.parseTimestamp(country.last_successful_fetch);
      if ((history.length && (!Number.isFinite(fetched) || fetched > now + 300000 || fetched > generated + 300000 || country.fetch_status === "unavailable")) ||
          (!history.length && (country.fetch_status !== "unavailable" || country.last_successful_fetch !== null))) throw new Error("Fraîcheur de courbe incohérente");
      return {...country, title: expected.title, tenors, history};
    });
    return {...payload, countries};
  }
  function snapshot(country, requested) {
    if (!U.isDate(requested)) return null;
    const history = country?.history || [];
    let low = 0, high = history.length - 1, index = -1;
    while (low <= high) {const middle = (low + high) >>> 1; if (history[middle][0] <= requested) {index = middle; low = middle + 1;} else high = middle - 1;}
    while (index >= 0 && !history[index].slice(1).some(U.validNumber)) index--;
    const row = history[index];
    if (!row || Date.parse(requested) - Date.parse(row[0]) > 7 * 86400000) return null;
    return {requested, date: row[0], values: row.slice(1), adjusted: requested !== row[0]};
  }
  function basisPoints(a, b) {return U.validNumber(a) && U.validNumber(b) ? Math.abs(b - a) < 1e-10 ? 0 : (b - a) * 100 : null;}
  function comparison(country, dateA, dateB) {
    const a = snapshot(country, dateA), b = snapshot(country, dateB);
    const rows = country.tenors.map((tenor, index) => ({...tenor, a: a?.values[index] ?? null, b: b?.values[index] ?? null,
      change_bp: basisPoints(a?.values[index], b?.values[index])}));
    const byKey = new Map(rows.map(row => [row.key, row]));
    function slope(short) {
      const first = byKey.get(short), last = byKey.get("10Y");
      const firstSlope = basisPoints(first?.a, last?.a), secondSlope = basisPoints(first?.b, last?.b);
      return {a: firstSlope, b: secondSlope, change_bp: U.validNumber(firstSlope) && U.validNumber(secondSlope) ? secondSlope - firstSlope : null};
    }
    return {country, a, b, rows, slope_2_10: slope("2Y"), slope_3m_10: slope("3M")};
  }
  function defaults(data, preset = "1M") {
    const available = data.countries.filter(country => country.history.length);
    if (!available.length) return null;
    const last = available.map(country => country.history.filter(row => row.slice(1).some(U.validNumber)).at(-1)?.[0]).filter(Boolean);
    if (!last.length) return null;
    const b = last.sort()[0];
    return {b, a: preset === "YTD" ? (Number(b.slice(0, 4)) - 1) + "-12-31" : U.rangeStart(b, preset)};
  }
  return {START, CONTRACTS, localDay, normalize, snapshot, basisPoints, comparison, defaults};
});
