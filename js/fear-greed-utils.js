(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./macro-utils.js"));
  else root.FearGreedUtils = factory(root.MacroUtils);
})(typeof globalThis !== "undefined" ? globalThis : this, function (U) {
  "use strict";
  const SOURCE_URL = "https://www.cnn.com/markets/fear-and-greed";
  const RATINGS = {"extreme fear": "Peur extrême", fear: "Peur", neutral: "Neutre", greed: "Avidité", "extreme greed": "Avidité extrême"};
  const validScore = value => U.validNumber(value) && value >= 0 && value <= 100;
  const stamp = value => typeof value === "string" && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? U.parseTimestamp(value) : NaN;
  function normalize(payload, now = Date.now()) {
    const generated = stamp(payload?.generated_at);
    if (payload?.schema_version !== 1 || payload.kind !== "cnn_fear_and_greed" || payload.provider !== "cnn" ||
        !Number.isFinite(generated) || generated > now + 300000 ||
        !["fresh", "cached", "unavailable"].includes(payload.fetch_status)) throw new Error("Indice CNN invalide");
    const source = {source_label: "CNN", source_url: SOURCE_URL};
    if (payload.fetch_status === "unavailable") {
      if (payload.score !== null) throw new Error("Statut CNN incohérent");
      return {...payload, ...source, score: null, rating: null, timestamp: null, previous_close: null};
    }
    const published = stamp(payload.timestamp), fetched = stamp(payload.last_successful_fetch);
    if (!validScore(payload.score) || !Object.hasOwn(RATINGS, payload.rating) ||
        !Number.isFinite(published) || published < Date.UTC(2000, 0) || published > now + 300000 || published > generated + 300000 ||
        !Number.isFinite(fetched) || fetched > generated + 300000 || published > fetched + 300000) throw new Error("Publication CNN invalide");
    return {...payload, ...source, previous_close: validScore(payload.previous_close) ? payload.previous_close : null};
  }
  function changeLabel(point) {
    if (!validScore(point?.score) || !validScore(point.previous_close)) return "";
    const delta = point.score - point.previous_close;
    return (Math.abs(delta) < .05 ? "Stable" : (delta > 0 ? "+" : "−") + U.formatNumber(Math.abs(delta), 1) + " pts") +
      " depuis la clôture précédente";
  }
  return {SOURCE_URL, RATINGS, validScore, normalize, changeLabel};
});
