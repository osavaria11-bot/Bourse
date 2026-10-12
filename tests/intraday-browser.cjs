"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), http = require("node:http"), path = require("node:path");
const {chromium} = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const U = require("../js/macro-utils.js"), P = require("../js/portfolio-utils.js");
const root = path.resolve(__dirname, ".."), load = file => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const prices = P.normalizePrices(load("data/security-prices.json"), load("data/securities.json"));
const now = Date.now(), day = new Intl.DateTimeFormat("en-CA", {timeZone: "America/Toronto"}).format(now);
const holdings = [{ticker: "AAPL", currency: "USD", quantity: 2, average_cost: 100}, {ticker: "SHOP", currency: "CAD", quantity: 1, average_cost: 50}];
const apple = prices.series.find(p => p.id === "AAPL").value, shop = prices.series.find(p => p.id === "SHOP").value;
const spx = load("data/market-indices.json").series.find(p => p.id === "SPX");
function q(id, symbol, currency, price) {return {id, quote_symbol: symbol, currency, price, previous_close: price / 1.1,
  timestamp: new Date(now - 60000).toISOString(), fetched_at: new Date(now).toISOString(), session_date: day,
  exchange_timezone: "America/Toronto", market_state: "regular", fetch_status: "fresh", session_end: new Date(now + 3600000).toISOString()};}
let wrongCurrency = false, unavailable = false;
const snapshot = {schema_version: 1, kind: "intraday_quotes", generated_at: new Date(now).toISOString(), quotes: [
  q("AAPL", "AAPL", "USD", apple * 1.1), q("SHOP", "SHOP.TO", "CAD", shop * 1.05),
  q("SPX", "^GSPC", "USD", spx.value * 1.01), q("FEQT", "FEQT.NE", "CAD", prices.series.find(p => p.id === "FEQT").value * 1.02),
  q("VIXCLS", "^VIX", "USD", 25.5), q("UST10Y", "^TNX", "USD", 5.1), q("WTIFUT", "CL=F", "USD", 95)
]};
const types = {".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".png": "image/png"};
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname === "/data/intraday-quotes.json") {
    const data = structuredClone(snapshot); if (wrongCurrency) data.quotes[0].currency = "CAD";
    response.writeHead(unavailable ? 503 : 200, {"Content-Type": "application/json"});
    response.end(unavailable ? "{}" : JSON.stringify(data)); return;
  }
  const file = path.resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {response.writeHead(404); response.end(); return;}
  response.writeHead(200, {"Content-Type": types[path.extname(file)] || "application/octet-stream"}); fs.createReadStream(file).pipe(response);
});
async function main() {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({headless: true}), url = "http://127.0.0.1:" + server.address().port;
  try {
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
    await context.addInitScript(positions => localStorage.setItem("savy:private-holdings:v1", JSON.stringify({schema_version: 1, positions})), holdings);
    const page = await context.newPage(), errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.route("https://**", route => route.request().url().startsWith("https://biquote.io/api/USDCAD") ?
      route.fulfill({status: 200, contentType: "application/json", headers: {"Access-Control-Allow-Origin": "*"}, body: JSON.stringify({symbol: "USDCAD", mid: 1.4, timestamp: new Date(now).toISOString(), marketState: "open"})}) : route.abort());
    await page.goto(url); await page.waitForFunction(() => document.querySelector("#refreshButton").disabled === false && document.querySelectorAll("#portfolioRows tr").length === 2);
    const money = value => new Intl.NumberFormat("fr-CA", {style: "currency", currency: "CAD", maximumFractionDigits: 2}).format(value);
    assert.equal(await page.locator("#portfolioValue").innerText(), money(2 * apple * 1.1 * 1.4 + shop * 1.05));
    assert.match(await page.locator("#portfolioStatus").innerText(), /2\/2 cotations en séance/);
    await page.locator("#portfolioPositionsToggle").click();
    assert.match(await page.locator('#portfolioRows tr[data-ticker="AAPL"] td').nth(3).innerText(), /En séance/);
    assert.match(await page.locator('.indicator-card[data-id="VIXCLS"] .current-value').innerText(), /25,50/);
    assert.match(await page.locator('.indicator-card[data-id="DCOILWTICO"] .live-companion').innerText(), /WTI à terme/);
    await page.locator("#marketRanges").getByRole("button", {name: "1 jour", exact: true}).click();
    assert.match(await page.locator('.market-card[data-id="SPX"] .meta').first().innerText(), /En séance/);
    const actualReturn = await page.locator('.market-card[data-id="SPX"] .market-return').innerText();
    const base = spx.date === day ? spx.history.at(-2)[1] : spx.value;
    const expected = (spx.value * 1.01 / base - 1) * 100;
    assert.equal(actualReturn, (expected > 0 ? "+" : "") + U.formatNumber(expected, 2) + " % · 1 jour");
    assert.ok(await page.locator("#portfolioContributionRows tr").count() === 2);
    assert.match(await page.locator("#portfolioRiskStatus").innerText(), /séances communes|assez de clôtures/);
    const value = await page.locator("#portfolioValue").innerText();
    unavailable = true; await page.evaluate(() => window.SavyLiveQuotes.refresh());
    assert.equal(await page.locator("#portfolioValue").innerText(), value, "An outage keeps the last dated quote");
    unavailable = false; wrongCurrency = true; await page.evaluate(() => window.SavyLiveQuotes.refresh());
    assert.equal(await page.locator("#portfolioValue").innerText(), money(2 * apple * 1.4 + shop * 1.05), "Wrong listing currency must fall back to the actual listing close");
    wrongCurrency = false; await page.evaluate(() => window.SavyLiveQuotes.refresh());
    await page.setViewportSize({width: 390, height: 844});
    await page.locator("#portfolio").scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log("Intraday UI verified: live values and period returns, current FX, macro references, contributions, daily risk, outage/currency fallback and mobile.");
  } finally {await browser.close(); await new Promise(resolve => server.close(resolve));}
}
main().catch(error => {console.error(error); process.exitCode = 1;});
