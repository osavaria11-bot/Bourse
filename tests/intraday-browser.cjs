"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), http = require("node:http"), path = require("node:path");
const {chromium} = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const U = require("../js/macro-utils.js"), P = require("../js/portfolio-utils.js");
const A = require("../js/portfolio-profile-utils.js"), crypto = require("node:crypto");
const root = path.resolve(__dirname, ".."), load = file => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const prices = P.normalizePrices(load("data/security-prices.json"), load("data/securities.json"));
const now = Date.now(), day = new Intl.DateTimeFormat("en-CA", {timeZone: "America/Toronto"}).format(now);
const holdings = [{ticker: "AAPL", currency: "USD", quantity: 2, average_cost: 100}, {ticker: "SHOP", currency: "CAD", quantity: 1, average_cost: 50}];
const apple = prices.series.find(p => p.id === "AAPL").value, shop = prices.series.find(p => p.id === "SHOP").value;
const spx = load("data/market-indices.json").series.find(p => p.id === "SPX");
const catalogue = load("data/securities.json");
const profiles = {"1": holdings, "2": ["VBAL", "FCIN", "XSP", "CGL", "XLF", "ACWV"],
  "3": ["MSFTCDR", "FBAL", "SPYM", "CASH", "DIS", "NFLX"]};
for (const id of ["2", "3"]) profiles[id] = profiles[id].map((ticker, i) => ({ticker, quantity: i + 1.5,
  currency: catalogue.series.find(row => row.id === ticker).currency, average_cost: 25 + i}));
const personalKey = crypto.randomBytes(32).toString("base64url");
const encryptedProfiles = Object.fromEntries(Object.entries(profiles).map(([id, positions]) => {
  const profile = {schema_version: 1, kind: "encrypted_portfolio", algorithm: "AES-GCM", revision: "synthetic-live-v1", portfolio_id: id};
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(personalKey, "base64url"), iv);
  cipher.setAAD(A.associatedData(profile));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify({portfolio_id: id, positions})), cipher.final(), cipher.getAuthTag()]);
  return [id, {...profile, iv: iv.toString("base64url"), ciphertext: ciphertext.toString("base64url")}];
}));
function q(id, symbol, currency, price) {return {id, quote_symbol: symbol, currency, price, previous_close: price / 1.1,
  timestamp: new Date(now - 60000).toISOString(), fetched_at: new Date(now).toISOString(), session_date: day,
  exchange_timezone: "America/Toronto", market_state: "regular", fetch_status: "fresh", session_end: new Date(now + 3600000).toISOString()};}
let wrongCurrency = false, unavailable = false;
const snapshot = {schema_version: 1, kind: "intraday_quotes", generated_at: new Date(now).toISOString(), quotes: [
  q("AAPL", "AAPL", "USD", apple * 1.1), q("SHOP", "SHOP.TO", "CAD", shop * 1.05),
  q("SPX", "^GSPC", "USD", spx.value * 1.01), q("FEQT", "FEQT.NE", "CAD", prices.series.find(p => p.id === "FEQT").value * 1.02),
  q("VIXCLS", "^VIX", "USD", 25.5), q("NASDAQXAU", "^XAU", "USD", 282.5), q("VXEEMCLS", "^VXEEM", "USD", 21.5),
  q("UST10Y", "^TNX", "USD", 5.1), q("WTIFUT", "CL=F", "USD", 95), q("DXY", "DX-Y.NYB", "USD", 100.2),
  ...[...new Set([...profiles["2"], ...profiles["3"]].map(p => p.ticker))].map(id => {
    const point = prices.series.find(p => p.id === id);
    return q(id, point.quote_symbol, point.currency, point.value * 1.03);
  }),
  q("VGRO", "VGRO.TO", "CAD", prices.series.find(p => p.id === "VGRO").value * 1.02)
]};
const types = {".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".png": "image/png"};
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  const profileId = pathname === "/data/personal-portfolio.json" ? "1" : pathname.match(/^\/data\/personal-portfolio-([23])\.json$/)?.[1];
  if (profileId) {response.writeHead(200, {"Content-Type": "application/json"}); response.end(JSON.stringify(encryptedProfiles[profileId])); return;}
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
  async function liveContext(options, positions) {
    const context = await browser.newContext(options);
    await context.addInitScript(({positions, timestamp}) => {
      if (positions) localStorage.setItem("savy:private-holdings:v1", JSON.stringify({schema_version: 1, positions}));
      const originalFetch = window.fetch.bind(window);
      window.fetch = (input, init) => String(input?.url || input).startsWith("https://biquote.io/api/USDCAD") ?
        Promise.resolve(new Response(JSON.stringify({symbol: "USDCAD", mid: 1.4, timestamp, marketState: "open"}),
          {status: 200, headers: {"Content-Type": "application/json"}})) : originalFetch(input, init);
    }, {positions, timestamp: new Date(now).toISOString()});
    return context;
  }
  async function checkMacroBounds(page, width) {
    await page.setViewportSize({width, height: 1000});
    const overflow = await page.locator("#kpis .kpi, #grid .indicator-card").evaluateAll(cards => cards.flatMap(card => {
      const bounds = card.getBoundingClientRect();
      return [...card.querySelectorAll(".kpi-value,.current-value,.change,.meta,.live-companion,a,button")].filter(node => {
        const r = node.getBoundingClientRect(); return r.width && (r.left < bounds.left - 1 || r.right > bounds.right + 1 || node.scrollWidth > node.clientWidth + 1);
      }).map(node => card.dataset.id + ": " + node.className);
    }));
    assert.deepEqual(overflow, [], "Macro content must fit each card at " + width + "px");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  try {
    const context = await liveContext({viewport: {width: 1440, height: 1000}}, holdings);
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
    if (process.env.MACRO_SCREENSHOT_LOGS) console.log("SCREENSHOT_LIVE_MACRO_DESKTOP " + (await page.locator("#kpis").screenshot()).toString("base64"));
    for (const width of [1440, 1101, 768, 390, 375, 320]) await checkMacroBounds(page, width);
    if (process.env.MACRO_SCREENSHOT_LOGS) {
      await page.setViewportSize({width: 375, height: 1000});
      for (const [name, selector] of [["KPIS", "#kpis"], ["FX", '.indicator-card[data-id="DEXCAUS"]'], ["WTI", '.indicator-card[data-id="DCOILWTICO"]']])
        console.log("SCREENSHOT_LIVE_MACRO_MOBILE_" + name + " " + (await page.locator(selector).screenshot()).toString("base64"));
    }
    await page.locator("#portfolio").scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    for (const id of ["2", "3"]) {
      await page.locator('[data-portfolio-id="' + id + '"]').click();
      assert.match(await page.locator("#portfolioStatus").innerText(), new RegExp("Portefeuille " + id + ".*lien personnel"));
      assert.equal(await page.locator("#portfolioContent").isVisible(), false);
    }
    const directContext = await liveContext({viewport: {width: 320, height: 1000}}), direct = await directContext.newPage();
    direct.on("pageerror", error => errors.push(error.message)); await direct.route("https://**", route => route.abort());
    await direct.goto(A.personalURL(url, personalKey));
    await direct.waitForFunction(() => document.querySelectorAll("#portfolioRows tr").length === 2 && document.querySelector("#portfolioPersonalLink").hidden === false);
    for (const id of ["2", "3", "1", "3", "2"]) {
      await direct.locator('[data-portfolio-id="' + id + '"]').click();
      await direct.waitForFunction(id => JSON.parse(localStorage.getItem("savy:portfolio-active:v1")) === id &&
        JSON.parse(localStorage.getItem("savy:portfolio-profile-state:v1" + (id === "1" ? "" : ":" + id)))?.revision === "synthetic-live-v1" &&
        document.querySelector("#portfolioContent").hidden === false, id);
      assert.deepEqual(await direct.evaluate(id => JSON.parse(localStorage.getItem("savy:private-holdings:v1" + (id === "1" ? "" : ":" + id))).positions, id), profiles[id]);
      assert.equal(await direct.locator('[data-portfolio-id="' + id + '"]').getAttribute("aria-pressed"), "true");
      assert.ok(await direct.locator("#portfolioBenchmark").innerText().then(text => text.includes({"1": "FEQT", "2": "VBAL", "3": "VGRO"}[id])));
      assert.match(await direct.locator("#portfolioStatus").innerText(), /cotations en séance/);
      const rects = await direct.locator("[data-portfolio-id]").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().top));
      assert.deepEqual(rects, [rects[0], rects[0], rects[0]], "All three portfolio buttons stay on one row at 320px");
      assert.equal(await direct.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
    // The shared access survives a public URL and migration of old per-profile state.
    await direct.evaluate(() => {for (const suffix of ["", ":2", ":3"]) localStorage.removeItem("savy:portfolio-profile-state:v1" + suffix);});
    await direct.goto(url);
    await direct.waitForFunction(() => document.querySelector("#portfolioPersonalLink").hidden === false && document.querySelectorAll("#portfolioRows tr").length === 6);
    assert.equal(new URLSearchParams(new URL(direct.url()).hash.slice(1)).get("portfolio-key"), personalKey);
    await direct.locator('[data-portfolio-id="3"]').click();
    await direct.waitForFunction(() => document.querySelector('#portfolioRows tr[data-ticker="MSFTCDR"]'));
    assert.deepEqual(errors, []);
    console.log("Intraday UI verified: live values, macro layout at 320–1440px, three encrypted portfolios, shared access recovery, contributions, daily risk and outage/currency fallback.");
  } finally {await browser.close(); await new Promise(resolve => server.close(resolve));}
}
main().catch(error => {console.error(error); process.exitCode = 1;});
