(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MacroUtils = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const RANGES = [
    { key: "1M", label: "1 mois" }, { key: "3M", label: "3 mois" },
    { key: "1Y", label: "1 an" }, { key: "5Y", label: "5 ans" }, { key: "10Y", label: "10 ans" },
  ];
  const DAY = 86400000;
  const validNumber = value => typeof value === "number" && Number.isFinite(value);
  function isDate(day) {
    if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
    const date = new Date(day + "T00:00:00Z");
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day;
  }
  function parseTimestamp(value) {
    if (typeof value !== "string") return NaN;
    return Date.parse(value.replace(" UTC", "Z").replace(" ", "T"));
  }
  function normalizeDataset(payload, today = new Date().toISOString().slice(0, 10)) {
    if (!payload || payload.schema_version !== 2 || !Array.isArray(payload.series) ||
        !Number.isFinite(parseTimestamp(payload.generated_at))) throw new Error("Fichier de données invalide");
    const seen = new Set();
    const series = [];
    for (const point of payload.series) {
      if (!point || typeof point.id !== "string" || !/^[A-Z0-9]+$/.test(point.id) || seen.has(point.id)) continue;
      seen.add(point.id);
      const day = isDate(point.date) && point.date <= today ? point.date : null;
      const value = day && validNumber(point.value) ? point.value : null;
      const byDate = new Map();
      if (Array.isArray(point.history)) for (const row of point.history) {
        if (Array.isArray(row) && isDate(row[0]) && row[0] <= today && (row[1] === null || validNumber(row[1]))) byDate.set(row[0], row[1]);
      }
      const history = [...byDate].sort((a, b) => a[0].localeCompare(b[0]));
      const fetchStatus = value === null ? "unavailable" : point.fetch_status === "fresh" ? "fresh" : "cached";
      series.push({
        ...point, date: day, value, history, fetch_status: fetchStatus,
        title: typeof point.title === "string" ? point.title : point.id,
        category: typeof point.category === "string" ? point.category : "Autres",
        unit: typeof point.unit === "string" ? point.unit : "",
        decimals: Number.isInteger(point.decimals) ? Math.min(4, Math.max(0, point.decimals)) : 2,
        description: typeof point.description === "string" ? point.description : "",
        change: validNumber(point.change) ? point.change : null,
        previous_date: isDate(point.previous_date) && point.previous_date <= today ? point.previous_date : null,
        source_url: "https://fred.stlouisfed.org/series/" + point.id,
      });
    }
    if (!series.length) throw new Error("Aucun indicateur valide");
    return { ...payload, series };
  }
  function formatNumber(value, decimals = 2, compact = false) {
    if (!validNumber(value)) return "—";
    return new Intl.NumberFormat("fr-CA", {
      maximumFractionDigits: decimals, minimumFractionDigits: compact ? 0 : decimals,
      ...(compact ? { notation: "compact" } : {}),
    }).format(value);
  }
  function observationLabel(day, frequency = "daily") {
    if (!isDate(day)) return "Période non disponible";
    const date = new Date(day + "T00:00:00Z");
    if (frequency === "quarterly") return "T" + (Math.floor(date.getUTCMonth() / 3) + 1) + " " + date.getUTCFullYear();
    return new Intl.DateTimeFormat("fr-CA", {
      timeZone: "UTC", year: "numeric", month: "short",
      ...(frequency === "monthly" ? {} : { day: "numeric" }),
    }).format(date);
  }
  function timestampLabel(value) {
    const stamp = parseTimestamp(value);
    if (!Number.isFinite(stamp)) return "date inconnue";
    return new Intl.DateTimeFormat("fr-CA", {
      timeZone: "America/Toronto", year: "numeric", month: "short",
      day: "numeric", hour: "2-digit", minute: "2-digit",
    }).format(stamp) + " (heure de Montréal)";
  }
  function changeLabel(point) {
    if (!validNumber(point.change) || !point.previous_date) return { text: "Comparaison non disponible", direction: "flat" };
    const delta = point.change;
    const roundedZero = Math.abs(delta) < 0.5 * 10 ** -point.decimals;
    if (roundedZero) return { text: "→ Stable", direction: "flat" };
    const unit = point.change_unit || point.unit || "";
    return { text: (delta > 0 ? "↑ +" : "↓ −") + formatNumber(Math.abs(delta), point.decimals) + " " + unit, direction: delta > 0 ? "up" : "down" };
  }
  function normalizeSearch(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  }
  function filterSeries(series, options = {}) {
    const search = normalizeSearch(options.search);
    const favorites = new Set(options.favorites || []);
    const output = series.filter(point =>
      (!options.category || options.category === "all" || point.category === options.category) &&
      (!options.favoritesOnly || favorites.has(point.id)) &&
      (!search || normalizeSearch([point.title, point.id, point.category, point.description].join(" ")).includes(search))
    );
    if (options.sort === "name") output.sort((a, b) => a.title.localeCompare(b.title, "fr", { sensitivity: "base" }));
    if (options.sort === "recent") output.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    return output;
  }
  function rangeStart(anchor, range) {
    if (!isDate(anchor)) return null;
    const months = { "1M": 1, "3M": 3, "6M": 6, "1Y": 12, "5Y": 60, "10Y": 120 }[range] || 120;
    const date = new Date(anchor + "T00:00:00Z");
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() - months);
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, lastDay));
    return date.toISOString().slice(0, 10);
  }
  function visibleHistory(point, range) {
    const history = point.history || [];
    const anchor = point.date || history.at(-1)?.[0];
    const start = rangeStart(anchor, range);
    return start ? history.filter(row => row[0] >= start && row[0] <= anchor) : [];
  }
  function niceExtent(history) {
    const values = history.map(row => row[1]).filter(validNumber);
    if (!values.length) return null;
    const min = Math.min(...values), max = Math.max(...values);
    const padding = max === min ? Math.max(Math.abs(max) * 0.08, 0.1) : (max - min) * 0.1;
    return [min - padding, max + padding];
  }
  function nearestPoint(history, targetTime) {
    const valid = history.filter(row => validNumber(row[1]));
    if (!valid.length) return null;
    let left = 0, right = valid.length - 1;
    while (left < right) {
      const middle = Math.floor((left + right) / 2);
      if (Date.parse(valid[middle][0]) < targetTime) left = middle + 1; else right = middle;
    }
    if (left > 0 && targetTime - Date.parse(valid[left - 1][0]) <= Date.parse(valid[left][0]) - targetTime) left -= 1;
    return valid[left];
  }
  function csvCell(value) {
    let text = value == null ? "" : String(value);
    // Only text gets formula protection; negative numeric values stay numeric.
    if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  function toCSV(rows) {
    return "\ufeff" + rows.map(row => row.map(csvCell).join(";")).join("\r\n") + "\r\n";
  }
  function snapshotCSV(series) {
    return toCSV([
      ["Indicateur", "Série FRED", "Catégorie", "Valeur", "Unité", "Période", "Valeur précédente", "Période précédente", "Variation", "Statut de collecte", "Dernière collecte réussie", "Source"],
      ...series.map(point => [point.title, point.id, point.category, point.value, point.unit, point.date, point.previous_value, point.previous_date, point.change, point.fetch_status, point.last_successful_fetch, point.source_url]),
    ]);
  }
  function historyCSV(point, range) {
    return toCSV([
      ["Série FRED", "Indicateur", "Transformation", "Période", "Valeur", "Unité", "Source"],
      ...visibleHistory(point, range).map(row => [point.id, point.title, point.transform, row[0], row[1], point.unit, point.source_url]),
    ]);
  }
  function ageDays(day, now = new Date()) {
    return isDate(day) ? Math.floor((now.getTime() - Date.parse(day + "T00:00:00Z")) / DAY) : null;
  }
  return { RANGES, isDate, validNumber, parseTimestamp, normalizeDataset, formatNumber, observationLabel, timestampLabel, changeLabel, filterSeries, rangeStart, visibleHistory, niceExtent, nearestPoint, csvCell, toCSV, snapshotCSV, historyCSV, ageDays };
});
