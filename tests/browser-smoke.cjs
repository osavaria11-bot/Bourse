"use strict";
/* Browser fixtures are synthetic and never written to the site's data directory. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const root = path.resolve(__dirname, "..");
const definitions = JSON.parse(fs.readFileSync(path.join(root, "data/series.json"), "utf8")).series;
const now = new Date();
const series = definitions.map((definition, index) => {
  const count = definition.frequency === "quarterly" ? 40 : definition.frequency === "monthly" ? 36 : 80;
  const history = [];
  for (let i = count - 1; i >= 0; i--) {
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    if (definition.frequency === "quarterly") {
      day.setUTCDate(1); day.setUTCMonth(Math.floor(now.getUTCMonth() / 3) * 3 - i * 3);
    } else if (definition.frequency === "monthly") {
      day.setUTCDate(1); day.setUTCMonth(now.getUTCMonth() - i);
    } else day.setUTCDate(day.getUTCDate() - i * (definition.frequency === "weekly" ? 7 : 1));
    history.push([day.toISOString().slice(0, 10), i === 15 ? null : Math.round((index + 2 + Math.sin(i / 4)) * 1000) / 1000]);
  }
  const valid = history.filter(row => row[1] !== null);
  return { ...definition, date: valid.at(-1)[0], value: valid.at(-1)[1],
    previous_date: valid.at(-2)[0], previous_value: valid.at(-2)[1],
    change: valid.at(-1)[1] - valid.at(-2)[1], history, fetch_status: "fresh",
    last_successful_fetch: now.toISOString(), source_url: "https://fred.stlouisfed.org/series/" + definition.id };
});
const dataset = { schema_version: 2, generated_at: now.toISOString(), last_successful_update: now.toISOString(),
  update_status: "fresh_data", data_provider: "SYNTHETIC TEST FIXTURE", series };
const briefing = { ...dataset, series: undefined, briefing_paragraph: "Fixture de test — aucune donnée de marché réelle.",
  news_sources: [], series_snapshot: series };
let offline = false, failAllData = false;
const contentTypes = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".png": "image/png" };
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname === "/data/macro-data.json") {
    response.writeHead(offline ? 503 : 200, { "Content-Type": "application/json" });
    response.end(offline ? "{}" : JSON.stringify(dataset)); return;
  }
  if (pathname === "/data/daily-briefing.json") {
    response.writeHead(failAllData ? 503 : 200, { "Content-Type": "application/json" });
    response.end(failAllData ? "{}" : JSON.stringify(briefing)); return;
  }
  const filename = path.resolve(root, "." + (pathname === "/" ? "/index.html" : decodeURIComponent(pathname)));
  if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
    response.writeHead(404); response.end(); return;
  }
  response.writeHead(200, { "Content-Type": contentTypes[path.extname(filename)] || "application/octet-stream" });
  fs.createReadStream(filename).pipe(response);
});
async function waitCount(page, count) {
  await page.waitForFunction(expected => document.querySelectorAll(".indicator-card").length === expected, count);
}
async function run() {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("https://**", route => route.abort());
    await page.goto(url); await waitCount(page, 33);
    await page.waitForSelector("#grid svg");
    assert.match(await page.locator("#updated").innerText(), /33\/33/);
    assert.ok(await page.locator("#grid svg").count() > 0);
    assert.equal(await page.locator("#grid path").evaluateAll(nodes => nodes.some(node => /NaN|Infinity/.test(node.getAttribute("d")))), false);
    await page.locator("#searchInput").fill("epargne"); await waitCount(page, 1);
    assert.equal(await page.locator(".indicator-card").getAttribute("data-id"), "A072RC1Q156SBEA");
    await page.locator("#searchInput").fill(""); await waitCount(page, 33);
    await page.locator("#categoryFilters button").filter({ hasText: /^Canada$/ }).click(); await waitCount(page, 2);
    await page.locator("#categoryFilters button").filter({ hasText: /^Tous$/ }).click(); await waitCount(page, 33);
    await page.locator(".favorite-button").first().click();
    await page.locator("#favoritesOnly").click(); await waitCount(page, 1);
    await page.locator("#favoritesOnly").click(); await waitCount(page, 33);
    await page.reload(); await waitCount(page, 33);
    assert.equal(await page.locator(".favorite-button").first().getAttribute("aria-pressed"), "true");
    await page.locator("#rangeControls button[data-range='3M']").click();
    assert.equal(await page.locator("#rangeControls button[data-range='3M']").getAttribute("aria-pressed"), "true");
    await page.locator(".detail-button").first().click();
    await page.waitForFunction(() => document.querySelector("#detailDialog").open);
    assert.ok(await page.locator("#detailTable tr").count() > 0);
    await page.locator("#detailRanges button[data-range='1M']").click();
    const chart = page.locator("#detailChart svg"); await chart.focus();
    const before = await page.locator("#detailChart .chart-tooltip").innerText();
    await chart.press("ArrowLeft");
    assert.notEqual(await page.locator("#detailChart .chart-tooltip").innerText(), before);
    const historyDownload = page.waitForEvent("download"); await page.locator("#detailExport").click();
    const historical = await historyDownload;
    assert.match(historical.suggestedFilename(), /T10Y2Y-1M\.csv$/);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#detailDialog").evaluate(node => node.open), false);
    const snapshotDownload = page.waitForEvent("download"); await page.locator("#exportButton").click();
    const snapshot = await snapshotDownload;
    const csv = fs.readFileSync(await snapshot.path(), "utf8");
    assert.match(csv, /Série FRED/); assert.match(csv, /DEXCAUS/);
    await page.locator("#themeToggle").click();
    assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
    await page.reload(); await waitCount(page, 33);
    assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
    for (const width of [375, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const layout = await page.evaluate(() => ({width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth,
        overflow: [...document.querySelectorAll("body *")].filter(node => node.getBoundingClientRect().right > window.innerWidth + 1)
          .slice(0, 10).map(node => ({tag: node.tagName, className: String(node.className), right: node.getBoundingClientRect().right}))}));
      assert.ok(layout.scrollWidth <= layout.width, "Horizontal overflow at " + width + ": " + JSON.stringify(layout));
    }
    if (process.env.QA_SCREENSHOTS_DIR) {
      fs.mkdirSync(process.env.QA_SCREENSHOTS_DIR, { recursive: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({ path: path.join(process.env.QA_SCREENSHOTS_DIR, "savy-desktop.png") });
      await page.setViewportSize({ width: 375, height: 900 });
      await page.screenshot({ path: path.join(process.env.QA_SCREENSHOTS_DIR, "savy-mobile.png") });
    }
    offline = true;
    await page.reload(); await waitCount(page, 33);
    assert.match(await page.locator("#updated").innerText(), /Copie conservée/);
    assert.equal(await page.locator("#refreshButton").isEnabled(), true);
    failAllData = true;
    const freshContext = await browser.newContext();
    const empty = await freshContext.newPage();
    await empty.route("https://**", route => route.abort());
    await empty.goto(url);
    await empty.waitForFunction(() => document.querySelector("#updated").textContent.includes("ne sont pas disponibles"));
    assert.equal(await empty.locator("#refreshButton").isEnabled(), true);
    assert.deepEqual(errors, []);
    console.log("Browser checks passed: 33 cards, search, categories, persistent favorites/theme, charts/keyboard, CSV downloads, 320/375px layouts, offline fallback.");
    await freshContext.close(); await context.close();
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
