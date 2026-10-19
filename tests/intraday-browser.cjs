"use strict";
const {componentPage} = require("./portal-navigation.cjs");
const assert = require("node:assert/strict"), fs = require("node:fs"), http = require("node:http"), path = require("node:path");
const {chromium} = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const U = require("../js/macro-utils.js"), P = require("../js/portfolio-utils.js");
const A = require("../js/portfolio-profile-utils.js"), crypto = require("node:crypto");
const root = path.resolve(__dirname, ".."), load = file => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const prices = P.normalizePrices(load("data/security-prices.json"), load("data/securities.json"));
// Keep the synthetic 55-minute-old trade within the simulated trading day, even around midnight.
const day = new Intl.DateTimeFormat("en-CA", {timeZone: "America/Toronto"}).format(Date.now()), now = Date.parse(day + "T17:00:00Z");
const holdings = [{ticker: "AAPL", currency: "USD", quantity: 2, average_cost: 100}, {ticker: "SHOP", currency: "CAD", quantity: 1, average_cost: 50}];
const apple = prices.series.find(p => p.id === "AAPL").value, shop = prices.series.find(p => p.id === "SHOP").value;
const spx = load("data/market-indices.json").series.find(p => p.id === "SPX");
const catalogue = load("data/securities.json");
const profiles = {"1": holdings, "2": ["VBAL", "FCIN", "XSP", "CGL", "XLF", "XIG"],
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
  exchange_timezone: "America/Toronto", market_state: "regular", fetch_status: "fresh", session_end: new Date(now + 3600000).toISOString(),
  intraday_history: [15, 10, 5, 1].map((minutes, i) => [new Date(now - minutes * 60000).toISOString(), price * (.96 + i * .04 / 3)])};}
let wrongCurrency = false, unavailable = false, staleMacro = false;
const snapshot = {schema_version: 1, kind: "intraday_quotes", generated_at: new Date(now).toISOString(), quotes: [
  q("AAPL", "AAPL", "USD", apple * 1.1), q("SHOP", "SHOP.TO", "CAD", shop * 1.05),
  q("SPX", "^GSPC", "USD", spx.value * 1.01), q("FEQT", "FEQT.NE", "CAD", prices.series.find(p => p.id === "FEQT").value * 1.02),
  q("VIXCLS", "^VIX", "USD", 25.5), q("NASDAQXAU", "^XAU", "USD", 282.5), q("VXEEMCLS", "^VXEEM", "USD", 21.5),
  q("UST10Y", "^TNX", "USD", 5.1), q("WTIFUT", "CL=F", "USD", 95), q("DXY", "DX-Y.NYB", "USD", 100.2),
  ...[...new Set([...profiles["2"], ...profiles["3"]].map(p => p.ticker))].map(id => {
    const point = prices.series.find(p => p.id === id);
    const quote = q(id, point.quote_symbol, point.currency, point.value * 1.03);
    // Reproduce the real VBAL failure: XIG has a dated last trade,
    // but the provider supplies no five-minute candles.
    if (id === "XIG") {
      quote.intraday_history = [];
      quote.timestamp = new Date(now - 55 * 60000).toISOString();
    }
    return quote;
  }),
  q("VGRO", "VGRO.TO", "CAD", prices.series.find(p => p.id === "VGRO").value * 1.02),
  {...q("USDCAD", "CAD=X", "CAD", 1.4), intraday_history: [[new Date(now - 60 * 60000).toISOString(), 1.4],
    ...q("USDCAD", "CAD=X", "CAD", 1.4).intraday_history]}
]};
const types = {".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".png": "image/png"};
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  const profileId = pathname === "/data/personal-portfolio.json" ? "1" : pathname.match(/^\/data\/personal-portfolio-([23])\.json$/)?.[1];
  if (profileId) {response.writeHead(200, {"Content-Type": "application/json"}); response.end(JSON.stringify(encryptedProfiles[profileId])); return;}
  if (pathname === "/data/intraday-quotes.json") {
    const data = structuredClone(snapshot); if (wrongCurrency) data.quotes[0].currency = "CAD";
    if (staleMacro) for (const row of data.quotes) if (["DXY", "WTIFUT", "UST10Y", "VIXCLS"].includes(row.id)) row.fetch_status = "cached";
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
    await context.addInitScript(({positions, timestamp, testNow}) => {
      Date.now = () => testNow;
      if (positions) localStorage.setItem("savy:private-holdings:v1", JSON.stringify({schema_version: 1, positions}));
      if (!localStorage.getItem("savy:preferences:v2")) localStorage.setItem("savy:preferences:v2", JSON.stringify({sort: "name"}));
      for (const suffix of ["", ":2", ":3"]) {
        const key = "savy:portfolio-view:v1" + suffix;
        if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({range: "YTD"}));
      }
      const originalFetch = window.fetch.bind(window);
      window.fetch = (input, init) => String(input?.url || input).startsWith("https://biquote.io/api/USDCAD") ?
        Promise.resolve(new Response(JSON.stringify({symbol: "USDCAD", mid: 1.4, timestamp, marketState: "open"}),
          {status: 200, headers: {"Content-Type": "application/json"}})) : originalFetch(input, init);
    }, {positions, timestamp: new Date(now).toISOString(), testNow: now});
    return context;
  }
  async function checkMacroBounds(page, width) {
    await page.setViewportSize({width, height: 1000});
    await page.locator("#kpis").scrollIntoViewIfNeeded();
    const overflow = await page.locator("#kpis .kpi, #grid .indicator-card").evaluateAll(cards => cards.flatMap(card => {
      const bounds = card.getBoundingClientRect();
      return [...card.querySelectorAll(".kpi-value,.current-value,.change,.meta,.live-companion,a,button")].filter(node => {
        const r = node.getBoundingClientRect(); return r.width && (r.left < bounds.left - 1 || r.right > bounds.right + 1 || node.scrollWidth > node.clientWidth + 1);
      }).map(node => card.dataset.id + ": " + node.className);
    }));
    assert.deepEqual(overflow, [], "Macro content must fit each card at " + width + "px");
    const offsets = await page.locator("#kpis .kpi").evaluateAll(cards => cards.map(card =>
      card.querySelector(".kpi-value").getBoundingClientRect().top - card.getBoundingClientRect().top));
    assert.ok(Math.max(...offsets) - Math.min(...offsets) < 1, "Summary values must align below their labels at " + width + "px: " + JSON.stringify(offsets));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.locator("#grid").scrollIntoViewIfNeeded();
    for (const id of await page.locator(".indicator-card").evaluateAll(cards => cards.map(card => card.dataset.id))) {
      await page.locator('.indicator-card[data-id="' + id + '"]').scrollIntoViewIfNeeded();
      const overflow = await page.locator('.indicator-card[data-id="' + id + '"]').evaluate(card => {
        const bounds = card.getBoundingClientRect();
        return [...card.querySelectorAll(".current-value,.change,.meta,a,button")].filter(node => {
          const r = node.getBoundingClientRect(); return r.width && (r.left < bounds.left - 1 || r.right > bounds.right + 1 || node.scrollWidth > node.clientWidth + 1);
        }).map(node => node.className);
      });
      assert.deepEqual(overflow, [], id + " must fit its selected chart at " + width);
    }
  }
  try {
    const context = await liveContext({viewport: {width: 1440, height: 1000}}, holdings);
    const page = await componentPage(context,), errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.route("https://**", route => route.request().url().startsWith("https://biquote.io/api/USDCAD") ?
      route.fulfill({status: 200, contentType: "application/json", headers: {"Access-Control-Allow-Origin": "*"}, body: JSON.stringify({symbol: "USDCAD", mid: 1.4, timestamp: new Date(now).toISOString(), marketState: "open"})}) : route.abort());
    await page.goto(url); await page.waitForFunction(() => document.querySelector("#refreshButton").disabled === false && document.querySelectorAll("#portfolioRows tr").length === 2);
    assert.equal(await page.locator("#sortSelect").inputValue(), "recent", "An old saved sort cannot override the recent-first opening order");
    await page.waitForFunction(() => document.querySelector("#grid .indicator-card")?.dataset.id === "DEXCAUS");
    assert.equal(await page.locator('#marketRanges [data-range="INTRADAY"]').getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator('#portfolioRanges [data-range="INTRADAY"]').getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator("#portfolioChart .chart-benchmark").count(), 1);
    const money = value => new Intl.NumberFormat("fr-CA", {style: "currency", currency: "CAD", maximumFractionDigits: 2}).format(value);
    await page.locator('#portfolioHeatmap').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelectorAll('#portfolioHeatmapTiles button').length === 2);
    assert.equal(await page.locator("#portfolioValue").innerText(), money(2 * apple * 1.1 * 1.4 + shop * 1.05));
    assert.match(await page.locator("#portfolioStatus").innerText(), /2\/2 cotations en séance/);
    await page.locator("#portfolioPositionsToggle").click();
    assert.match(await page.locator('#portfolioRows tr[data-ticker="AAPL"] td').nth(3).innerText(), /En séance/);
    assert.equal(await page.locator('#portfolioRows tr[data-ticker="AAPL"] .position-day-change').innerText(), '+10,00%');
    assert.match(await page.locator('#portfolioHeatmapTiles button[data-ticker="AAPL"]').getAttribute('aria-label'), /\+10,00 %/);
    await page.locator('#portfolioHeatmapPosition').selectOption('AAPL');
    assert.ok((await page.locator('#portfolioHeatmapDetail').innerText()).includes(money(2 * apple * 1.1 * 1.4)));
    assert.ok((await page.locator('#portfolioRows tr[data-ticker="AAPL"] .position-day-change').getAttribute('class')).includes('up'));
    const shopQuote = snapshot.quotes.find(q => q.id === 'SHOP'), shopBase = shopQuote.previous_close;
    shopQuote.previous_close = shopQuote.price * 1.06; await page.evaluate(() => window.SavyLiveQuotes.refresh());
    assert.equal(await page.locator('#portfolioRows tr[data-ticker="SHOP"] .position-day-change').innerText(), '-5,66%');
    assert.match(await page.locator('#portfolioHeatmapTiles button[data-ticker="SHOP"]').getAttribute('aria-label'), /-5,66 %/);
    assert.ok((await page.locator('#portfolioRows tr[data-ticker="SHOP"] .position-day-change').getAttribute('class')).includes('down'));
    shopQuote.previous_close = shopQuote.price; await page.evaluate(() => window.SavyLiveQuotes.refresh());
    assert.equal(await page.locator('#portfolioRows tr[data-ticker="SHOP"] .position-day-change').innerText(), '0,00%');
    assert.match(await page.locator('#portfolioHeatmapTiles button[data-ticker="SHOP"]').getAttribute('aria-label'), /0,00 %/);
    shopQuote.previous_close = shopBase; await page.evaluate(() => window.SavyLiveQuotes.refresh());
    assert.match(await page.locator('.indicator-card[data-id="VIXCLS"] .current-value').innerText(), /25,50/);
    for (const [id, title, value] of [["DCOILWTICO", "WTI · contrat à terme", "95,00"], ["DTWEXBGS", "DXY (six devises)", "100,20"], ["DGS10", "10 ans (indice TNX)", "5,10"]]) {
      const card = page.locator('.indicator-card[data-id="' + id + '"]');
      assert.ok((await card.locator("h3").innerText()).includes(title));
      assert.ok((await card.locator(".current-value").innerText()).includes(value));
      assert.equal(await card.locator(".live-companion").count(), 0);
    }
    assert.equal(await page.locator('#kpis [data-id="DGS10"] .kpi-value').innerText(), "5,10 %");
    const emergingQuote = snapshot.quotes.find(row => row.id === "VXEEMCLS"), originalEmerging = structuredClone(emergingQuote);
    const publishedEmerging = load("data/macro-data.json").series.find(row => row.id === "VXEEMCLS");
    const oldEmergingDay = new Date(Date.parse(publishedEmerging.date) - 86400000).toISOString().slice(0, 10);
    Object.assign(emergingQuote, {timestamp: oldEmergingDay + "T14:00:00Z", session_date: oldEmergingDay, market_state: "closed", intraday_history: []});
    // A fresh browser has no newer cached quote that the client must preserve.
    const olderQuoteContext = await liveContext({viewport: {width: 1440, height: 1000}}), olderQuotePage = await componentPage(olderQuoteContext,);
    olderQuotePage.on("pageerror", error => errors.push(error.message)); await olderQuotePage.route("https://**", route => route.abort());
    await olderQuotePage.goto(url); await olderQuotePage.waitForFunction(() => !document.querySelector("#refreshButton").disabled);
    const emergingCard = olderQuotePage.locator('.indicator-card[data-id="VXEEMCLS"]');
    assert.equal(await emergingCard.locator(".current-value").innerText(), U.formatNumber(publishedEmerging.value, publishedEmerging.decimals) + " " + publishedEmerging.unit,
      "A freshly checked but older Yahoo quote cannot hide a newer official VXEEM observation");
    assert.match(await emergingCard.locator(".publication-fallback").innerText(), /FRED/);
    await olderQuoteContext.close();
    Object.assign(emergingQuote, originalEmerging); await page.evaluate(() => window.SavyLiveQuotes.refresh());
    const dollar = page.locator('.indicator-card[data-id="DTWEXBGS"]');
    await dollar.locator(".detail-button").click();
    assert.equal(await page.locator("#detailValue").innerText(), "100,20 points");
    staleMacro = true; await page.evaluate(() => window.SavyLiveQuotes.refresh());
    assert.equal(await dollar.locator(".current-value").innerText(), "100,20 points");
    assert.match(await dollar.locator(".quote-meta").innerText(), /Cotation conservée/);
    assert.equal(await page.locator("#detailValue").innerText(), "100,20 points");
    assert.equal(await page.locator('#kpis [data-id="DGS10"] .kpi-value').innerText(), "5,10 %");
    assert.match(await page.locator('#kpis [data-id="DGS10"]').innerText(), /Cotation conservée/);
    await page.locator("#closeDialog").click(); staleMacro = false; await page.evaluate(() => window.SavyLiveQuotes.refresh());
    await page.locator("#marketRanges").getByRole("button", {name: "1 jour", exact: true}).click();
    assert.match(await page.locator('.market-card[data-id="SPX"] .meta').first().innerText(), /En séance/);
    const actualReturn = await page.locator('.market-card[data-id="SPX"] .market-return').innerText();
    const base = spx.date === day ? spx.history.at(-2)[1] : spx.value;
    const expected = (spx.value * 1.01 / base - 1) * 100;
    assert.equal(actualReturn, (expected > 0 ? "+" : "") + U.formatNumber(expected, 2) + " % · 1 jour");
    await page.locator('#marketRanges [data-range="INTRADAY"]').click();
    const marketCurve = page.locator('.market-card[data-id="SPX"]');
    assert.ok((await marketCurve.locator(".chart-line").getAttribute("d")).split("L").length >= 3);
    await marketCurve.locator("svg").focus(); await page.keyboard.press("End");
    assert.match(await marketCurve.locator(".chart-tooltip").innerText(), /heure de Montréal.*clôture précédente/);
    assert.match(await marketCurve.locator(".chart-axis").last().textContent(), /h/);
    await page.locator('#portfolioRanges [data-range="INTRADAY"]').click();
    assert.match(await page.locator("#portfolioPeriod").innerText(), /Intraday.*heure de Montréal/);
    assert.equal(await page.locator("#portfolioChart .chart-benchmark").count(), 1);
    assert.equal(await page.locator('#portfolioRelativeChart svg').count(), 1);
    const intradayValue = await page.locator("#portfolioValue").innerText();
    assert.equal(intradayValue, money(2 * apple * 1.1 * 1.4 + shop * 1.05));
    assert.match(await page.locator("#portfolioRiskStatus").innerText(), /clôtures quotidiennes/);
    await page.locator("#portfolioRisk").scrollIntoViewIfNeeded();
    assert.equal(await page.locator("#portfolioRisk .table-wrap").isVisible(), false, "Intraday risk must explain the period choice without a table of N/D");
    await page.locator('#portfolioRanges [data-range="YTD"]').click();
    assert.ok(await page.locator("#portfolioContributionRows tr").count() === 2);
    assert.match(await page.locator("#portfolioRiskStatus").innerText(), /séances communes|assez de clôtures/);
    assert.equal(await page.locator("#portfolioRisk .table-wrap").isVisible(), true);
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
      for (const [name, selector] of [["KPIS", "#kpis"], ["FX", '.indicator-card[data-id="DEXCAUS"]'], ["WTI", '.indicator-card[data-id="DCOILWTICO"]'], ["DXY", '.indicator-card[data-id="DTWEXBGS"]'], ["INTRADAY_INDEX", '.market-card[data-id="SPX"]']])
        console.log("SCREENSHOT_LIVE_MACRO_MOBILE_" + name + " " + (await page.locator(selector).screenshot()).toString("base64"));
    }
    await page.locator("#portfolio").scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    for (const id of ["2", "3"]) {
      await page.locator('[data-portfolio-id="' + id + '"]').click();
      assert.match(await page.locator("#portfolioStatus").innerText(), new RegExp("Portefeuille " + id + ".*lien personnel"));
      assert.equal(await page.locator("#portfolioContent").isVisible(), false);
    }
    const directContext = await liveContext({viewport: {width: 320, height: 1000}}), direct = await componentPage(directContext,);
    direct.on("pageerror", error => errors.push(error.message)); await direct.route("https://**", route => route.abort());
    await direct.goto(A.personalURL(url, personalKey));
    await direct.waitForFunction(() => document.querySelectorAll("#portfolioRows tr").length === 2 && document.querySelector("#portfolioPersonalLink").hidden === false);
    assert.ok((await direct.locator('.indicator-card[data-id="DEXCAUS"] .current-value').innerText()).includes("1,40"), "USD/CAD uses the collected quote when biquote cannot be reached");
    for (const id of ["2", "3", "1", "3", "2"]) {
      await direct.locator('[data-portfolio-id="' + id + '"]').click();
      await direct.waitForFunction(id => JSON.parse(localStorage.getItem("savy:portfolio-active:v1")) === id &&
        JSON.parse(localStorage.getItem("savy:portfolio-profile-state:v1" + (id === "1" ? "" : ":" + id)))?.revision === "synthetic-live-v1" &&
        document.querySelector("#portfolioContent").hidden === false, id);
      assert.deepEqual(await direct.evaluate(id => JSON.parse(localStorage.getItem("savy:private-holdings:v1" + (id === "1" ? "" : ":" + id))).positions, id), profiles[id]);
      assert.equal(await direct.locator('[data-portfolio-id="' + id + '"]').getAttribute("aria-pressed"), "true");
      assert.ok(await direct.locator("#portfolioBenchmark").innerText().then(text => text.includes({"1": "FEQT", "2": "VBAL", "3": "VGRO"}[id])));
      assert.match(await direct.locator("#portfolioStatus").innerText(), /cotations en séance/);
      assert.equal(await direct.locator('#portfolioRanges [data-range="INTRADAY"]').getAttribute("aria-pressed"), "true",
        "Each portfolio opens on Intraday, including a portfolio previously viewed in YTD");
      assert.match(await direct.locator("#portfolioPeriod").innerText(), /Intraday · séance/);
      assert.equal(await direct.locator("#portfolioChart svg").count(), 1);
      assert.equal(await direct.locator("#portfolioChart .chart-benchmark").count(), 1);
      if (id === "2") {
        assert.deepEqual(await direct.evaluate(() => window.SavyLiveQuotes.dataset().quotes.find(q => q.id === "XIG").intraday_history),
          [[new Date(now - 55 * 60000).toISOString(), snapshot.quotes.find(q => q.id === "XIG").price]],
          "The VBAL curve uses XIG's actual trade without inventing candle points");
        assert.doesNotMatch(await direct.locator("#portfolioPeriod").innerText(), /actualisation en attente/,
          "An older XIG trade must not report a stopped provider refresh");
        assert.match(await direct.locator("#portfolioStatus").innerText(), /derniers cours plus anciens pour XIG/);
        assert.equal(await direct.locator("#portfolioValueLabel").innerText(), "VALEUR DES TITRES · CAD");
        assert.match(await direct.locator('#portfolioRows tr[data-ticker="XIG"] .portfolio-quote').getAttribute("title"), /Cours daté du.*source consultée le/);
      }
      assert.equal(await direct.locator('#portfolioRelativeTitle').innerText(), 'Écart avec ' + {'1':'FEQT','2':'VBAL','3':'VGRO'}[id]);
      const relative = direct.locator('#portfolioRelativeChart svg');
      assert.equal((await relative.boundingBox()).height, 128);
      await relative.focus(); await relative.press('End');
      assert.ok((await direct.locator('#portfolioRelativeChart .chart-tooltip').innerText()).includes('écart ' + await direct.locator('#portfolioRelativeValue').innerText()));
      assert.equal(await direct.locator('#portfolioRows .position-day-change').count(), profiles[id].length);
      await direct.locator('#portfolioHeatmap').scrollIntoViewIfNeeded();
      await direct.waitForFunction(expected => document.querySelectorAll('#portfolioHeatmapTiles button').length === expected, profiles[id].length);
      assert.equal(await direct.locator('#portfolioHeatmapTiles button').count(), profiles[id].length);
      assert.equal(await direct.locator('#portfolioHeatmapTitle').innerText(), 'Heatmap · portefeuille ' + id);
      const value = await direct.locator("#portfolioValue").innerText();
      await direct.locator("#portfolioChart svg").focus(); await direct.keyboard.press("End");
      assert.ok((await direct.locator("#portfolioChart .chart-tooltip").innerText()).includes(value), "Chart and headline value agree in portfolio " + id);
      if (process.env.MACRO_SCREENSHOT_LOGS && id === "3") console.log("SCREENSHOT_INTRADAY_PORTFOLIO3 " + (await direct.locator("#portfolioChart").screenshot()).toString("base64"));
      await direct.locator('#portfolioRanges [data-range="YTD"]').click();
      const rects = await direct.locator("[data-portfolio-id]").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().top));
      assert.deepEqual(rects, [rects[0], rects[0], rects[0]], "All three portfolio buttons stay on one row at 320px");
      assert.equal(await direct.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
    // The shared access survives a public URL and migration of old per-profile state.
    await direct.evaluate(() => {for (const suffix of ["", ":2", ":3"]) localStorage.removeItem("savy:portfolio-profile-state:v1" + suffix);});
    await direct.goto(url);
    await direct.waitForFunction(() => document.querySelector("#portfolioPersonalLink").hidden === false && document.querySelectorAll("#portfolioRows tr").length === 6);
    assert.equal(await direct.locator('#marketRanges [data-range="INTRADAY"]').getAttribute("aria-pressed"), "true");
    assert.equal(await direct.locator('#portfolioRanges [data-range="INTRADAY"]').getAttribute("aria-pressed"), "true");
    assert.equal(await direct.locator("#portfolioChart .chart-benchmark").count(), 1);
    assert.equal(new URLSearchParams(new URL(direct.url()).hash.slice(1)).get("portfolio-key"), personalKey);
    await direct.locator('[data-portfolio-id="3"]').click();
    await direct.waitForFunction(() => document.querySelector('#portfolioRows tr[data-ticker="MSFTCDR"]'));
    // Reproduce the production failure after the close: a valid snapshot ages
    // beyond the refresh window while its real observations remain usable.
    await direct.evaluate(time => {Date.now = () => time;}, now + 75 * 60000);
    await direct.evaluate(() => window.SavyLiveQuotes.refresh());
    assert.equal(await direct.locator('.indicator-card[data-id="DTWEXBGS"] .current-value').innerText(), "100,20 points", "A dated quote remains visible when the feed pauses");
    assert.match(await direct.locator('.indicator-card[data-id="DTWEXBGS"] .quote-meta').innerText(), /Cotation conservée/);
    await direct.locator('#marketRanges [data-range="INTRADAY"]').click();
    assert.equal(await direct.locator('.market-card[data-id="SPX"] .chart-line').count(), 1);
    assert.match(await direct.locator('.market-card[data-id="SPX"] .meta').first().innerText(), /Cotation conservée/);
    for (const id of ["1", "2", "3"]) {
      await direct.locator('[data-portfolio-id="' + id + '"]').click();
      await direct.waitForFunction(id => JSON.parse(localStorage.getItem("savy:portfolio-active:v1")) === id &&
        document.querySelectorAll("#portfolioRows tr").length === (id === "1" ? 2 : 6), id);
      await direct.locator('#portfolioRanges [data-range="INTRADAY"]').click();
      assert.equal(await direct.locator("#portfolioChart .chart-line:not(.chart-benchmark)").count(), 1);
      assert.equal(await direct.locator("#portfolioChart .chart-benchmark").count(), 1);
      assert.match(await direct.locator("#portfolioPeriod").innerText(), /actualisation en attente/);
      assert.equal(await direct.locator("#portfolioValueLabel").innerText(), "DERNIÈRE VALEUR COLLECTÉE · CAD");
      await direct.locator('#portfolioRisk').scrollIntoViewIfNeeded();
      assert.equal(await direct.locator("#portfolioRisk .table-wrap").isVisible(), false);
    }
    assert.deepEqual(errors, []);
    console.log("Intraday UI verified: current and explicitly retained macro headlines, older VXEEM quote rejected, after-close refresh pause, minute charts for indices and all three portfolios, 320–1440px layout, contributions, daily risk, shared access and source/currency fallback.");
  } finally {await browser.close(); await new Promise(resolve => server.close(resolve));}
}
main().catch(error => {console.error(error); process.exitCode = 1;});
