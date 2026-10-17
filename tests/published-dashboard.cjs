"use strict";
const {chromium} = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const root = path.resolve(__dirname, "..");
const U = require("../js/macro-utils.js");
const F = require("../js/fear-greed-utils.js");
const sentiment = F.normalize(JSON.parse(fs.readFileSync(path.join(root, "data/fear-greed.json"), "utf8")));
const markets = JSON.parse(fs.readFileSync(path.join(root, "data/market-indices.json"), "utf8"));
const macro = U.normalizeDataset(JSON.parse(fs.readFileSync(path.join(root, "data/macro-data.json"), "utf8")));
function expectedBaseline(point, range) {
  const history = point.history.filter(row => row[0] <= point.date);
  const sessions = {"1D": 1, "3D": 3, "1W": 5}[range];
  const requested = range === "YTD" ? (Number(point.date.slice(0, 4)) - 1) + "-12-31" : sessions ? null : U.rangeStart(point.date, range);
  const base = sessions ? history.at(-sessions - 1) : history.filter(row => row[0] <= requested).at(-1);
  return base && U.validNumber(base[1]) && base[1] > 0 &&
    (sessions || Date.parse(requested) - Date.parse(base[0]) <= 7 * 86400000) ? base : null;
}
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
    await page.addInitScript(() => localStorage.setItem("savy:preferences:v2", JSON.stringify({favorites: ["PURANUSDM"]})));
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.route("https://**", route => route.abort());
    await page.goto("http://127.0.0.1:" + server.address().port);
    await page.waitForFunction(() => document.getElementById("fearGreedRating").textContent !== "Chargement…");
    assert.equal(await page.locator("#fearGreedValue").innerText(), U.formatNumber(sentiment.score, 0));
    if (F.validScore(sentiment.score)) {
      assert.equal(await page.locator("#fearGreedRating").innerText(), F.RATINGS[sentiment.rating]);
      assert.equal(await page.locator("#fearGreedMeter").getAttribute("aria-valuenow"), String(sentiment.score));
      if (sentiment.history.length) {
        for (const range of F.RANGES) {
          await page.locator('#fearGreedRanges [data-range="' + range.key + '"]').click();
          const chart = page.locator("#fearGreedTimeline svg"); await chart.focus(); await chart.press("End");
          assert.equal(await page.locator(".fear-history-tooltip").innerText(), U.observationLabel(sentiment.history.at(-1)[0]) + " · " + U.formatNumber(sentiment.score, 1) + " / 100");
          assert.equal(await chart.locator(".fear-history-line").evaluate(node => /NaN|Infinity/.test(node.getAttribute("d"))), false);
        }
      }
    } else {
      assert.equal(await page.locator("#fearGreedRating").innerText(), "Indisponible");
      assert.equal(await page.locator("#fearGreedChart").isVisible(), false);
    }
    await page.waitForSelector('#marketRanges [data-range="INTRADAY"]');
    assert.equal(await page.locator('#marketRanges [data-range="INTRADAY"]').getAttribute("aria-pressed"), "true");
    await page.locator('#marketRanges [data-range="1Y"]').click();
    await page.waitForFunction(() => document.querySelectorAll("#marketGrid svg").length === 6 && document.querySelectorAll(".news-section").length >= 1);
    const feqtCard = page.locator('.market-card[data-id="FEQT"]');
    assert.match(await feqtCard.locator("h4").innerText(), /FEQT.*Fidelity/);
    assert.match(await feqtCard.locator(".market-value").innerText(), /\$ CA/);
    const headlines = await page.locator(".news-section h3").count();
    assert.ok(headlines <= 6);
    assert.equal(await page.locator(".news-section .meta a").count(), headlines);
    assert.equal(await page.locator(".odds-card").count(), 2);
    const marketRanges = page.getByRole("group", {name: "Période des indices boursiers"});
    assert.equal(await marketRanges.getByRole("button").count(), 10);
    for (const range of U.MARKET_RANGES) {
      await marketRanges.getByRole("button", {name: range.label, exact: true}).click();
      assert.equal(await marketRanges.getByRole("button", {name: range.label, exact: true}).getAttribute("aria-pressed"), "true");
      for (const point of markets.series) {
        const period = U.marketPeriod(point, range.key);
        // Missing prices can affect a short period too. Such a period must
        // report N/D without preventing unrelated observations from publishing.
        const baseline = expectedBaseline(point, range.key), insufficient = !baseline;
        assert.equal(period.incomplete, insufficient, point.id + " " + range.key + " must accurately describe its available history");
        if (baseline) assert.ok(Math.abs(period.percent - (point.value / baseline[1] - 1) * 100) < 1e-9);
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
    const affected = ["DGS10", "INDPRO", "VIXCLS", "NASDAQXAU", "VXEEMCLS", "DTWEXBGS", "DCOILWTICO", "URANIUMSPOT"];
    for (const id of affected) {
      const point = macro.series.find(row => row.id === id);
      await page.locator("#searchInput").fill(id);
      const card = page.locator('.indicator-card[data-id="' + id + '"]');
      await card.scrollIntoViewIfNeeded(); await card.locator("svg").waitFor({state: "visible"});
      assert.equal(await card.locator(".current-value").innerText(), U.formatNumber(point.value, point.decimals) + " " + point.unit, id + " keeps its last published observation when live quotes are unavailable");
      assert.ok((await card.locator(".observation-date").innerText()).includes(U.observationLabel(point.date, point.frequency)));
      if (id === "URANIUMSPOT") {
        assert.equal(point.provider, "numerco"); assert.equal(point.frequency, "daily");
        assert.ok(point.history.length > 2000, "uranium uses a real daily history across ten years");
        assert.equal(await card.getByRole("button", {name: /Retirer des favoris/}).getAttribute("aria-pressed"), "true");
        assert.equal(await card.locator(".card-bottom a").getAttribute("href"), "https://numerco.com/UHistory/");
      }
      assert.equal(await card.locator("path.chart-line").evaluate(node => /NaN|Infinity/.test(node.getAttribute("d"))), false);
      await card.locator(".detail-button").click();
      if (id === "URANIUMSPOT") assert.equal(await page.locator("#detailSource").innerText(), "Voir la série originale · Numerco ↗");
      for (const range of U.RANGES) {
        await page.locator('#detailRanges [data-range="' + range.key + '"]').click();
        await page.locator("#detailChart svg").waitFor({state: "visible"});
        const chart = page.locator("#detailChart svg"); await chart.focus(); await chart.press("End");
        assert.ok((await page.locator("#detailChart .chart-tooltip").innerText()).includes(U.formatNumber(point.value, point.decimals)), id + " " + range.key + " reaches its actual last published value");
        assert.equal(await page.locator("#detailChart path.chart-line").evaluate(node => /NaN|Infinity/.test(node.getAttribute("d"))), false);
      }
      await page.locator("#closeDialog").click();
    }
    console.log("Actual macro observations verified: all eight affected cards keep dated published values and usable charts across all five periods when the quote feed is unavailable.");
    assert.deepEqual(errors, []);
  } finally {await browser.close();}
}
main().catch(error => {console.error(error); process.exitCode = 1;}).finally(() => server.close());
