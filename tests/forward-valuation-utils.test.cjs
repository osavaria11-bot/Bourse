"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs");
const F = require("../js/forward-valuation-utils.js"), V = require("../js/valuation-utils.js");
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
function snapshot(date = "2026-10-28") {
  return {date, observed_at: date + "T22:00:00Z", source_url: "https://example.com/valuation/", currency: "USD", price: 120,
    price_date: date, complete_session: true, consensus_date: date, fiscal_month: 12, enterprise_value_millions: 1800,
    forecasts: [{period_end: "2026-12-31", eps: 6, ebitda_millions: 100}, {period_end: "2027-12-31", eps: 8, ebitda_millions: 150}, {period_end: "2028-12-31", eps: 10, ebitda_millions: 200}]};
}
function stock() {return {id: "TEST", title: "Synthetic test company", type: "stock", financial: false, latest: snapshot(), observations: [snapshot()]};}
function monthly() {
  return Array.from({length: 24}, (_, i) => ({date: new Date(Date.UTC(2024 + Math.floor(i / 12), i % 12, 28)).toISOString().slice(0, 10),
    consensus_date: new Date(Date.UTC(2024 + Math.floor(i / 12), i % 12, 25)).toISOString().slice(0, 10),
    fy1: 10 + i, fy2: 5 + i, period_fy1: `${2024 + Math.floor(i / 12)}-12-31`, period_fy2: `${2025 + Math.floor(i / 12)}-12-31`}));
}
test("mean and interpolated quartiles agree with independent hand calculations", () => {
  const points = Array.from({length: 12}, (_, i) => ["2026-01-01", i + 1]);
  const s = F.statistics(points, 2); close(s.mean, 6.5); close(s.q1, 3.75); close(s.median, 6.5); close(s.q3, 9.25);
  assert.equal(s.status, "low"); close(s.percentile, 12.5); close(s.premium, (2 / 6.5 - 1) * 100);
  assert.equal(F.statistics(points, 11).status, "high"); assert.equal(F.statistics(points, 3.75).status, "central");
});
test("missing/nonpositive observations do not become zeros; insufficient archives have no bands", () => {
  const p = [["2026-01-01", null], ["2026-01-02", -1], ["2026-01-03", 0], ["2026-01-04", 20]];
  const s = F.statistics(p, 20); assert.equal(s.count, 1); assert.equal(s.available, false); assert.equal(s.q1, undefined);
  const flat = F.statistics(Array.from({length: 12}, () => ["2026-01-01", 20]), 20);
  close(flat.q1, 20); close(flat.q3, 20); close(flat.percentile, 50); assert.equal(flat.status, "central");
});
test("FY1 and FY2 use separate annual forecasts rather than the old blended horizons", () => {
  const s = stock(), a = F.metric(s, "pe", 1), b = F.metric(s, "pe", 2);
  close(a.latest.value, 20); close(b.latest.value, 15); assert.equal(a.latest.period_end, "2026-12-31"); assert.equal(b.latest.period_end, "2027-12-31");
  close(F.metric(s, "ev_ebitda", 1).latest.value, 18); close(F.metric(s, "ev_ebitda", 2).latest.value, 12);
  assert.notEqual(V.values(s.latest, 1).pe, a.latest.value);
});
test("range and forecast horizon are independent and fiscal rollovers use future exercises", () => {
  const s = stock(); s.pe_history = {rows: monthly(), source: {label: "Historical source"}};
  const one = F.metric(s, "pe", 1, "1Y"), two = F.metric(s, "pe", 2, "1Y"), all = F.metric(s, "pe", 1, "MAX");
  assert.equal(one.points.length, 13); assert.equal(two.points.length, 13); assert.equal(all.points.length, 24);
  assert.equal(one.latest.value, 33); assert.equal(two.latest.value, 28);
  assert.equal(F.cutoff("2024-02-29", "1Y"), "2023-02-28");
  s.latest = snapshot("2027-01-02"); assert.equal(F.metric(s, "ev_ebitda", 1).latest.period_end, "2027-12-31");
});
test("historical P/E and daily snapshots are not spliced across vendors", () => {
  const s = stock(); s.pe_history = {rows: monthly(), source: {label: "Monthly archive"}};
  const m = F.metric(s, "pe", 1, "MAX"); assert.equal(m.points.length, 24); assert.equal(m.source.label, "Monthly archive");
  assert.equal(m.latest.date, "2025-12-28"); assert.equal(m.latest.value, 33);
  s.pe_history.rows.at(-1).fy2 = null;
  const missing = F.metric(s, "pe", 2, "MAX"); assert.equal(missing.latest.value, null); assert.equal(missing.stats.status, "unavailable");
});
test("unconfirmed prices and stale/future consensus do not enter historical bands", () => {
  const s = stock(); s.latest = {...s.latest, price_date: null, complete_session: false};
  s.observations = [{...snapshot(), complete_session: false}, {...snapshot("2026-10-29"), consensus_date: "2026-10-01"}];
  const m = F.metric(s, "ev_ebitda", 1); assert.equal(m.latest.indicative, true); assert.equal(m.stats.count, 0);
  s.observations = [{...snapshot(), consensus_date: "2026-10-29"}]; assert.equal(F.metric(s, "pe", 1).stats.count, 0);
});
test("financial companies and unavailable/nonpositive denominators remain N/D", () => {
  const s = stock(); s.financial = true; assert.equal(F.metric(s, "ev_ebitda", 2).reason, "financial");
  s.latest.forecasts[1].eps = -2; assert.equal(F.metric(s, "pe", 2).latest.value, null);
  s.latest.forecasts.splice(1); assert.equal(F.metric(s, "ev_ebitda", 2).latest, null);
});
test("CSV import preserves independent horizons, missing cells and original data", () => {
  const s = stock(), text = "date,ticker,pe_fy1,pe_fy2,ev_ebitda_fy1,ev_ebitda_fy2\n2026-10-27,TEST,30,25,14,10\n2026-10-28,TEST,29,,13,9\n";
  const imported = F.parseImport(text, [s]);
  assert.equal(F.metric(s, "pe", 1, "MAX", imported.TEST).latest.value, 29);
  assert.equal(F.metric(s, "pe", 2, "MAX", imported.TEST).latest.value, null);
  assert.equal(F.metric(s, "ev_ebitda", 2, "MAX", imported.TEST).latest.value, 9);
  assert.equal(s.latest.price, 120);
  const partial = F.parseImport("date;ticker;ev_ebitda_fy2\n2026-10-28;TEST;9,5", [s]);
  close(F.metric(s, "ev_ebitda", 2, "MAX", partial.TEST).latest.value, 9.5);
  assert.equal(F.metric(s, "pe", 1, "MAX", partial.TEST).latest.value, 20);
});
test("invalid imports reject duplicate dates, unknown stocks, future dates, negative ratios and ETFs", () => {
  const s = stock(), head = "date,ticker,pe_fy1\n";
  for (const body of ["2026-10-28,TEST,20\n2026-10-28,TEST,21", "2026-10-28,FEQT,20", "2099-01-01,TEST,20", "2026-10-28,TEST,-1", "2026-02-30,TEST,20"]) assert.throws(() => F.parseImport(head + body, [s]));
  assert.throws(() => F.validate({schema_version: 1, kind: "savy_forward_dashboard", instruments: [{...s, type: "etf"}]}));
  assert.throws(() => F.metric(s, "pe", 3));
});
test("retained public data validate and all four metrics are independently available where sourced", () => {
  const data = F.validate(JSON.parse(fs.readFileSync("data/forward-valuation.json", "utf8")));
  assert.equal(data.instruments.length, 93); assert.equal(data.instruments.some(row => row.id === "POW"), false);
  const nvidia = data.instruments.find(row => row.id === "NVDA");
  for (const horizon of [1, 2]) {
    const pe = F.metric(nvidia, "pe", horizon), ev = F.metric(nvidia, "ev_ebitda", horizon);
    assert.equal(pe.stats.available, true); assert.equal(pe.stats.status, "low");
    assert.ok(F.positive(ev.latest.value)); assert.equal(ev.stats.available, false); assert.equal(ev.stats.count, 1);
  }
  const royal = data.instruments.find(row => row.id === "RY"); assert.equal(F.metric(royal, "ev_ebitda", 1).reason, "financial");
  assert.equal(JSON.stringify(data).includes('"quantity"'), false); assert.equal(JSON.stringify(data).includes('"cost_basis"'), false);
});
test("lists classify each stock against its own quartiles and exclude missing/short series", () => {
  const make = (id, last) => ({...stock(), id, pe_history: {source: {label: "Dated monthly source"}, rows: monthly().map((row, i) => ({...row, fy1: i === 23 ? last : row.fy1}))}});
  const high = make("HIGH", 100), low = make("LOW", 1), middle = make("MIDDLE", 20), missing = make("MISSING", null), short = {...stock(), id: "SHORT"};
  const result = F.rankedLists([high, low, middle, missing, short], "pe", 1, "MAX");
  assert.deepEqual(result.above.map(row => row.id), ["HIGH"]); assert.deepEqual(result.below.map(row => row.id), ["LOW"]);
  assert.equal(result.central, 1); assert.equal(result.eligible, 3); assert.deepEqual(result.excluded, {financial: 0, missing: 1, history: 1});
  close(result.above[0].gap, (100 / result.above[0].boundary - 1) * 100);
  assert.equal(result.above[0].date, high.pe_history.rows.at(-1).date);
  assert.equal(result.above.length + result.below.length + result.central + Object.values(result.excluded).reduce((a,b)=>a+b,0), result.total);
});
test("list imports apply only to their supplied ratio and horizon; financials stay excluded from EV/EBITDA", () => {
  const s = stock(), bank = {...stock(), id: "BANK", financial: true};
  const imports = {TEST: Array.from({length: 12}, (_, i) => ({date: `2026-${String(i+1).padStart(2,"0")}-01`, ev_ebitda_fy1: 10 + i, ev_ebitda_fy2: 20 - i}))};
  const one = F.rankedLists([s, bank], "ev_ebitda", 1, "2Y", imports), two = F.rankedLists([s, bank], "ev_ebitda", 2, "2Y", imports);
  assert.deepEqual(one.above.map(row => row.id), ["TEST"]); assert.deepEqual(two.below.map(row => row.id), ["TEST"]);
  assert.equal(one.excluded.financial, 1); assert.equal(two.excluded.financial, 1);
  assert.equal(F.rankedLists([s], "pe", 1, "2Y", imports).eligible, 0);
});
test("actual two-year lists keep NVIDIA below Q1 and AMD above Q3 in both P/E horizons without inventing EV rankings", () => {
  const data = JSON.parse(fs.readFileSync("data/forward-valuation.json", "utf8"));
  for (const horizon of [1, 2]) {
    const pe = F.rankedLists(data.instruments, "pe", horizon, "2Y"), ev = F.rankedLists(data.instruments, "ev_ebitda", horizon, "2Y");
    assert.ok(pe.below.some(row => row.id === "NVDA")); assert.ok(pe.above.some(row => row.id === "AMD"));
    assert.equal(ev.eligible, 0); assert.deepEqual(ev.above, []); assert.deepEqual(ev.below, []);
    assert.ok(ev.excluded.history > 0); assert.ok(ev.excluded.financial > 0);
    const IDs = pe.above.map(row => row.id); assert.deepEqual(IDs, [...IDs].sort((a,b)=>a.localeCompare(b)));
    for (const row of pe.above) assert.ok(row.value > row.boundary);
    for (const row of pe.below) assert.ok(row.value < row.boundary);
  }
});
test("common shortlist requires low P/E at both horizons with the same source and date", () => {
  const make = id => ({...stock(), id, pe_history: {source: {label: "Dated monthly source"}, rows: monthly().map((row, i) => ({...row, fy1: i === 23 ? 1 : row.fy1, fy2: i === 23 ? 1 : row.fy2}))}});
  const same = make("SAME"), mismatch = make("MISMATCH");
  const imports = {MISMATCH: Array.from({length: 24}, (_, i) => ({date: monthly()[i].date, pe_fy1: i === 23 ? 1 : i + 10}))};
  assert.deepEqual(F.commonLow([same, mismatch], "2Y", imports).map(row => row.id), ["SAME"]);
  assert.equal(F.commonLow([same], "2Y")[0].confirmed5y, true);
  same.pe_history.rows.at(-1).fy2 = null;
  assert.deepEqual(F.commonLow([same], "2Y"), []);
});
test("audited current ratios stay outside archived curves and unsafe EV bridges are withheld", () => {
  const data = F.validate(JSON.parse(fs.readFileSync("data/forward-valuation.json", "utf8")));
  const nvidia = data.instruments.find(row => row.id === "NVDA"), audit = data.audit.results.find(row => row.id === "NVDA");
  close(F.auditMetric(audit, 1).pe, 204.64 / 9.999);
  close(F.auditMetric(audit, 2).pe, 204.64 / 15.78);
  assert.equal(F.metric(nvidia, "pe", 1).latest.date, "2026-10-28");
  assert.notEqual(F.metric(nvidia, "pe", 1).latest.value, F.auditMetric(audit, 1).pe);
  const mda = data.instruments.find(row => row.id === "MDA");
  assert.equal(F.metric(mda, "ev_ebitda", 1).reason, "ev_bridge_unreconciled");
  assert.equal(F.metric(mda, "ev_ebitda", 1).latest, null);
  for (const id of ["MDA", "RY"]) for (const h of [1, 2]) assert.equal(F.auditMetric(data.audit.results.find(row => row.id === id), h).ev_ebitda, null);
  const changed = structuredClone(data); changed.audit.results[0].periods[0].pe = 1;
  assert.throws(() => F.validate(changed), /non rapproché/);
});
test("refreshed cards use dated current inputs while historical rankings keep their original source", () => {
  const s = stock(); s.pe_history = {rows: monthly(), source: {label: "Monthly archive"}};
  s.current_snapshot = {...snapshot(), price: 180, price_date: "2026-10-27", complete_session: false};
  s.current_status = {status: "cached"};
  const current = F.currentMetric(s, "pe", 1), historical = F.metric(s, "pe", 1, "MAX");
  assert.equal(current.value, 30); assert.equal(current.price_date, "2026-10-27"); assert.equal(current.status, "cached");
  assert.equal(historical.latest.value, 33); assert.equal(historical.latest.date, "2025-12-28");
  s.ev_quality = {status: "withheld"}; assert.equal(F.currentMetric(s, "ev_ebitda", 1).value, null);
  s.financial = true; assert.equal(F.currentMetric(s, "ev_ebitda", 2).value, null);
});
test("refresh status cannot claim updated historical quartiles or miscount its coverage", () => {
  const data = {schema_version:1, kind:"savy_forward_dashboard", instruments:[stock()], refresh:{
    schema_version:1, kind:"savy_private_forward_refresh", as_of:"2026-10-28", checked_at:"2026-10-28T22:00:00Z",
    historical_quartiles_refreshed:false, counts:{collected:1,reused:0,cached:0,retained:0,unavailable:0}, results:[{id:"TEST",status:"collected"}]}};
  F.validate(data);
  const bad = structuredClone(data); bad.refresh.historical_quartiles_refreshed = true; assert.throws(()=>F.validate(bad));
  const miscount = structuredClone(data); miscount.refresh.counts.collected = 0; assert.throws(()=>F.validate(miscount));
});
function annualStock() {
  const s = stock();
  s.annual_valuation = {date: "2026-11-02", observed_at: "2026-11-02T14:00:00Z", source_url: "https://example.com/valuation/", currency: "USD",
    rows: [
      {fiscal_year:2025,period_end:"2025-01-26",ebitda_millions:83317,ebitda_is_estimate:false,ev_ebitda:41.4,ev_ebitda_is_estimate:false},
      {fiscal_year:2026,period_end:"2026-01-25",ebitda_millions:140143,ebitda_is_estimate:false,ev_ebitda:32.2,ev_ebitda_is_estimate:false},
      {fiscal_year:2027,period_end:"2027-01-31",ebitda_millions:272980,ebitda_is_estimate:true,ev_ebitda:17.6,ev_ebitda_is_estimate:true},
      {fiscal_year:2028,period_end:"2028-01-30",ebitda_millions:457613,ebitda_is_estimate:true,ev_ebitda:10.1,ev_ebitda_is_estimate:true},
      {fiscal_year:2029,period_end:"2029-01-28",ebitda_millions:582188,ebitda_is_estimate:true,ev_ebitda:7.48,ev_ebitda_is_estimate:true}
    ]}; return s;
}
test("annual EV uses provider ratios through FY2, with hand-calculated consecutive EBITDA growth", () => {
  const s = annualStock(), m = F.annualEv(s, "MAX");
  assert.equal(m.firstYear, 2027); assert.equal(m.points.length, 4);
  assert.equal(m.points.at(-1)[1], 10.1); assert.equal(m.metadata["2027-01-31"].ev_ebitda_is_estimate, true);
  close(m.growth[0].value, (272980 / 140143 - 1) * 100);
  close(m.growth[1].value, (457613 / 272980 - 1) * 100);
  assert.equal(m.growth[0].base.ebitda_is_estimate, false);
  assert.equal(m.growth[1].base.ebitda_is_estimate, true);
  assert.equal(m.stats.available, false);
  assert.equal(F.annualEv(s, "1Y").points.length, 3);
  assert.equal(F.rankedLists([s], "ev_ebitda", 1).eligible, 0);
});
test("annual EBITDA growth never skips a missing year or divides by a nonpositive base", () => {
  for (const base of [null, 0, -10]) {
    const s = annualStock(); s.annual_valuation.rows[1].ebitda_millions = base;
    assert.equal(F.annualEv(s).growth[0].value, null);
  }
  const s = annualStock(); s.annual_valuation.rows.splice(1, 1);
  assert.equal(F.annualEv(s).growth[0].value, null);
  const t = annualStock(); t.annual_valuation.rows[3].ebitda_millions = 0;
  assert.equal(F.annualEv(t).growth[1].value, -100);
  t.annual_valuation.rows[3].ebitda_millions = -272980;
  assert.equal(F.annualEv(t).growth[1].value, -200);
  t.annual_valuation.rows.splice(3, 1);
  assert.equal(F.annualEv(t).growth[1].value, null);
});
test("annual source distinguishes estimated bases and survives a withheld current EV, but excludes banks", () => {
  const s = annualStock(); s.annual_valuation.rows[1].ebitda_is_estimate = true; s.ev_quality = {status: "withheld"};
  assert.equal(F.annualEv(s).growth[0].base.ebitda_is_estimate, true);
  assert.equal(F.annualEv(s).points.length, 4);
  assert.equal(F.metric(s, "ev_ebitda", 1).reason, "ev_bridge_unreconciled");
  s.financial = true; assert.equal(F.annualEv(s).reason, "financial"); assert.equal(F.annualEv(s).growth.length, 0);
});
test("annual validation rejects duplicate periods, false flags, nonpositive ratios and invalid EBITDA", () => {
  const wrap = s => ({schema_version:1,kind:"savy_forward_dashboard",instruments:[s]});
  F.validate(wrap(annualStock()));
  for (const change of [row=>row.ev_ebitda=0,row=>row.ebitda_millions="100",row=>row.ebitda_is_estimate="yes",row=>row.fiscal_year=2025]) {
    const s = annualStock(); change(s.annual_valuation.rows[1]); assert.throws(()=>F.validate(wrap(s)));
  }
});
