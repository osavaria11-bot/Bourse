"use strict";
// Portfolio quantities in this test are synthetic, never the owner's holdings.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const {chromium} = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const P = require("../js/portfolio-utils.js");
const U = require("../js/macro-utils.js");
const root = path.resolve(__dirname, "..");
const catalog = JSON.parse(fs.readFileSync(path.join(root, "data/securities.json"), "utf8"));
const rawPrices = JSON.parse(fs.readFileSync(path.join(root, "data/security-prices.json"), "utf8"));
const prices = P.normalizePrices(rawPrices, catalog);
const sample = catalog.series.filter(d => ["SHOP", "CLS", "V", "VFV", "MSFT", "XIU"].includes(d.id));
const syntheticPositions = sample.map(d => ({ticker: d.id, quantity: d.id === "V" ? 1.5 : 2, currency: d.currency, average_cost: d.id === "CLS" ? 500 : d.id === "SHOP" ? 200 : d.id === "V" ? 350 : 50}));
const fragment = Buffer.from(JSON.stringify(syntheticPositions.map(p => [p.ticker, p.quantity, p.currency, p.average_cost]))).toString("base64url");
let offline = false, missingFX = false, missingBaseline = false;
const requestPaths = [];
const mime = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png"};
const server = http.createServer((request, response) => {
  requestPaths.push(request.url);
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname === "/data/security-prices.json") {
    const data = structuredClone(rawPrices);
    if (missingFX) Object.assign(data.series.find(p => p.id === "USDCAD"), {history: [], date: null, value: null, fetch_status: "unavailable"});
    if (missingBaseline) {const security = data.series.find(p => p.id === "CLS"); security.history = security.history.slice(-25);}
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
    await page.waitForFunction(expected => document.querySelectorAll("#portfolioRows tr").length === expected, syntheticPositions.length);
    assert.equal(new URL(page.url()).hash, "#portfolio");
    assert.equal(requestPaths.some(p => p.includes("positions=") || p.includes(fragment)), false);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("savy:private-holdings:v1")));
    assert.deepEqual(saved.positions, syntheticPositions);
    const toggle = page.locator("#portfolioPositionsToggle");
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    assert.equal(await page.locator("#portfolioPositions").isVisible(), false);
    assert.match(await toggle.innerText(), /Afficher mes positions \(6\)/);
    assert.equal(await page.locator('#portfolioRows tr[data-ticker="SHOP"] a').getAttribute("href"), "https://finance.yahoo.com/quote/SHOP.TO/");
    assert.equal(await page.locator('#portfolioRows tr[data-ticker="CLS"] a').getAttribute("href"), "https://finance.yahoo.com/quote/CLS/");
    const history = P.historyFor(syntheticPositions, prices), current = P.valuationAt(syntheticPositions, prices, history.at(-1)[0]);
    assert.equal(await page.locator("#portfolioValue").innerText(), new Intl.NumberFormat("fr-CA", {style: "currency", currency: "CAD", maximumFractionDigits: 2}).format(current.total));
    assert.match(await page.locator("#portfolioStatus").innerText(), /6\/6/);
    assert.match(await page.locator("#portfolioUnrealized").innerText(), /Gain latent estimé.*change actuel/);
    const month = P.monthlyPerformance(syntheticPositions, prices, history.at(-1)[0]);
    assert.equal(month.rows.length, 6);
    const best = month.rows.slice(0, 3), worst = month.rows.slice(-3).reverse();
    assert.deepEqual(await page.locator("#portfolioBest li").evaluateAll(nodes => nodes.map(n => n.dataset.ticker)), best.map(row => row.ticker));
    assert.deepEqual(await page.locator("#portfolioWorst li").evaluateAll(nodes => nodes.map(n => n.dataset.ticker)), worst.map(row => row.ticker));
    for (const [selector, ranked] of [["#portfolioBest", best], ["#portfolioWorst", worst]]) {
      const displayed = await page.locator(selector + " .change").allTextContents();
      assert.deepEqual(displayed, ranked.map(row => (row.percent > 0 ? "+" : "") + U.formatNumber(row.percent, 2) + " %"));
    }
    assert.match(await page.locator("#portfolioMoversPeriod").innerText(), new RegExp(month.start + ".*" + month.end + ".*1 mois glissant.*CAD"));
    await toggle.click(); assert.equal(await toggle.getAttribute("aria-expanded"), "true");
    assert.equal(await page.locator("#portfolioPositions").isVisible(), true);
    const period = P.period(history, "YTD"), previous = P.valuationAt(syntheticPositions, prices, period.start);
    const sortable = current.rows.map(row => ({...row, period_change_cad: row.value_cad - previous.rows.find(p => p.ticker === row.ticker).value_cad}));
    for (const key of ["unrealized_percent", "unrealized_cad", "period_change_cad"]) {
      const header = page.locator('[data-portfolio-sort="' + key + '"]');
      for (const descending of [true, false]) {
        await header.click();
        assert.equal(await header.locator("..").getAttribute("aria-sort"), descending ? "descending" : "ascending");
        assert.deepEqual(await page.locator("#portfolioRows tr").evaluateAll(nodes => nodes.map(n => n.dataset.ticker)), P.sortRows(sortable, key, descending).map(row => row.ticker));
      }
    }
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
      const ticks = await page.locator("#portfolioChart .chart-axis").evaluateAll(nodes => nodes.slice(0, 4).map(n => n.textContent));
      assert.equal(new Set(ticks).size, 4, "Valuation-axis ticks must remain distinguishable");
      const chart = page.locator("#portfolioChart svg"); await chart.focus(); await chart.press("Home");
      assert.match(await page.locator("#portfolioChart .chart-tooltip").innerText(), new RegExp(selected.start + ".*CAD.*0,00 % depuis le " + selected.start));
      await chart.press("End");
      const text = await page.locator("#portfolioChart .chart-tooltip").innerText();
      assert.ok(text.includes(selected.end));
      assert.ok(text.includes(new Intl.NumberFormat("fr-CA", {style: "currency", currency: "CAD", maximumFractionDigits: 2}).format(selected.history.at(-1)[1])));
      assert.ok(text.includes((selected.percent > 0 ? "+" : "") + U.formatNumber(selected.percent, 2) + " % depuis le " + selected.start));
      const box = await chart.boundingBox();
      await chart.hover({position: {x: box.width * 85 / 900, y: box.height / 2}});
      assert.match(await page.locator("#portfolioChart .chart-tooltip").innerText(), new RegExp(selected.start + ".*0,00 % depuis le " + selected.start));
      assert.deepEqual(await page.locator("#portfolioBest li").evaluateAll(nodes => nodes.map(n => n.dataset.ticker)), best.map(row => row.ticker));
    }
    assert.equal(await page.locator("#portfolioChart path").evaluateAll(nodes => nodes.some(n => /NaN|Infinity/.test(n.getAttribute("d")))), false);
    const chart = page.locator("#portfolioChart svg"); await chart.focus(); await chart.press("Home");
    const first = await page.locator("#portfolioChart .chart-tooltip").innerText(); await chart.press("End");
    assert.notEqual(await page.locator("#portfolioChart .chart-tooltip").innerText(), first);
    const quantity = page.getByRole("textbox", {name: "Quantité V", exact: true});
    await quantity.fill("2,25"); await quantity.press("Tab");
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("savy:private-holdings:v1")).positions.find(p => p.ticker === "V").quantity === 2.25);
    await toggle.click(); assert.equal(await page.locator("#portfolioPositions").isVisible(), false);
    await page.reload(); await page.waitForFunction(() => document.querySelectorAll("#portfolioRows tr").length === 6);
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    assert.equal(await page.locator("#portfolioPositions").isVisible(), false);
    await toggle.click(); assert.equal(await quantity.inputValue(), "2,25");
    await page.reload(); await page.waitForSelector("#portfolioRows tr");
    assert.equal(await toggle.getAttribute("aria-expanded"), "true");
    const downloading = page.waitForEvent("download"); await page.locator("#portfolioExport").click();
    const download = await downloading;
    const exported = JSON.parse(fs.readFileSync(await download.path(), "utf8")); assert.equal(exported.positions.length, 6); assert.equal(exported.positions.find(p => p.ticker === "V").quantity, 2.25); assert.equal(exported.positions.find(p => p.ticker === "V").average_cost, 55.25);
    await page.getByRole("button", {name: "Retirer V", exact: true}).click(); assert.equal(await page.locator("#portfolioRows tr").count(), 5);
    await page.locator("#portfolioImport").setInputFiles({name: "synthetic-positions.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(exported))});
    await page.waitForFunction(() => document.querySelectorAll("#portfolioRows tr").length === 6);
    await controls.getByRole("button", {name: "YTD", exact: true}).click();
    await toggle.click();
    if (process.env.SCREENSHOT_LOGS) console.log("SCREENSHOT_PORTFOLIO_DESKTOP " + (await page.locator("#portfolio").screenshot()).toString("base64"));
    for (const width of [375, 320]) {
      await page.setViewportSize({width, height: 1000});
      const size = await page.evaluate(() => ({width: innerWidth, scroll: document.documentElement.scrollWidth,
        gainWhiteSpace: getComputedStyle(document.querySelector("#portfolioUnrealized")).whiteSpace}));
      assert.equal(size.gainWhiteSpace, "normal");
      assert.ok(size.scroll <= size.width, "Portfolio overflows at " + width + ": " + JSON.stringify(size));
      assert.equal(await page.locator("#portfolioPositions").isVisible(), false);
      await toggle.click();
      assert.ok(await page.locator(".portfolio-table").evaluate(node => node.scrollWidth > node.clientWidth));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await toggle.click();
    }
    if (process.env.SCREENSHOT_LOGS) {await page.setViewportSize({width: 375, height: 1000}); await page.locator("#portfolioTitle").scrollIntoViewIfNeeded(); console.log("SCREENSHOT_PORTFOLIO_MOBILE " + (await page.screenshot()).toString("base64"));}
    offline = true;
    await page.reload(); await page.waitForFunction(() => document.querySelector("#portfolioStatus").textContent.includes("Copie de cours conservée"));
    assert.equal(await page.locator("#portfolioRows tr").count(), 6);
    assert.equal(await page.locator("#portfolioBest li[data-ticker]").count(), 3);
    offline = false; missingBaseline = true;
    await page.reload(); await page.waitForSelector("#portfolioChart svg");
    const incompleteChart = page.locator("#portfolioChart svg"); await incompleteChart.focus(); await incompleteChart.press("End");
    assert.match(await page.locator("#portfolioChart .chart-tooltip").innerText(), /variation indisponible.*base.*manquante/);
    missingBaseline = false; missingFX = true;
    await page.reload(); await page.waitForFunction(() => document.querySelector("#portfolioValueLabel").textContent.includes("PARTIELLE"));
    assert.equal(await page.locator("#portfolioChange").innerText(), "— · —");
    assert.match(await page.locator("#portfolioMissing").innerText(), /cours ou change manquant/);
    assert.equal(await page.locator("#portfolioChart svg").count(), 0);
    assert.match(await page.locator("#portfolioMoversNote").innerText(), /historique ou change manquant/);
    assert.deepEqual(errors, []);
    await context.close(); missingFX = false;
    const blankContext = await browser.newContext(), blank = await blankContext.newPage(); await blank.route("https://**", route => route.abort());
    await blank.goto(url); await blank.waitForFunction(expected => document.querySelector("#positionTicker").options.length === expected, catalog.series.length);
    assert.equal(await blank.locator("#portfolioContent").isVisible(), false);
    assert.equal(await blank.locator("#portfolioExport").isDisabled(), true);
    await blank.locator("#positionTicker").selectOption("SNDK");
    await blank.locator("#positionQuantity").fill("2"); await blank.locator("#positionAverageCost").fill("30");
    await blank.locator("#positionForm").getByRole("button", {name: "Ajouter / modifier"}).click();
    await blank.waitForFunction(() => document.querySelectorAll("#portfolioRows tr").length === 1);
    const cdr = await blank.evaluate(() => JSON.parse(localStorage.getItem("savy:private-holdings:v1")).positions[0]);
    assert.deepEqual(cdr, {ticker: "SNDK", quantity: 2, currency: "CAD", average_cost: 30});
    assert.equal(await blank.locator('#portfolioRows tr[data-ticker="SNDK"] a').getAttribute("href"), "https://finance.yahoo.com/quote/SNDK.TO/");
    const cdrQuote = prices.series.find(row => row.id === "SNDK");
    assert.equal(await blank.locator("#portfolioValue").innerText(), new Intl.NumberFormat("fr-CA", {style: "currency", currency: "CAD", maximumFractionDigits: 2}).format(cdrQuote.value * 2));
    assert.equal(await blank.locator("#portfolioPositions").isVisible(), false);
    await blankContext.close();
    console.log("Portfolio checks passed: 6 private synthetic positions, exact CAD/USD listings including the Sandisk CDR in CAD, CAD valuation, all six periods, monthly top/bottom 3, both directions of three numeric gain sorts, persistent collapsed/expanded positions, hover and keyboard date/value/percent, edits/import/export, offline cache, missing-baseline/FX protection, empty public view and 320px mobile.");
  } finally {await browser.close();}
}
main().catch(error => {console.error(error); process.exitCode = 1;}).finally(() => server.close());
