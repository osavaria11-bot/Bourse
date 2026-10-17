(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./macro-utils.js"));
  else root.PolymarketUtils = factory(root.MacroUtils);
})(typeof globalThis !== "undefined" ? globalThis : this, function (U) {
  "use strict";
  const GROUPS = [{id:"finance", label:"Finance", count:3, ranking:"volume"}, {id:"popular", label:"Populaire · politique", count:2, ranking:"volume24hr"}];
  const stamp = value => typeof value === "string" && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? U.parseTimestamp(value) : NaN;
  const validNumber = value => U.validNumber(value) && value >= 0;
  function normalizeEvent(row, now) {
    if (!row || typeof row.id !== "string" || !/^\d+$/.test(row.id) || typeof row.slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.slug) ||
        row.url !== "https://polymarket.com/event/" + row.slug || typeof row.title !== "string" || !row.title.trim() ||
        !validNumber(row.volume) || row.volume <= 0 || !validNumber(row.volume_24h) || !Number.isFinite(stamp(row.ends_at))) throw new Error("Événement Polymarket invalide");
    if (stamp(row.ends_at) <= now) return null;
    if (!Array.isArray(row.outcomes) || row.outcomes.length < 1 || row.outcomes.length > 2) throw new Error("Scénarios Polymarket invalides");
    const outcomes = row.outcomes.filter(point => {
      if (typeof point?.label !== "string" || !point.label.trim() || !validNumber(point.probability) || point.probability > 1 ||
          typeof point.market_id !== "string" || !/^\d+$/.test(point.market_id) || !Number.isFinite(stamp(point.ends_at))) throw new Error("Probabilité Polymarket invalide");
      return stamp(point.ends_at) > now;
    });
    return outcomes.length ? {...row, outcomes} : null;
  }
  function normalize(payload, now = Date.now()) {
    const generated = stamp(payload?.generated_at);
    if (payload?.schema_version !== 1 || payload.kind !== "polymarket_events" || payload.provider !== "polymarket" ||
        !Number.isFinite(generated) || generated < Date.UTC(2000, 0) || generated > now + 300000 || !payload.groups) throw new Error("Données Polymarket invalides");
    const groups = {}, seen = new Set();
    for (const spec of GROUPS) {
      const raw = payload.groups[spec.id], fetched = stamp(raw?.fetched_at);
      if (!raw || raw.ranking !== spec.ranking || !["fresh", "cached", "unavailable"].includes(raw.fetch_status) || !Array.isArray(raw.events) || raw.events.length > spec.count) throw new Error("Sélection Polymarket invalide");
      if (raw.fetch_status === "unavailable") {
        if (raw.events.length || raw.fetched_at !== null) throw new Error("Disponibilité Polymarket incohérente");
        groups[spec.id] = {...raw, events:[]}; continue;
      }
      if (!Number.isFinite(fetched) || fetched < Date.UTC(2000, 0) || fetched > generated + 300000 || fetched > now + 300000) throw new Error("Relevé Polymarket invalide");
      const events = raw.events.map(row => normalizeEvent(row, now)).filter(Boolean);
      for (const event of events) {
        if (seen.has(event.id)) throw new Error("Événement Polymarket en double");
        seen.add(event.id);
      }
      groups[spec.id] = {...raw, events};
    }
    return {...payload, groups};
  }
  function merge(current, incoming, now = Date.now()) {
    const next = normalize(incoming, now);
    if (!current) return next;
    const previous = normalize(current, now);
    for (const spec of GROUPS) {
      const old = previous.groups[spec.id], fresh = next.groups[spec.id];
      if (old.events.length && (!fresh.events.length || stamp(fresh.fetched_at) < stamp(old.fetched_at))) {
        next.groups[spec.id] = {...old, fetch_status:"cached"};
        next.generated_at = new Date(Math.max(stamp(next.generated_at), stamp(previous.generated_at))).toISOString();
      }
    }
    // A changed Finance selection can overlap a retained Politics snapshot.
    const finance = new Set(next.groups.finance.events.map(event => event.id));
    next.groups.popular.events = next.groups.popular.events.filter(event => !finance.has(event.id));
    return next;
  }
  const label = value => value === "Yes" ? "Oui" : value === "No" ? "Non" : value;
  const percent = value => U.formatNumber(value * 100, 1).replace(/,0$/, "") + " %";
  const volume = value => new Intl.NumberFormat("fr-CA", {notation:"compact", maximumFractionDigits:1}).format(value) + " $ US";
  return {GROUPS, normalize, merge, label, percent, volume};
});
