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
  const MARKET_RANGES = [
    { key: "1D", label: "1 jour" },
    { key: "3D", label: "3 jours" }, { key: "1W", label: "1 semaine" },
    ...RANGES.slice(0, 2), { key: "YTD", label: "YTD" }, ...RANGES.slice(2),
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
      const bankPolicy = point.provider === "bank_of_canada" && point.id === "V39079";
      series.push({
        ...point, date: day, value, history, fetch_status: fetchStatus,
        title: typeof point.title === "string" ? point.title : point.id,
        category: typeof point.category === "string" ? point.category : "Autres",
        unit: typeof point.unit === "string" ? point.unit : "",
        decimals: Number.isInteger(point.decimals) ? Math.min(4, Math.max(0, point.decimals)) : 2,
        description: typeof point.description === "string" ? point.description : "",
        change: validNumber(point.change) ? point.change : null,
        previous_date: isDate(point.previous_date) && point.previous_date <= today ? point.previous_date : null,
        source_url: bankPolicy ? "https://www.bankofcanada.ca/core-functions/monetary-policy/key-interest-rate/" : "https://fred.stlouisfed.org/series/" + point.id,
        source_label: bankPolicy ? "Banque du Canada" : "FRED",
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
    if (options.sort === "recent") {
      const dates = new Map(output.map(point => {
        const date = parseTimestamp(options.dateFor ? options.dateFor(point) : point.date);
        return [point.id, Number.isFinite(date) ? date : -Infinity];
      }));
      output.sort((a, b) => dates.get(b.id) - dates.get(a.id));
    }
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
  function marketPeriod(point, range) {
    const anchor = point?.date || point?.history?.at(-1)?.[0];
    const history = (point?.history || []).filter(row => row[0] <= anchor);
    if (!isDate(anchor) || !history.length || !MARKET_RANGES.some(item => item.key === range)) {
      return {history: [], start: null, end: null, change: null, percent: null, incomplete: true};
    }
    const last = history.at(-1);
    let baseline, requestedStart, incomplete = !validNumber(point.value) || point.value <= 0 ||
      last[0] !== anchor || last[1] !== point.value;
    const sessions = {"1D": 1, "3D": 3, "1W": 5}[range];
    if (sessions) {
      baseline = history.at(-sessions - 1);
      requestedStart = baseline?.[0];
      incomplete ||= !baseline;
    } else {
      requestedStart = range === "YTD" ? (Number(anchor.slice(0, 4)) - 1) + "-12-31" : rangeStart(anchor, range);
      baseline = history.filter(row => row[0] <= requestedStart).at(-1);
      incomplete ||= !baseline || Date.parse(requestedStart) - Date.parse(baseline[0]) > 7 * DAY;
    }
    baseline ||= history[0];
    incomplete ||= !validNumber(baseline[1]) || baseline[1] <= 0;
    const selected = history.filter(row => row[0] >= baseline[0]);
    return {history: selected, start: baseline[0], end: last[0], requestedStart, incomplete,
      change: incomplete ? null : last[1] - baseline[1],
      percent: incomplete ? null : (last[1] / baseline[1] - 1) * 100};
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
      ["Indicateur", "Code de série", "Catégorie", "Valeur", "Unité", "Période", "Valeur précédente", "Période précédente", "Variation", "Statut de collecte", "Dernière collecte réussie", "Source"],
      ...series.map(point => [point.title, point.id, point.category, point.value, point.unit, point.date, point.previous_value, point.previous_date, point.change, point.fetch_status, point.last_successful_fetch, point.source_url]),
    ]);
  }
  function historyCSV(point, range) {
    return toCSV([
      ["Code de série", "Indicateur", "Transformation", "Période", "Valeur", "Unité", "Source"],
      ...visibleHistory(point, range).map(row => [point.id, point.title, point.transform, row[0], row[1], point.unit, point.source_url]),
    ]);
  }
  function ageDays(day, now = new Date()) {
    return isDate(day) ? Math.floor((now.getTime() - Date.parse(day + "T00:00:00Z")) / DAY) : null;
  }
  function rateOddsFor(dataset, id, now = new Date()) {
    const stamp = now.getTime(), collected = parseTimestamp(dataset?.generated_at);
    if (!Number.isFinite(stamp) || !Number.isFinite(collected) || collected > stamp + 300000 ||
        dataset?.schema_version !== 1 || dataset.kind !== "rate_odds" || !Array.isArray(dataset.decisions)) return null;
    const row = dataset.decisions.find(item => item?.id === id);
    if (!row || !isDate(row.as_of) || !isDate(row.meeting_date)) return null;
    const parts = new Intl.DateTimeFormat("en-US", {timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit"}).formatToParts(now);
    const part = type => parts.find(item => item.type === type).value;
    const today = part("year") + "-" + part("month") + "-" + part("day");
    // A published source date can match the collection's UTC day before Quebec's day rolls over.
    const sourceDay = new Date(Math.min(stamp, collected)).toISOString().slice(0, 10);
    const age = (stamp - Date.parse(row.as_of + "T23:59:59Z")) / DAY;
    if (age < -1 || age > 5 || row.as_of > sourceDay || row.as_of >= row.meeting_date || row.meeting_date < today ||
        ![row.hike, row.hold, row.cut].every(n => Number.isInteger(n) && n >= 0 && n <= 100) ||
        Math.abs(row.hike + row.hold + row.cut - 100) > 1) return null;
    return {row, age, sourceDayAhead: row.as_of > today};
  }
  return { RANGES, MARKET_RANGES, isDate, validNumber, parseTimestamp, normalizeDataset, formatNumber, observationLabel, timestampLabel, changeLabel, filterSeries, rangeStart, visibleHistory, marketPeriod, niceExtent, nearestPoint, csvCell, toCSV, snapshotCSV, historyCSV, ageDays, rateOddsFor };
});
