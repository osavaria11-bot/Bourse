(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./macro-utils.js"));
  else root.PortfolioExposureUtils = factory(root.MacroUtils);
})(typeof globalThis !== "undefined" ? globalThis : this, function (U) {
  "use strict";
  const AXES = ["sectors", "geography"], UNKNOWN = "unclassified", OTHER_COUNTRIES = "other_countries";
  function normalize(payload) {
    if (payload?.schema_version !== 1 || payload.kind !== "portfolio_exposures" || payload.benchmark !== "FEQT" ||
        !Number.isFinite(U.parseTimestamp(payload.generated_at)) || U.parseTimestamp(payload.generated_at) > Date.now() + 300000 ||
        !Array.isArray(payload.instruments) || !payload.labels) throw new Error("Répartitions invalides");
    const seen = new Set();
    const instruments = payload.instruments.map(item => {
      if (!item || !/^[A-Z0-9]{1,12}$/.test(item.id) || seen.has(item.id) || !U.isDate(item.as_of) ||
          Date.parse(item.as_of) > Date.now() + 86400000 || !/^https:\/\//.test(item.source_url)) throw new Error("Source de répartition invalide");
      seen.add(item.id);
      for (const key of ["underlying_source_url", "classification_source_url", "classification_secondary_source_url"])
        if (item[key] !== undefined && (typeof item[key] !== "string" || !/^https:\/\//.test(item[key]))) throw new Error("Lien de source invalide");
      const next = {...item};
      for (const axis of AXES) {
        if (!Array.isArray(item[axis]) || !item[axis].length) throw new Error("Répartition manquante");
        const categories = new Set(); let total = 0;
        next[axis] = item[axis].map(row => {
          if (!row || !/^[a-z0-9_]{1,60}$/.test(row.id) || categories.has(row.id) ||
              typeof payload.labels[axis]?.[row.id] !== "string" || !U.validNumber(row.weight) || row.weight < 0 || row.weight > 100)
            throw new Error("Pondération invalide");
          categories.add(row.id); total += row.weight; return {...row};
        });
        if (Math.abs(total - 100) > .001) throw new Error("Les répartitions doivent totaliser 100 %");
      }
      return next;
    });
    if (!seen.has("FEQT")) throw new Error("Référence FEQT manquante");
    return {...payload, instruments};
  }
  function compare(valuation, dataset, axis) {
    if (!AXES.includes(axis)) throw new Error("Répartition inconnue");
    if (!valuation?.complete || !(valuation.total > 0) || !dataset) return {available: false, rows: [], coverage: 0, sources: [], missing: []};
    const lookup = new Map(dataset.instruments.map(row => [row.id, row])), reference = lookup.get("FEQT");
    const weights = new Map(), sources = [], missing = [], countryDisclosures = [];
    let indicative = false;
    for (const holding of valuation.rows) {
      const instrument = lookup.get(holding.ticker), weight = holding.value_cad / valuation.total;
      if (!instrument) {weights.set(UNKNOWN, (weights.get(UNKNOWN) || 0) + weight * 100); missing.push(holding.ticker); continue;}
      sources.push({id: holding.ticker, as_of: axis === "sectors" ? instrument.sector_as_of || instrument.as_of : instrument.as_of,
        source_url: instrument.source_url, underlying_source_url: instrument.underlying_source_url, classification_source_url: instrument.classification_source_url,
        classification_secondary_source_url: instrument.classification_secondary_source_url,
        note: instrument.note, fetch_status: instrument.fetch_status});
      indicative ||= axis === "sectors" && instrument.sector_indicative === true;
      if (axis === "geography" && instrument.geography.some(row => row.id === OTHER_COUNTRIES && row.weight > .0001))
        countryDisclosures.push(new Set(instrument.geography.map(row => row.id)));
      for (const exposure of instrument[axis]) weights.set(exposure.id, (weights.get(exposure.id) || 0) + weight * exposure.weight);
    }
    const benchmark = new Map(reference[axis].map(row => [row.id, row.weight]));
    const unresolvedBenchmark = benchmark.get(axis === "geography" ? OTHER_COUNTRIES : UNKNOWN) || 0;
    const unresolvedPortfolio = weights.get(UNKNOWN) || 0;
    const ids = new Set([...weights.keys(), ...benchmark.keys()]);
    const rows = [...ids].map(id => {
      const own = weights.get(id) || 0;
      // Fidelity only publishes countries above its reporting threshold. Absence is not zero exposure.
      const knownReference = benchmark.has(id) || !unresolvedBenchmark;
      const portfolioUndisclosed = id !== UNKNOWN && id !== OTHER_COUNTRIES &&
        (unresolvedPortfolio >= .005 || countryDisclosures.some(known => !known.has(id)));
      const comparable = knownReference && id !== UNKNOWN && id !== OTHER_COUNTRIES && !portfolioUndisclosed;
      const ref = knownReference ? benchmark.get(id) || 0 : null;
      return {id, label: dataset.labels[axis][id] || "Non classé", portfolio: own, benchmark: ref,
        difference: comparable ? own - ref : null, benchmark_undisclosed: !knownReference, portfolio_undisclosed: portfolioUndisclosed};
    }).filter(row => row.portfolio > .0001 || row.benchmark > .0001)
      .sort((a, b) => b.portfolio - a.portfolio || (b.benchmark || 0) - (a.benchmark || 0));
    return {available: true, rows, coverage: 100 - unresolvedPortfolio, sources, missing, indicative,
      benchmark_date: reference.as_of, benchmark_source: reference.source_url, benchmark_note: reference.note};
  }
  return {normalize, compare};
});
