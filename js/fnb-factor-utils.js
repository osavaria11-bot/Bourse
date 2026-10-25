(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SavyFnbFactors = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const MIN_MONTHS = 36, HAC_LAGS = 3;
  // Tradable strategy spreads, not fundamental stock-level scores or pure factors.
  const FACTORS = [
    {id: "market", name: "Marché actions", long: "VEQT", short: null, description: "Marché mondial via VEQT, moins le taux sans risque mensuel."},
    {id: "value", name: "Valeur", long: "VVL", short: "VEQT", description: "Stratégie valeur mondiale VVL moins VEQT."},
    {id: "momentum", name: "Momentum", long: "VMO", short: "VEQT", description: "Stratégie momentum mondiale VMO moins VEQT."},
    {id: "quality", name: "Qualité", long: "FCUQ", short: "VFV", description: "Stratégie qualité américaine FCUQ moins VFV."},
    {id: "lowvol", name: "Faible volatilité", long: "FCUL", short: "VFV", description: "Stratégie défensive américaine FCUL moins VFV."}
  ];
  const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
  const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
  const matrix = (n, m = n) => Array.from({length: n}, () => Array(m).fill(0));
  const transpose = a => a[0].map((_, j) => a.map(row => row[j]));
  const multiply = (a, b) => {const bt = transpose(b); return a.map(row => bt.map(col => dot(row, col)));};
  const monthNumber = date => /^\d{4}-(0[1-9]|1[0-2])$/.test(date) ? Number(date.slice(0, 4)) * 12 + Number(date.slice(5)) : NaN;
  function prepare(values) {
    const n = values.length, p = values[0]?.length;
    if (!p || n <= p + 1 || values.some(row => row.length !== p || !row.every(Number.isFinite))) return null;
    const columns = transpose(values), means = columns.map(mean);
    const scales = columns.map((c, j) => Math.sqrt(c.reduce((s, v) => s + (v - means[j]) ** 2, 0) / (n - 1)));
    if (scales.some(v => v < 1e-10)) return null;
    const x = values.map(row => [1, ...row.map((v, j) => (v - means[j]) / scales[j])]), xc = transpose(x), k = p + 1;
    // Reorthogonalized QR keeps correlated strategy spreads numerically stable.
    const q = [], r = matrix(k);
    for (let j = 0; j < k; j++) {
      let v = [...xc[j]];
      for (let pass = 0; pass < 2; pass++) for (let i = 0; i < j; i++) {
        const projection = dot(q[i], v); r[i][j] += projection;
        v = v.map((value, t) => value - projection * q[i][t]);
      }
      r[j][j] = Math.sqrt(dot(v, v));
      if (r[j][j] < 1e-8) return null;
      q.push(v.map(value => value / r[j][j]));
    }
    const inverseR = matrix(k);
    for (let col = 0; col < k; col++) for (let i = k - 1; i >= 0; i--) {
      let value = i === col ? 1 : 0;
      for (let j = i + 1; j < k; j++) value -= r[i][j] * inverseR[j][col];
      inverseR[i][col] = value / r[i][i];
    }
    const inverseGram = multiply(inverseR, transpose(inverseR));
    const maxVif = Math.max(...inverseGram.slice(1).map((row, j) => row[j + 1] * (n - 1)));
    if (!Number.isFinite(maxVif) || maxVif > 25) return null;
    return {x, q, r, inverseGram, means, scales, n, k, maxVif};
  }
  function fit(prepared, y) {
    const {x, q, r, inverseGram, scales, n, k} = prepared;
    const coefficients = q.map(col => dot(col, y));
    for (let i = k - 1; i >= 0; i--) {
      for (let j = i + 1; j < k; j++) coefficients[i] -= r[i][j] * coefficients[j];
      coefficients[i] /= r[i][i];
    }
    const residual = y.map((v, t) => v - dot(x[t], coefficients)), ym = mean(y);
    const totalSquares = y.reduce((s, v) => s + (v - ym) ** 2, 0), errorSquares = dot(residual, residual);
    const rSquared = totalSquares > 1e-16 ? Math.max(0, Math.min(1, 1 - errorSquares / totalSquares)) : null;
    const scores = x.map((row, t) => row.map(v => v * residual[t])), meat = matrix(k);
    for (let lag = 0; lag <= HAC_LAGS; lag++) {
      const weight = lag === 0 ? 1 : 1 - lag / (HAC_LAGS + 1);
      for (let t = lag; t < n; t++) for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
        meat[i][j] += weight * (scores[t][i] * scores[t - lag][j] + (lag ? scores[t - lag][i] * scores[t][j] : 0));
      }
    }
    const covariance = multiply(multiply(inverseGram, meat), inverseGram);
    return {coefficients: coefficients.slice(1).map((v, j) => v / scales[j]),
      standardErrors: scales.map((s, j) => Math.sqrt(Math.max(0, covariance[j + 1][j + 1] * n / (n - k))) / s),
      residual, rSquared, totalSquares, errorSquares};
  }
  function compare(data, portfolioId, benchmarkId, options = {}) {
    const unavailable = reason => ({available: false, reason, minimumMonths: MIN_MONTHS});
    const universe = data?.universe, portfolio = data?.results?.[portfolioId], benchmark = data?.results?.[benchmarkId];
    const dates = data?.dates, ud = universe?.dates, returns = universe?.returns;
    if (!Array.isArray(dates) || !Array.isArray(ud) || !returns || !portfolio || !benchmark ||
        portfolio.monthly?.length !== dates.length || benchmark.monthly?.length !== dates.length ||
        !dates.every(d => Number.isFinite(monthNumber(d))) || new Set(dates).size !== dates.length ||
        !ud.every(d => Number.isFinite(monthNumber(d))) || new Set(ud).size !== ud.length) return unavailable("Données mensuelles incompatibles.");
    const required = [...new Set(FACTORS.flatMap(f => [f.long, f.short]).filter(Boolean))];
    if (required.some(id => !Array.isArray(returns[id]) || returns[id].length !== ud.length)) return unavailable("Séries factorielles manquantes.");
    const annualRate = data.assumptions?.risk_free;
    if (!Number.isFinite(annualRate) || annualRate <= -1) return unavailable("Hypothèse de taux sans risque indisponible.");
    const rf = Math.expm1(Math.log1p(annualRate) / 12), byDate = new Map(ud.map((d, i) => [d, i]));
    let rows = dates.flatMap((date, i) => {
      const u = byDate.get(date), p = portfolio.monthly[i], b = benchmark.monthly[i];
      if (u === undefined || !Number.isFinite(p) || !Number.isFinite(b) || required.some(id => !Number.isFinite(returns[id][u]))) return [];
      return [{date, p, b, x: FACTORS.map(f => returns[f.long][u] - (f.short ? returns[f.short][u] : rf))}];
    });
    const minimum = options.windowMonths === 24 ? 24 : MIN_MONTHS;
    if (options.windowMonths) rows = rows.slice(-options.windowMonths);
    if (rows.length < minimum) return unavailable(`Historique commun insuffisant : au moins ${minimum} mois requis.`);
    if (rows.some((row, i) => i && monthNumber(row.date) !== monthNumber(rows[i - 1].date) + 1)) return unavailable("Mois manquants dans l’historique commun.");
    const values = rows.map(row => row.x), prepared = prepare(values);
    if (!prepared) return unavailable("Sensibilités non estimables : séries constantes ou trop corrélées.");
    const p = fit(prepared, rows.map(row => row.p - rf)), b = fit(prepared, rows.map(row => row.b - rf));
    const active = rows.map(row => row.p - row.b), a = fit(prepared, active), am = mean(active);
    const hasActiveRisk = a.totalSquares > 1e-16;
    const factors = FACTORS.map((f, j) => {
      const delta = a.coefficients[j], band = 1.96 * a.standardErrors[j];
      const cross = rows.reduce((s, row, t) => s + (row.x[j] - prepared.means[j]) * (active[t] - am), 0);
      return {...f, portfolio: p.coefficients[j], benchmark: b.coefficients[j], delta,
        low: delta - band, high: delta + band, significant: Math.abs(delta) > band, contribution: hasActiveRisk ? delta * cross / a.totalSquares : null};
    });
    return {available: true, portfolioId, benchmarkId, start: rows[0].date, end: rows.at(-1).date, months: rows.length,
      factors, portfolioR2: p.rSquared, benchmarkR2: b.rSquared, activeR2: a.rSquared,
      trackingError: Math.sqrt(a.totalSquares / (rows.length - 1) * 12),
      residualContribution: hasActiveRisk ? a.errorSquares / a.totalSquares : null,
      beta: beta(rows.map(r=>r.p),rows.map(r=>r.b)), downside: downside(rows.map(r=>r.p),rows.map(r=>r.b)),
      maxVif: prepared.maxVif, unstable: prepared.maxVif > 10, riskFree: annualRate};
  }
  function beta(p,b) {
    if(!Array.isArray(p)||p.length!==b?.length||p.length<2||!p.every(Number.isFinite)||!b.every(Number.isFinite))return null;
    const pm=mean(p),bm=mean(b),v=b.reduce((s,x)=>s+(x-bm)**2,0);
    return v>1e-16?p.reduce((s,x,i)=>s+(x-pm)*(b[i]-bm),0)/v:null;
  }
  function downside(p,b) {
    const valid=Array.isArray(p)&&p.length===b?.length&&p.every(Number.isFinite)&&b.every(Number.isFinite);
    if(!valid)return {beta:null,observations:0,reason:'Périodes incompatibles.'};
    const indices=b.flatMap((v,i)=>v<0?[i]:[]),n=indices.length;
    return {beta:n>=8?beta(indices.map(i=>p[i]),indices.map(i=>b[i])):null,observations:n,
      fragile:n<12,reason:n<8?'Au moins 8 mois baissiers requis.':n<12?'Moins de 12 mois baissiers : estimation fragile.':null};
  }
  function regress(values,y) {
    if(!Array.isArray(values)||values.length<Math.max(36,4*(values[0]?.length+1))||y?.length!==values.length||!y.every(Number.isFinite))return null;
    const design=prepare(values);if(!design)return null;
    return {...fit(design,y),maxVif:design.maxVif,observations:values.length};
  }
  function stability(data,p,b) {
    return [12,24,null].map(windowMonths=>({windowMonths,...compare(data,p,b,{windowMonths})}));
  }
  return {compare, FACTORS, MIN_MONTHS, HAC_LAGS, beta, downside, regress, stability};
});
