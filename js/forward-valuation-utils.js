(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./valuation-utils.js"));
  else root.SavyForwardUtils = factory(root.ValuationUtils);
})(typeof globalThis !== "undefined" ? globalThis : this, function (V) {
  "use strict";
  const positive = value => V.finite(value) && value > 0;
  const METRICS = ["pe", "ev_ebitda"];
  function quantile(values, p) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b), index = (sorted.length - 1) * p;
    const lower = Math.floor(index), upper = Math.ceil(index);
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
  }
  function statistics(points, latest, minimum = 12) {
    const values = points.map(point => point[1]).filter(positive), n = values.length;
    if (n < minimum) return {available: false, count: n, minimum, status: "insufficient"};
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const q1 = quantile(values, .25), median = quantile(values, .5), q3 = quantile(values, .75);
    return {available: true, count: n, minimum, mean, q1, median, q3,
      percentile: positive(latest) ? 100 * (values.filter(v => v < latest).length + values.filter(v => v === latest).length / 2) / n : null,
      premium: positive(latest) ? 100 * (latest / mean - 1) : null,
      status: !positive(latest) ? "unavailable" : latest < q1 ? "low" : latest > q3 ? "high" : "central"};
  }
  function cutoff(end, range) {
    if (range === "MAX") return "0000-01-01";
    const d = new Date(end + "T00:00:00Z"), year = d.getUTCFullYear() - ({"1Y": 1, "2Y": 2, "5Y": 5}[range] || 2);
    const month = d.getUTCMonth(), date = Math.min(d.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
    return new Date(Date.UTC(year, month, date)).toISOString().slice(0, 10);
  }
  function metric(instrument, key, horizon, range = "2Y", imported = null) {
    if (!METRICS.includes(key) || ![1, 2].includes(horizon)) throw new Error("Multiple ou horizon invalide");
    const financial = instrument.financial === true;
    if (financial && key === "ev_ebitda") return {key, horizon, points: [], latest: null, stats: statistics([], null), reason: "financial", source: null};
    const field = key + "_fy" + horizon;
    if (key === "ev_ebitda" && instrument.ev_quality?.status === "withheld" && !imported?.some(row => positive(row[field]))) {
      return {key, horizon, points: [], latest: null, stats: statistics([], null), reason: "ev_bridge_unreconciled",
        source: {label: "Bilan à rapprocher", urls: [instrument.ev_quality.source_url], note: instrument.ev_quality.note}};
    }
    let rows, latest, source, frequency, end, reason = null;
    if (imported?.some(row => positive(row[field]))) {
      rows = imported.map(row => [row.date, positive(row[field]) ? row[field] : null]);
      end = rows.at(-1)[0]; latest = {value: rows.at(-1)[1], date: end, indicative: false};
      source = {label: "Import personnel", urls: [], note: "Données importées dans cette session, sans envoi ni certification de leur origine."};
      frequency = "imported";
    } else if (key === "pe" && instrument.pe_history?.rows?.length) {
      // This source is deliberately never joined to the daily SAVY snapshots.
      const history = instrument.pe_history;
      rows = history.rows.map(row => [row.date, positive(row["fy" + horizon]) ? row["fy" + horizon] : null]);
      const last = history.rows.at(-1); end = last.date;
      latest = {value: rows.at(-1)[1], date: end, price_date: end, consensus_date: last.consensus_date,
        period_end: last["period_fy" + horizon], indicative: false};
      source = history.source; frequency = "monthly";
    } else {
      const snapshots = instrument.observations || [];
      rows = snapshots.filter(s => s.price_date === s.date).map(s => {
        const age = Date.parse(s.date) - Date.parse(s.consensus_date || s.date);
        const valid = s.complete_session === true && age >= 0 && age <= 7 * 86400000;
        return [s.date, valid ? V.values(s, horizon, financial, "fiscal")[key] : null];
      });
      const s = instrument.latest;
      const value = s ? V.values(s, horizon, financial, "fiscal") : {};
      latest = s ? {value: value[key] ?? null, date: s.date, price_date: s.price_date,
        consensus_date: s.consensus_date || s.date, period_end: value.period_end,
        ev_bridge_date: s.ev_bridge_date, indicative: s.complete_session !== true || s.price_date !== s.date} : null;
      end = latest?.date || rows.at(-1)?.[0] || "1970-01-01";
      source = s ? {label: "MarketScreener · archive SAVY", urls: [s.source_url],
        note: "Cours du relevé et consensus FY1/FY2. EV indicative : capitalisation et dernière dette nette publiée."} : null;
      frequency = "daily";
      if (!positive(latest?.value)) reason = "missing_estimate";
    }
    const start = cutoff(end, range), shown = rows.filter(row => row[0] >= start && row[0] <= end);
    const stats = statistics(shown, latest?.value, frequency === "daily" ? 30 : 12);
    return {key, horizon, points: shown, latest, source, frequency, start, end, stats, reason,
      first: shown.find(row => positive(row[1]))?.[0], last: shown.findLast(row => positive(row[1]))?.[0]};
  }
  function rankedLists(instruments, key, horizon, range = "2Y", imports = {}) {
    const output = {key, horizon, range, total: instruments.length, eligible: 0, above: [], below: [], central: 0,
      excluded: {financial: 0, missing: 0, history: 0}};
    for (const stock of instruments) {
      const m = metric(stock, key, horizon, range, imports[stock.id]);
      if (m.reason === "financial") {output.excluded.financial++; continue;}
      if (!positive(m.latest?.value)) {output.excluded.missing++; continue;}
      if (!m.stats.available) {output.excluded.history++; continue;}
      output.eligible++;
      if (m.stats.status === "central") {output.central++; continue;}
      const side = m.stats.status === "high" ? "above" : "below";
      const boundary = m.stats.status === "high" ? m.stats.q3 : m.stats.q1;
      output[side].push({id: stock.id, title: stock.title, value: m.latest.value, boundary,
        gap: 100 * (m.latest.value / boundary - 1), percentile: m.stats.percentile,
        date: m.latest.date, observations: m.stats.count, source: m.source?.label || ""});
    }
    for (const side of ["above", "below"]) output[side].sort((a, b) => a.id.localeCompare(b.id));
    return output;
  }
  function commonLow(instruments, range = "2Y", imports = {}) {
    const one = rankedLists(instruments, "pe", 1, range, imports).below;
    const two = new Map(rankedLists(instruments, "pe", 2, range, imports).below.map(row => [row.id, row]));
    const fiveOne = new Set(rankedLists(instruments, "pe", 1, "5Y", imports).below.map(row => row.id));
    const fiveTwo = new Set(rankedLists(instruments, "pe", 2, "5Y", imports).below.map(row => row.id));
    return one.filter(row => two.get(row.id)?.date === row.date && two.get(row.id)?.source === row.source)
      .map(row => ({id: row.id, title: row.title, date: row.date, fy1: row, fy2: two.get(row.id),
        confirmed5y: fiveOne.has(row.id) && fiveTwo.has(row.id)}));
  }
  function auditMetric(result, horizon) {
    if (![1, 2].includes(horizon)) throw new Error("Horizon invalide");
    const value = V.values(result.snapshot, horizon, result.ev_status === "not_applicable", "fiscal");
    return {...value, ev_ebitda: result.ev_status === "indicative" ? value.ev_ebitda : null};
  }
  function currentMetric(instrument, key, horizon) {
    const s = instrument.current_snapshot;
    if (!s) return null;
    const values = V.values(s, horizon, instrument.financial === true, "fiscal");
    return {value: key === "ev_ebitda" && instrument.ev_quality?.status === "withheld" ? null : values[key],
      period_end: values.period_end, date: s.date, price_date: s.price_date,
      consensus_date: s.consensus_date || s.date, source_url: s.source_url,
      status: instrument.current_status?.status || "retained"};
  }
  function validate(payload, now = Date.now()) {
    if (payload?.schema_version !== 1 || payload.kind !== "savy_forward_dashboard" || !Array.isArray(payload.instruments)) throw new Error("Données forward indisponibles");
    const seen = new Set();
    for (const row of payload.instruments) {
      if (!/^[A-Z][A-Z0-9.-]{0,19}$/.test(row.id)) throw new Error("Identifiant invalide");
      if (seen.has(row.id) || row.type !== "stock" || typeof row.title !== "string") throw new Error("Action invalide");
      seen.add(row.id);
      if (row.latest) V.snapshot(row.latest, now);
      if (row.current_snapshot) V.snapshot(row.current_snapshot, now);
      V.history({schema_version: 1, kind: "savy_stock_valuation", id: row.id, observations: row.observations || []}, row.id, now);
      V.history({schema_version: 1, kind: "savy_stock_valuation", id: row.id, observations: row.refresh_history || []}, row.id, now);
      let previous = "";
      for (const point of row.pe_history?.rows || []) {
        if (!V.day(point.date) || point.date <= previous || Date.parse(point.date) > now || !V.day(point.consensus_date) || point.consensus_date > point.date || Date.parse(point.date) - Date.parse(point.consensus_date) > 7 * 86400000) throw new Error("Historique P/E invalide");
        for (const h of [1, 2]) if (point["fy" + h] !== null && (!positive(point["fy" + h]) || !V.day(point["period_fy" + h]) || point["period_fy" + h] < point.date)) throw new Error("Horizon fiscal invalide");
        previous = point.date;
      }
    }
    if (payload.refresh) {
      const refresh = payload.refresh, statuses = ["collected", "reused", "cached", "retained", "unavailable"];
      if (refresh.schema_version !== 1 || !["savy_forward_refresh", "savy_private_forward_refresh"].includes(refresh.kind) || !V.day(refresh.as_of) || !Number.isFinite(Date.parse(refresh.checked_at)) || Date.parse(refresh.checked_at) > now + 300000 || refresh.historical_quartiles_refreshed !== false || !Array.isArray(refresh.results)) throw new Error("Statut de refresh invalide");
      const checked = new Set();
      for (const result of refresh.results) {
        if (!seen.has(result.id) || checked.has(result.id) || !statuses.includes(result.status)) throw new Error("Couverture de refresh invalide");
        checked.add(result.id);
      }
      if (statuses.some(key => refresh.counts?.[key] !== refresh.results.filter(r => r.status === key).length)) throw new Error("Comptage de refresh invalide");
    }
    if (payload.audit) {
      const audit = payload.audit, checked = new Set();
      if (audit.kind !== "savy_forward_five_stock_audit" || audit.schema_version !== 1 || !V.day(audit.as_of) || !Array.isArray(audit.results)) throw new Error("Vérification interne invalide");
      for (const result of audit.results) {
        if (!seen.has(result.id) || checked.has(result.id) || !["indicative", "withheld", "not_applicable"].includes(result.ev_status)) throw new Error("Périmètre de vérification invalide");
        checked.add(result.id); V.snapshot(result.snapshot, now);
        if (result.snapshot.date !== audit.as_of || result.snapshot.price_date !== result.price_check.date || result.snapshot.currency !== result.price_check.currency || Math.abs(result.snapshot.price - result.price_check.value) > .005 || result.snapshot.complete_session !== false) throw new Error("Dates ou cours de vérification invalides");
        if (result.ev_status !== "indicative" && result.snapshot.enterprise_value_millions !== null) throw new Error("EV suspendue non masquée");
        if (result.periods?.length !== 2) throw new Error("Deux exercices requis");
        for (const period of result.periods) {
          const calculated = auditMetric(result, period.horizon);
          if (calculated.period_end !== period.period_end || ["pe", "ev_ebitda"].some(key => calculated[key] === null ? period[key] !== null : !positive(period[key]) || Math.abs(calculated[key] - period[key]) > 1e-8)) throw new Error("Calcul de vérification non rapproché");
        }
      }
    }
    return payload;
  }
  function csvRows(text) {
    const rows = []; let row = [], cell = "", quoted = false;
    const input = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    const separator = input.split("\n")[0].includes(";") ? ";" : ",";
    for (let i = 0; i <= input.length; i++) {
      const c = input[i] ?? "\n";
      if (c === '"') {if (quoted && input[i + 1] === '"') {cell += '"'; i++;} else quoted = !quoted;}
      else if (!quoted && (c === separator || c === "\n")) {
        row.push(cell.trim()); cell = "";
        if (c === "\n") {if (row.some(Boolean)) rows.push(row); row = [];}
      } else cell += c;
    }
    if (quoted) throw new Error("Guillemets CSV non fermés");
    return rows;
  }
  function parseImport(text, instruments, now = Date.now()) {
    const rows = csvRows(text), headers = rows.shift()?.map(v => v.toLowerCase());
    const fields = ["pe_fy1", "pe_fy2", "ev_ebitda_fy1", "ev_ebitda_fy2"];
    if (!headers?.includes("date") || !headers.includes("ticker") || !fields.some(f => headers.includes(f)) || new Set(headers).size !== headers.length) throw new Error("Colonnes requises : date, ticker et au moins un multiple (pe_fy1, pe_fy2, ev_ebitda_fy1, ev_ebitda_fy2).");
    const allowed = new Map(instruments.map(row => [row.id, row])), output = {}, dates = new Set();
    if (!rows.length || rows.length > 100000) throw new Error("Le fichier doit contenir de 1 à 100 000 observations.");
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].length !== headers.length) throw new Error("Nombre de colonnes invalide, ligne " + (i + 2));
      const values = Object.fromEntries(headers.map((h, j) => [h, rows[i][j]]));
      const ticker = values.ticker.toUpperCase(), date = values.date, identity = ticker + "/" + date;
      if (!allowed.has(ticker) || !V.day(date) || Date.parse(date) > now || dates.has(identity)) throw new Error("Ticker, date ou doublon invalide, ligne " + (i + 2));
      dates.add(identity); const entry = {date};
      for (const field of fields) {
        const raw = values[field];
        const value = raw === undefined || raw === "" || /^(n\/d|n\/a|null)$/i.test(raw) ? null : Number(raw.replace(",", "."));
        if (value !== null && !positive(value)) throw new Error("Multiple non positif ou invalide, ligne " + (i + 2));
        if (allowed.get(ticker).financial && field.startsWith("ev_ebitda") && value !== null) throw new Error("EV/EBITDA non pertinent pour cette société financière, ligne " + (i + 2));
        entry[field] = value;
      }
      (output[ticker] ||= []).push(entry);
    }
    for (const entries of Object.values(output)) entries.sort((a, b) => a.date.localeCompare(b.date));
    return output;
  }
  return {METRICS, positive, quantile, statistics, cutoff, metric, rankedLists, commonLow, auditMetric, currentMetric, validate, parseImport};
});
