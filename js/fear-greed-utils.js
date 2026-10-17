(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./macro-utils.js"));
  else root.FearGreedUtils = factory(root.MacroUtils);
})(typeof globalThis !== "undefined" ? globalThis : this, function (U) {
  "use strict";
  const SOURCE_URL = "https://www.cnn.com/markets/fear-and-greed";
  const RATINGS = {"extreme fear": "Peur extrême", fear: "Peur", neutral: "Neutre", greed: "Avidité", "extreme greed": "Avidité extrême"};
  const RANGES = [{key: "1M", label: "1 mois"}, {key: "3M", label: "3 mois"}, {key: "1Y", label: "1 an"}];
  const validScore = value => U.validNumber(value) && value >= 0 && value <= 100;
  const stamp = value => typeof value === "string" && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? U.parseTimestamp(value) : NaN;
  function normalizeHistory(rows, point) {
    if (!validScore(point?.score) || !Number.isFinite(stamp(point.timestamp))) return [];
    const end = new Date(stamp(point.timestamp)).toISOString().slice(0, 10), byDate = new Map();
    if (Array.isArray(rows)) for (const row of rows) {
      if (Array.isArray(row) && row.length === 2 && U.isDate(row[0]) && row[0] >= "2000-01-01" && row[0] <= end && validScore(row[1])) byDate.set(row[0], row[1]);
    }
    if (byDate.size) byDate.set(end, point.score);
    return [...byDate].sort((a, b) => a[0].localeCompare(b[0]));
  }
  function visibleHistory(point, range) {
    const rows = normalizeHistory(point?.history, point);
    if (!rows.length) return [];
    const start = U.rangeStart(rows.at(-1)[0], RANGES.some(item => item.key === range) ? range : "1Y");
    return rows.filter(row => row[0] >= start);
  }
  function normalize(payload, now = Date.now()) {
    const generated = stamp(payload?.generated_at);
    if (payload?.schema_version !== 1 || payload.kind !== "cnn_fear_and_greed" || payload.provider !== "cnn" ||
        !Number.isFinite(generated) || generated > now + 300000 ||
        !["fresh", "cached", "unavailable"].includes(payload.fetch_status)) throw new Error("Indice CNN invalide");
    const source = {source_label: "CNN", source_url: SOURCE_URL};
    if (payload.fetch_status === "unavailable") {
      if (payload.score !== null) throw new Error("Statut CNN incohérent");
      return {...payload, ...source, score: null, rating: null, timestamp: null, previous_close: null, history: [], history_status: "unavailable"};
    }
    const published = stamp(payload.timestamp), fetched = stamp(payload.last_successful_fetch);
    if (!validScore(payload.score) || !Object.hasOwn(RATINGS, payload.rating) ||
        !Number.isFinite(published) || published < Date.UTC(2000, 0) || published > now + 300000 || published > generated + 300000 ||
        !Number.isFinite(fetched) || fetched > generated + 300000 || published > fetched + 300000) throw new Error("Publication CNN invalide");
    const history = normalizeHistory(payload.history, payload);
    return {...payload, ...source, previous_close: validScore(payload.previous_close) ? payload.previous_close : null, history,
      history_status: history.length ? (payload.history_status === "cached" || payload.fetch_status === "cached" ? "cached" : "fresh") : "unavailable"};
  }
  function changeLabel(point) {
    if (!validScore(point?.score) || !validScore(point.previous_close)) return "";
    const delta = point.score - point.previous_close;
    return (Math.abs(delta) < .05 ? "Stable" : (delta > 0 ? "+" : "−") + U.formatNumber(Math.abs(delta), 1) + " pts") +
      " depuis la clôture précédente";
  }
  return {SOURCE_URL, RATINGS, RANGES, validScore, normalizeHistory, visibleHistory, normalize, changeLabel};
});
