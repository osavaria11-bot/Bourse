"use strict";
const {chromium} = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const root = path.resolve(__dirname, "..");
const U = require("../js/macro-utils.js");
const markets = JSON.parse(fs.readFileSync(path.join(root, "data/market-indices.json"), "utf8"));
const mime = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png"};
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname === "/data/intraday-quotes.json") {response.writeHead(503); response.end("{}"); return;}
  const filename = path.resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
  if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {response.writeHead(404); response.end(); return;}
  response.writeHead(200, {"Content-Type": mime[path.extname(filename)] || "application/octet-stream"});
  fs.createReadStream(filename).pipe(response);
});
async function main() {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.route("https://**", route => route.abort());
    await page.goto("http://127.0.0.1:" + server.address().port);
    await page.waitForFunction(() => document.querySelectorAll("#marketGrid svg").length === 6 && document.querySelectorAll(".news-section").length >= 1);
    const feqtCard = page.locator('.market-card[data-id="FEQT"]');
    assert.match(await feqtCard.locator("h4").innerText(), /FEQT.*Fidelity/);
    assert.match(await feqtCard.locator(".market-value").innerText(), /\$ CA/);
    const headlines = await page.locator(".news-section h3").count();
    assert.ok(headlines <= 6);
    assert.equal(await page.locator(".news-section .meta a").count(), headlines);
    assert.equal(await page.locator(".odds-card").count(), 2);
    const marketRanges = page.getByRole("group", {name: "Période des indices boursiers"});
    assert.equal(await marketRanges.getByRole("button").count(), 9);
    for (const range of U.MARKET_RANGES) {
      await marketRanges.getByRole("button", {name: range.label, exact: true}).click();
      assert.equal(await marketRanges.getByRole("button", {name: range.label, exact: true}).getAttribute("aria-pressed"), "true");
      for (const point of markets.series) {
        const period = U.marketPeriod(point, range.key);
        const insufficient = point.id === "FEQT" && ["5Y", "10Y"].includes(range.key) && point.history[0][0] > U.rangeStart(point.date, range.key);
        assert.equal(period.incomplete, insufficient, point.id + " " + range.key + " must accurately describe its available history");
        const card = page.locator('.market-card[data-id="' + point.id + '"]');
        const expected = insufficient ? "Rendement indisponible · " + range.label : (period.percent > 0 ? "+" : "") + U.formatNumber(period.percent, 2) + " % · " + range.label;
        assert.equal(await card.locator(".market-return").innerText(), expected, point.id + " " + range.key);
        assert.match(await card.locator(".market-period").innerText(), new RegExp("Du " + period.start + " au " + period.end));
      }
    }
    await marketRanges.getByRole("button", {name: "1 semaine", exact: true}).click();
    await page.locator("#marketGrid svg").first().focus();
    assert.match(await page.locator("#marketGrid .chart-tooltip").first().innerText(), /% depuis le/);
    assert.equal(await page.locator("#marketGrid path").evaluateAll(nodes => nodes.some(node => /NaN|Infinity/.test(node.getAttribute("d")))), false);
    console.log("Published data verified:", headlines, "sourced news stories, 2 policy odds cards, 6 actual market histories and all 9 period selections.");
    if (process.env.SCREENSHOT_LOGS) {
      console.log("SCREENSHOT_MARKETS_DESKTOP " + (await page.locator(".market-section").screenshot()).toString("base64"));
    }
    await page.setViewportSize({width: 375, height: 1000});
    await page.locator("#marketTitle").scrollIntoViewIfNeeded();
    await marketRanges.getByRole("button", {name: "1 jour", exact: true}).click();
    assert.equal(await marketRanges.getByRole("button", {name: "1 jour", exact: true}).getAttribute("aria-pressed"), "true");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (process.env.SCREENSHOT_LOGS) console.log("SCREENSHOT_MARKETS_MOBILE " + (await page.screenshot()).toString("base64"));
    assert.deepEqual(errors, []);
  } finally {await browser.close();}
}
main().catch(error => {console.error(error); process.exitCode = 1;}).finally(() => server.close());
