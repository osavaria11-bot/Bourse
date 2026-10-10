"use strict";
// Portfolio quantities in this test are synthetic, never the owner's holdings.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const {chromium} = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const P = require("../js/portfolio-utils.js");
const root = path.resolve(__dirname, "..");
const catalog = JSON.parse(fs.readFileSync(path.join(root, "data/securities.json"), "utf8"));
const rawPrices = JSON.parse(fs.readFileSync(path.join(root, "data/security-prices.json"), "utf8"));
const prices = P.normalizePrices(rawPrices, catalog);
const sample = catalog.series.filter(d => ["SHOP", "CLS", "V", "VFV"].includes(d.id));
const syntheticPositions = sample.map(d => ({ticker: d.id, quantity: d.id === "V" ? 1.5 : 2, currency: d.currency, average_cost: d.id === "MAXQ" ? 0.25 : 50}));
const fragment = Buffer.from(JSON.stringify(syntheticPositions.map(p => [p.ticker, p.quantity, p.currency, p.average_cost]))).toString("base64url");
let offline = false, missingFX = false;
const requestPaths = [];
const mime = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png"};
const server = http.createServer((request, response) => {
  requestPaths.push(request.url);
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname === "/data/security-prices.json") {
    const data = structuredClone(rawPrices);
    if (missingFX) Object.assign(data.series.find(p => p.id === "USDCAD"), {history: [], date: null, value: null, fetch_status: "unavailable"});
    response.writeHead(offline ? 503 : 200, {"Content-Type": "application/json"}); response.end(offline ? "{}" : JSON.stringify(data)); return;
  }
  const filename = path.resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
  if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {response.writeHead(404); response.end(); return;}
  response.writeHead(200, {"Content-Type": mime[path.extname(filename)] || "application/octet-stream"}); fs.createReadStream(filename).pipe(response);
});
async function main() {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({headless: true});
  try {
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}, acceptDownloads: true});
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message)); await page.route("https://**", route => route.abort());
    await page.goto(url + "/#positions=" + fragment);
    await page.waitForFunction(() => document.querySelectorAll("#portfolioRows tr").length === 4);
    assert.equal(new URL(page.url()).hash, "#portfolio");
    assert.equal(requestPaths.some(p => p.includes("positions=") || p.includes(fragment)), false);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("savy:private-holdings:v1")));
    assert.deepEqual(saved.positions, syntheticPositions);
    assert.equal(await page.locator('#portfolioRows tr[data-ticker="SHOP"] a').getAttribute("href"), "https://finance.yahoo.com/quote/SHOP.TO/");
    assert.equal(await page.locator('#portfolioRows tr[data-ticker="CLS"] a').getAttribute("href"), "https://finance.yahoo.com/quote/CLS/");
    const history = P.historyFor(syntheticPositions, prices), current = P.valuationAt(syntheticPositions, prices, history.at(-1)[0]);
    assert.equal(await page.locator("#portfolioValue").innerText(), new Intl.NumberFormat("fr-CA", {style: "currency", currency: "CAD", maximumFractionDigits: 2}).format(current.total));
    assert.match(await page.locator("#portfolioStatus").innerText(), /4\/4/);
    assert.match(await page.locator("#portfolioUnrealized").innerText(), /Gain latent estimé.*change actuel/);
    const averageCost = page.getByRole("textbox", {name: "Prix moyen V", exact: true});
    await averageCost.fill("55,25"); await averageCost.press("Tab");
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("savy:private-holdings:v1")).positions.find(p => p.ticker === "V").average_cost === 55.25);
    const controls = page.getByRole("group", {name: "Période du portefeuille", exact: true});
    for (const range of P.RANGES) {
      await controls.getByRole("button", {name: range.label, exact: true}).click();
      assert.equal(await controls.getByRole("button", {name: range.label, exact: true}).getAttribute("aria-pressed"), "true");
      const selected = P.period(history, range.key);
      assert.match(await page.locator("#portfolioPeriod").innerText(), new RegExp(selected.start + ".*" + selected.end));
      assert.equal(await page.locator("#portfolioChart svg").count(), 1);
    }
    assert.equal(await page.locator("#portfolioChart path").evaluateAll(nodes => nodes.some(n => /NaN|Infinity/.test(n.getAttribute("d")))), false);
    const chart = page.locator("#portfolioChart svg"); await chart.focus(); await chart.press("Home");
    const first = await page.locator("#portfolioChart .chart-tooltip").innerText(); await chart.press("End");
    assert.notEqual(await page.locator("#portfolioChart .chart-tooltip").innerText(), first);
    const quantity = page.getByRole("textbox", {name: "Quantité V", exact: true});
    await quantity.fill("2,25"); await quantity.press("Tab");
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("savy:private-holdings:v1")).positions.find(p => p.ticker === "V").quantity === 2.25);
    await page.reload(); await page.waitForSelector("#portfolioRows tr"); assert.equal(await quantity.inputValue(), "2,25");
    const downloading = page.waitForEvent("download"); await page.locator("#portfolioExport").click();
    const download = await downloading;
    const exported = JSON.parse(fs.readFileSync(await download.path(), "utf8")); assert.equal(exported.positions.length, 4); assert.equal(exported.positions.find(p => p.ticker === "V").quantity, 2.25); assert.equal(exported.positions.find(p => p.ticker === "V").average_cost, 55.25);
    await page.getByRole("button", {name: "Retirer V", exact: true}).click(); assert.equal(await page.locator("#portfolioRows tr").count(), 3);
    await page.locator("#portfolioImport").setInputFiles({name: "synthetic-positions.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(exported))});
    await page.waitForFunction(() => document.querySelectorAll("#portfolioRows tr").length === 4);
    await controls.getByRole("button", {name: "YTD", exact: true}).click();
    if (process.env.SCREENSHOT_LOGS) console.log("SCREENSHOT_PORTFOLIO_DESKTOP " + (await page.locator("#portfolio").screenshot()).toString("base64"));
    for (const width of [375, 320]) {
      await page.setViewportSize({width, height: 1000});
      const size = await page.evaluate(() => ({width: innerWidth, scroll: document.documentElement.scrollWidth,
        gainWhiteSpace: getComputedStyle(document.querySelector("#portfolioUnrealized")).whiteSpace}));
      assert.equal(size.gainWhiteSpace, "normal");
      assert.ok(size.scroll <= size.width, "Portfolio overflows at " + width + ": " + JSON.stringify(size));
      assert.ok(await page.locator(".portfolio-table").evaluate(node => node.scrollWidth > node.clientWidth));
    }
    if (process.env.SCREENSHOT_LOGS) {await page.setViewportSize({width: 375, height: 1000}); await page.locator("#portfolioTitle").scrollIntoViewIfNeeded(); console.log("SCREENSHOT_PORTFOLIO_MOBILE " + (await page.screenshot()).toString("base64"));}
    offline = true;
    await page.reload(); await page.waitForFunction(() => document.querySelector("#portfolioStatus").textContent.includes("Copie de cours conservée"));
    assert.equal(await page.locator("#portfolioRows tr").count(), 4);
    offline = false; missingFX = true;
    await page.reload(); await page.waitForFunction(() => document.querySelector("#portfolioValueLabel").textContent.includes("PARTIELLE"));
    assert.equal(await page.locator("#portfolioChange").innerText(), "— · —");
    assert.match(await page.locator("#portfolioMissing").innerText(), /cours ou change manquant/);
    assert.equal(await page.locator("#portfolioChart svg").count(), 0);
    assert.deepEqual(errors, []);
    await context.close(); missingFX = false;
    const blankContext = await browser.newContext(), blank = await blankContext.newPage(); await blank.route("https://**", route => route.abort());
    await blank.goto(url); await blank.waitForFunction(() => document.querySelector("#positionTicker").options.length === 100);
    assert.equal(await blank.locator("#portfolioContent").isVisible(), false);
    assert.equal(await blank.locator("#portfolioExport").isDisabled(), true);
    await blankContext.close();
    console.log("Portfolio checks passed: 4 private synthetic positions, exact CAD/USD listings, CAD valuation, all six periods, keyboard, edits/import/export, persistence, offline cache, missing-FX protection, empty public view and 320px mobile.");
  } finally {await browser.close();}
}
main().catch(error => {console.error(error); process.exitCode = 1;}).finally(() => server.close());
