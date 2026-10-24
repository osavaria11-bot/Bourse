"use strict";
const {componentPage} = require("./portal-navigation.cjs");
// Synthetic public yields; never uses or opens any personal portfolio profile.
const fs = require("node:fs"), path = require("node:path"), http = require("node:http"), assert = require("node:assert/strict");
const {chromium} = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const C = require("../js/yield-curve-utils.js"), U = require("../js/macro-utils.js");
const root = path.resolve(__dirname, "..");
let offline = false, malformed = false;
const stamp = new Date().toISOString();
const fixture = {schema_version: 1, kind: "sovereign_yield_curves", unit: "percent", timezone: "America/Toronto", history_start: C.START, generated_at: stamp,
  countries: Object.entries(C.CONTRACTS).map(([id, country], countryIndex) => ({...country, id, source_label: id === "US" ? "U.S. Treasury" : "Banque du Canada / CanDeal DNA",
    methodology: id === "CA" ? "Obligations de référence; Long : environ 30 ans, échéance résiduelle variable." : "Treasury par yield curve.",
    tenors: country.tenors.map(([key, label, months, series_id]) => ({key, label, months, series_id})),
    fetch_status: "fresh", last_successful_fetch: stamp,
    history: ["2016-01-04", "2021-10-14", "2024-10-14", "2025-10-14", "2025-12-31", "2026-04-14", "2026-07-14", "2026-09-14", "2026-10-07", "2026-10-09", "2026-10-13", "2026-10-14"].map((day, index) => [day, ...country.tenors.map((_, tenor) =>
      id === "US" && day === "2026-10-14" && tenor === 6 ? null : Math.round((1.5 + (1 - countryIndex) * 1.5 + tenor * .12 + index * .07) * 100) / 100)])}))};
const mime = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png"};
const requests = [];
const server = http.createServer((request, response) => {
  requests.push(request.url);
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname === "/data/yield-curves.json") {response.writeHead(offline ? 503 : 200, {"Content-Type": "application/json"}); response.end(JSON.stringify(offline ? {} : malformed ? {...fixture, unit: "USD"} : fixture)); return;}
  const filename = path.resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
  if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {response.writeHead(404); response.end(); return;}
  response.writeHead(200, {"Content-Type": mime[path.extname(filename)] || "application/octet-stream"}); fs.createReadStream(filename).pipe(response);
});
async function main() {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({headless: true});
  const base = "http://127.0.0.1:" + server.address().port, errors = [];
  const normalized = C.normalize(fixture);
  async function setDates(page, a, b) {
    await page.locator("#yieldDateA").fill(a); await page.locator("#yieldDateB").fill(b); await page.locator("#yieldDateB").dispatchEvent("change");
  }
  async function check(page, a, b) {
    const selection = await page.evaluate(() => JSON.parse(localStorage.getItem("savy:yield-curve-dates:v2")));
    assert.equal(selection.a, a); assert.equal(selection.b, b);
    for (const country of normalized.countries) {
      const model = C.multiComparison(country, selection), card = page.locator('[data-yield-country="' + country.id + '"]');
      for (const row of model.rows) {
        const tr = card.locator('tr[data-tenor="' + row.key + '"]');
        for (const curve of model.curves) {
          const value = row.values[curve.key]; assert.equal(await tr.locator('[data-date-key="' + curve.key + '"]').textContent(), U.validNumber(value) ? U.formatNumber(value, 2) + " %" : "N/D");
          if (curve.key !== "b") {
            const change = row.changes[curve.key];
            assert.equal(await tr.locator('[data-comparison="b-' + curve.key + '"]').textContent(), U.validNumber(change) ? (change > .005 ? "+" : "") + U.formatNumber(Math.abs(change) < .005 ? 0 : change, 1) + " pb" : "N/D");
          }
        }
      }
      assert.equal(await card.locator(".yield-line").evaluateAll(nodes => nodes.some(node => /NaN|Infinity/.test(node.getAttribute("d")))), false);
      if (model.a) assert.ok((await card.locator(".yield-chart-legend").innerText()).includes(model.a.date));
      if (model.b) assert.ok((await card.locator(".yield-chart-legend").innerText()).includes(model.b.date));
    }
  }
  try {
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}}), page = await componentPage(context,);
    page.on("pageerror", error => errors.push(error.message)); await page.route("https://**", route => route.abort());
    await page.goto(base); await page.waitForFunction(() => document.querySelectorAll(".yield-curve-card").length === 2);
    assert.equal(await page.locator("#yieldDateA").inputValue(), "2026-09-14"); assert.equal(await page.locator("#yieldDateB").inputValue(), "2026-10-14");
    assert.equal(await page.locator("#yieldDateC,#yieldDateD,#yieldDateE,#yieldExtraDates,#yieldAddDate").count(), 0);
    assert.equal(await page.locator("#yieldChartUS .yield-line").count(), 2);
    await page.locator("#yieldTableUS summary").click(); await page.locator("#yieldTableCA summary").click();
    await check(page, "2026-09-14", "2026-10-14");
    assert.equal(await page.locator("#yieldChartUS path.yield-b").evaluate(node => (node.getAttribute("d").match(/M/g) || []).length), 2, "A missing 5-year yield breaks the line, without interpolation");
    const chart = page.locator("#yieldChartUS svg"); await chart.focus(); await chart.press("Home"); assert.match(await page.locator("#yieldChartUS .yield-tooltip").innerText(), /^1 mois/);
    await chart.press("End"); assert.match(await page.locator("#yieldChartUS .yield-tooltip").innerText(), /^30 ans/);
    await chart.press("ArrowLeft"); assert.match(await page.locator("#yieldChartUS .yield-tooltip").innerText(), /^20 ans/);
    const box = await chart.boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); assert.match(await page.locator("#yieldChartUS .yield-tooltip").innerText(), /A : .* B : .* Δ /);
    if (process.env.YIELD_SCREENSHOT_LOGS) console.log("SCREENSHOT_YIELD_DESKTOP " + (await page.locator("#yieldCurves").screenshot()).toString("base64"));
    await setDates(page, "2026-10-11", "2026-10-14"); await check(page, "2026-10-11", "2026-10-14");
    assert.match(await page.locator('[data-yield-country="CA"] .yield-chart-legend').innerText(), /2026-10-09 \(demandé : 2026-10-11\)/);
    await page.locator("#yieldSwap").click(); await check(page, "2026-10-14", "2026-10-11");
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("savy:yield-curve-dates:v2"))), {a: "2026-10-14", b: "2026-10-11"});
    await page.reload(); await page.waitForFunction(() => document.querySelectorAll(".yield-curve-card").length === 2);
    assert.equal(await page.locator("#yieldDateA").inputValue(), "2026-10-14"); assert.equal(await page.locator("#yieldDateB").inputValue(), "2026-10-11");
    await page.locator("#yieldDateA").fill(""); await page.locator("#yieldDateA").dispatchEvent("change"); assert.equal(await page.locator("#yieldDateError").isVisible(), true);
    await setDates(page, "2016-01-01", "2026-10-14"); assert.equal(await page.locator("#yieldDateError").isVisible(), false);
    assert.match(await page.locator('[data-yield-country="US"] .yield-chart-legend').innerText(), /Aucune observation/);
    await check(page, "2016-01-01", "2026-10-14");
    const presets = ["1D", "1W", "1M", "3M", "6M", "1Y", "2Y", "5Y", "YTD"];
    assert.deepEqual(await page.locator("#yieldPresets button").evaluateAll(nodes => nodes.map(node => node.textContent)), ["1 jour", "1 semaine", "1 mois", "3 mois", "6 mois", "1 an", "2 ans", "5 ans", "YTD"]);
    for (const preset of presets) {
      await page.locator('[data-yield-preset="' + preset + '"]').click(); const expected = C.defaults(normalized, preset);
      assert.equal(await page.locator("#yieldDateA").inputValue(), expected.a); await check(page, expected.a, expected.b);
    }
    await page.locator('[data-yield-preset="1M"]').click();
    assert.equal(await page.locator("#yieldChartUS .yield-line").count(), 2); await check(page, "2026-09-14", "2026-10-14");
    for (const width of [768, 375, 320]) {
      await page.setViewportSize({width, height: 1000});
      await page.locator("#yieldTableCA summary").click();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Yield curves overflow at " + width);
      for (const preset of presets) {
        const button = page.locator('[data-yield-preset="' + preset + '"]');
        await button.click();
        assert.equal(await page.locator("#yieldDateA").inputValue(), C.defaults(normalized, preset).a);
        const bounds = await button.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, "Preset remains accessible at " + width);
      }
      await page.locator('[data-yield-preset="1M"]').click();
      await page.locator("#yieldChartCA svg").focus(); await page.keyboard.press("Home"); assert.match(await page.locator("#yieldChartCA .yield-tooltip").innerText(), /^1 mois/);
      await page.locator("#yieldTableCA summary").click();
      if (width === 320 && process.env.YIELD_SCREENSHOT_LOGS) console.log("SCREENSHOT_YIELD_MOBILE " + (await page.locator('[data-yield-country="US"]').screenshot()).toString("base64"));
    }
    await page.locator('[data-theme-choice="light"]').click(); assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
    await check(page, "2026-09-14", "2026-10-14");
    for (const version of ["v1", "v2"]) {
      const legacyContext = await browser.newContext(), legacyPage = await componentPage(legacyContext,); await legacyPage.route("https://**", route => route.abort());
      await legacyContext.addInitScript(version => localStorage.setItem("savy:yield-curve-dates:" + version, JSON.stringify({a: "2026-10-09", b: "2026-10-14", ...(version === "v2" ? {c: "2025-10-14", d: "2021-10-14", e: "2016-10-14"} : {})})), version);
      legacyPage.on("pageerror", error => errors.push(error.message)); await legacyPage.goto(base);
      await legacyPage.waitForFunction(() => document.querySelectorAll(".yield-curve-card").length === 2);
      assert.equal(await legacyPage.locator("#yieldDateA").inputValue(), "2026-10-09"); await check(legacyPage, "2026-10-09", "2026-10-14");
      assert.deepEqual(await legacyPage.evaluate(() => JSON.parse(localStorage.getItem("savy:yield-curve-dates:v2"))), {a: "2026-10-09", b: "2026-10-14"});
      assert.equal(await legacyPage.locator("#yieldDateC,#yieldDateD,#yieldDateE").count(), 0); await legacyContext.close();
    }
    const trackingContext = await browser.newContext(), trackingPage = await componentPage(trackingContext);
    await trackingContext.addInitScript(payload => {
      localStorage.setItem("savy:yield-curves:v1", JSON.stringify(payload));
      localStorage.setItem("savy:yield-curve-dates:v2", JSON.stringify({a:"2026-09-14",b:"2026-10-14"}));
    }, {...fixture,countries:fixture.countries.map((country,index)=>index?country:{...country,history:[...country.history,["2026-10-15",...country.history.at(-1).slice(1)]]})});
    await trackingPage.route("https://**", route=>route.abort());
    await trackingPage.goto(base); await trackingPage.waitForFunction(()=>document.querySelectorAll(".yield-curve-card").length===2);
    assert.equal(await trackingPage.locator("#yieldFollowLatest").isChecked(),true,"Legacy presets migrate to automatic tracking even when countries published on different dates");
    await trackingContext.close();
    offline = true; await page.evaluate(() => window.SavyYieldCurves.refresh());
    assert.match(await page.locator("#yieldStatus").innerText(), /Copie conservée/); await check(page, "2026-09-14", "2026-10-14");
    offline = false; malformed = true; await page.evaluate(() => window.SavyYieldCurves.refresh());
    assert.match(await page.locator("#yieldStatus").innerText(), /Copie conservée/); await check(page, "2026-09-14", "2026-10-14");
    malformed = false; await page.evaluate(() => window.SavyYieldCurves.refresh()); assert.doesNotMatch(await page.locator("#yieldStatus").innerText(), /Copie conservée/);
    offline = true; const blank = await browser.newContext({viewport: {width: 320, height: 1000}}), empty = await componentPage(blank,); await empty.route("https://**", route => route.abort());
    empty.on("pageerror", error => errors.push(error.message)); await empty.goto(base); await empty.waitForFunction(() => document.querySelector("#yieldStatus").textContent.includes("Courbes indisponibles"));
    assert.equal(await empty.locator("#yieldDateA").isDisabled(), true); assert.equal(await empty.locator("#yieldCurveGrid svg").count(), 0);
    assert.equal(requests.some(url => /portfolio-key=|positions=/.test(url)), false); assert.deepEqual(errors, []);
    offline = false;
    await page.locator('[data-yield-preset="1M"]').click();
    const addDay = day => fixture.countries[0].history.push([day, ...fixture.countries[0].history.at(-1).slice(1).map(v=>v===null?null:v+.01)]);
    addDay("2026-10-15");
    await page.evaluate(() => window.SavyYieldCurves.refresh());
    assert.equal(await page.locator("#yieldDateB").inputValue(), "2026-10-15", "Automatic comparison advances on a new publication");
    assert.equal(await page.locator("#yieldFollowLatest").isChecked(), true);
    assert.match(await page.locator('[data-yield-country="CA"] .yield-chart-legend').innerText(), /2026-10-14 \(demandé : 2026-10-15\)/);
    await setDates(page, "2026-09-14", "2026-10-14");
    assert.equal(await page.locator("#yieldFollowLatest").isChecked(), false);
    addDay("2026-10-16");
    await page.evaluate(() => window.SavyYieldCurves.refresh());
    assert.equal(await page.locator("#yieldDateB").inputValue(), "2026-10-14", "Manual historical dates stay fixed");
    await page.reload(); await page.waitForFunction(() => document.querySelectorAll(".yield-curve-card").length === 2);
    assert.equal(await page.locator("#yieldDateB").inputValue(), "2026-10-14");
    await page.locator("#yieldFollowLatest").check();
    assert.equal(await page.locator("#yieldDateB").inputValue(), "2026-10-16");
    await page.reload(); await page.waitForFunction(() => document.querySelectorAll(".yield-curve-card").length === 2);
    assert.equal(await page.locator("#yieldFollowLatest").isChecked(), true);
    assert.equal(await page.locator("#yieldDateB").inputValue(), "2026-10-16");
    assert.deepEqual(errors, []);
    await context.close(); await blank.close();
    console.log("Yield curve browser checks passed: only A/B with all nine presets, prior saved dates migrated, exact tables and basis points, real observation dates on weekends, missing-tenor gaps, keyboard/pointer controls, swapped dates, invalid/no-history dates, both themes, independent offline/cache handling and all presets accessible at 320/375/768px.");
  } finally {await browser.close(); server.close();}
}
main().catch(error => {console.error(error); server.close(); process.exitCode = 1;});
