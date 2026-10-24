"use strict";
const {componentPage} = require("./portal-navigation.cjs");
const {chromium} = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const root = path.resolve(__dirname, ".."), stamp = new Date().toISOString();
const publication = new Date(Date.now() - 3600000).toISOString();
const U = require("../js/macro-utils.js");
const history = Array.from({length: 366}, (_, index) => [
  new Date(Date.parse(publication.slice(0, 10) + "T00:00:00Z") - (365 - index) * 86400000).toISOString().slice(0, 10), (index * 7) % 101]);
let mode = "fresh";
const fixture = () => ({schema_version: 1, kind: "cnn_fear_and_greed", provider: "cnn", generated_at: stamp,
  score: mode === "zero" ? 0 : 18, rating: "extreme fear", previous_close: 32,
  timestamp: mode === "future" ? new Date(Date.now() + 3600000).toISOString() : publication,
  history: mode === "nohistory" ? [] : history, history_status: "fresh",
  fetch_status: "fresh", last_successful_fetch: stamp});
const mime = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json"};
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/data/fear-greed.json") {
    res.writeHead(mode === "offline" ? 503 : 200, {"Content-Type": "application/json"});
    res.end(JSON.stringify(fixture())); return;
  }
  const file = path.resolve(root, "." + (url.pathname === "/" ? "/index.html" : url.pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {res.writeHead(404);res.end();return;}
  res.writeHead(200, {"Content-Type": mime[path.extname(file)] || "application/octet-stream"});fs.createReadStream(file).pipe(res);
});
async function main() {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({headless: true});
  try {
    const page = await componentPage(browser,{viewport: {width: 1440, height: 1000}}), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("https://**", route => route.abort());
    const url = "http://127.0.0.1:" + server.address().port;
    await page.goto(url);
    await page.waitForFunction(() => document.getElementById("fearGreedValue").textContent === "18");
    assert.equal(await page.locator("#fearGreedRating").innerText(), "Peur extrême");
    assert.equal(await page.getByRole("meter", {name: "Fear & Greed Index de CNN"}).getAttribute("aria-valuenow"), "18");
    assert.equal(await page.locator("#fearGreed a").getAttribute("href"), "https://www.cnn.com/markets/fear-and-greed");
    assert.equal(await page.locator("#fearGreed").evaluate(node => node.closest("#panel-accueil-overview") !== null), true);
    const overview = await page.locator(".fear-greed-overview").boundingBox(), timeline = await page.locator(".fear-greed-history").boundingBox();
    assert.ok(timeline.x >= overview.x + overview.width, "timeline sits to the right of the gauge on desktop");
    assert.match(await page.locator("#fearGreedHistoryStatus").innerText(), /366 observations/);
    for (const [range, label] of [["1M", "1 mois"], ["3M", "3 mois"], ["1Y", "1 an"]]) {
      await page.locator("#fearGreedRanges").getByRole("button", {name: label, exact: true}).click();
      const chart = page.locator("#fearGreedTimeline svg"), tooltip = page.locator(".fear-history-tooltip");
      assert.equal(await page.locator('#fearGreedRanges [data-range="' + range + '"]').getAttribute("aria-pressed"), "true");
      assert.equal(await chart.locator("path").evaluateAll(nodes => nodes.some(node => /NaN|Infinity/.test(node.getAttribute("d")))), false);
      const rows = history.filter(row => row[0] >= U.rangeStart(history.at(-1)[0], range));
      assert.ok((await page.locator("#fearGreedHistoryStatus").innerText()).includes(rows.length + " observations"));
      await chart.focus(); await chart.press("End");
      assert.equal(await tooltip.innerText(), U.observationLabel(history.at(-1)[0]) + " · 18,0 / 100");
      await chart.press("Home");
      assert.equal(await tooltip.innerText(), U.observationLabel(rows[0][0]) + " · " + U.formatNumber(rows[0][1], 1) + " / 100");
      await chart.press("ArrowRight");
      assert.ok((await tooltip.innerText()).includes(U.observationLabel(rows[1][0])));
      const box = await chart.boundingBox(); await page.mouse.move(box.x + box.width - 10, box.y + box.height / 2);
      assert.equal(await tooltip.innerText(), U.observationLabel(history.at(-1)[0]) + " · 18,0 / 100");
    }
    mode = "zero"; await page.locator("#refreshButton").click();
    await page.waitForFunction(() => document.getElementById("fearGreedValue").textContent === "0");
    assert.equal(await page.locator("#fearGreedMeter").getAttribute("aria-valuenow"), "0");
    mode = "future"; await page.locator("#refreshButton").click();
    await page.waitForFunction(() => document.getElementById("fearGreedStatus").textContent.includes("conservée"));
    assert.equal(await page.locator("#fearGreedValue").innerText(), "0");
    await page.locator("#fearGreedTimeline svg").focus(); await page.locator("#fearGreedTimeline svg").press("End");
    assert.match(await page.locator(".fear-history-tooltip").innerText(), /0,0 \/ 100/);
    mode = "offline"; await page.reload();
    await page.waitForFunction(() => document.getElementById("fearGreedStatus").textContent.includes("conservée"));
    assert.equal(await page.locator("#fearGreedValue").innerText(), "0");
    for (const width of [375, 320]) {
      await page.setViewportSize({width, height: 1000});
      for (const theme of ["petrol", "light", "dark"]) {
        await page.locator('[data-theme-choice="' + theme + '"]').click();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.equal(await page.locator("#fearGreedChart").isVisible(), true);
        assert.equal(await page.locator("#fearGreedTimeline svg").isVisible(), true);
        const upper = await page.locator(".fear-greed-overview").boundingBox(), lower = await page.locator(".fear-greed-history").boundingBox();
        assert.ok(lower.y >= upper.y + upper.height, "timeline stacks below the gauge on mobile");
      }
    }
    const fresh = await componentPage(browser,); await fresh.route("https://**", route => route.abort());
    fresh.on("pageerror", error => errors.push(error.message)); await fresh.goto(url);
    await fresh.waitForFunction(() => document.getElementById("fearGreedRating").textContent === "Indisponible");
    assert.equal(await fresh.locator("#fearGreedValue").innerText(), "—");
    assert.equal(await fresh.locator("#fearGreedChart").isVisible(), false);
    assert.equal(await fresh.locator("#fearGreedTimeline svg").count(), 0);
    mode = "nohistory";
    const noHistory = await componentPage(browser,); await noHistory.route("https://**", route => route.abort()); await noHistory.goto(url);
    await noHistory.waitForFunction(() => document.getElementById("fearGreedValue").textContent === "18");
    assert.equal(await noHistory.locator("#fearGreedTimeline svg").count(), 0);
    assert.match(await noHistory.locator("#fearGreedTimeline").innerText(), /Historique CNN indisponible/);
    mode = "fresh";
    const touch = await componentPage(browser,{viewport: {width: 375, height: 1000}, hasTouch: true});
    await touch.route("https://**", route => route.abort()); await touch.goto(url);
    await touch.locator("#fearGreedTimeline svg").waitFor({state: "visible"});
    await touch.locator("#fearGreedTimeline svg").scrollIntoViewIfNeeded();
    const touchChart = await touch.locator("#fearGreedTimeline svg").boundingBox();
    await touch.touchscreen.tap(touchChart.x + touchChart.width / 2, touchChart.y + touchChart.height / 2);
    assert.equal(await touch.locator(".fear-history-tooltip").isVisible(), true);
    assert.deepEqual(errors, []);
    console.log("CNN sentiment verified: timeline at the right, three actual date ranges, pointer/keyboard/touch readings, exact latest score, cached outage, unavailable history and dark/light 320/375px layouts.");
  } finally {await browser.close();}
}
main().catch(error => {console.error(error); process.exitCode = 1;}).finally(() => server.close());
