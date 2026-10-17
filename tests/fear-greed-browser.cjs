"use strict";
const {chromium} = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const root = path.resolve(__dirname, ".."), stamp = new Date().toISOString();
const publication = new Date(Date.now() - 3600000).toISOString();
let mode = "fresh";
const fixture = () => ({schema_version: 1, kind: "cnn_fear_and_greed", provider: "cnn", generated_at: stamp,
  score: mode === "zero" ? 0 : 18, rating: "extreme fear", previous_close: 32,
  timestamp: mode === "future" ? new Date(Date.now() + 3600000).toISOString() : publication,
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
    const page = await browser.newPage({viewport: {width: 1440, height: 1000}}), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("https://**", route => route.abort());
    const url = "http://127.0.0.1:" + server.address().port;
    await page.goto(url);
    await page.waitForFunction(() => document.getElementById("fearGreedValue").textContent === "18");
    assert.equal(await page.locator("#fearGreedRating").innerText(), "Peur extrême");
    assert.equal(await page.getByRole("meter", {name: "Fear & Greed Index de CNN"}).getAttribute("aria-valuenow"), "18");
    assert.equal(await page.locator("#fearGreed a").getAttribute("href"), "https://www.cnn.com/markets/fear-and-greed");
    assert.equal(await page.locator("#fearGreed").evaluate(node => node.previousElementSibling.id === "kpis" && node.nextElementSibling.classList.contains("policy-odds")), true);
    mode = "zero"; await page.locator("#refreshButton").click();
    await page.waitForFunction(() => document.getElementById("fearGreedValue").textContent === "0");
    assert.equal(await page.locator("#fearGreedMeter").getAttribute("aria-valuenow"), "0");
    mode = "future"; await page.locator("#refreshButton").click();
    await page.waitForFunction(() => document.getElementById("fearGreedStatus").textContent.includes("conservée"));
    assert.equal(await page.locator("#fearGreedValue").innerText(), "0");
    mode = "offline"; await page.reload();
    await page.waitForFunction(() => document.getElementById("fearGreedStatus").textContent.includes("conservée"));
    assert.equal(await page.locator("#fearGreedValue").innerText(), "0");
    for (const width of [375, 320]) {
      await page.setViewportSize({width, height: 1000});
      for (let theme = 0; theme < 2; theme++) {
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.equal(await page.locator("#fearGreedChart").isVisible(), true);
        await page.locator("#themeToggle").click();
      }
    }
    const fresh = await browser.newPage(); await fresh.route("https://**", route => route.abort());
    fresh.on("pageerror", error => errors.push(error.message)); await fresh.goto(url);
    await fresh.waitForFunction(() => document.getElementById("fearGreedRating").textContent === "Indisponible");
    assert.equal(await fresh.locator("#fearGreedValue").innerText(), "—");
    assert.equal(await fresh.locator("#fearGreedChart").isVisible(), false);
    assert.deepEqual(errors, []);
    console.log("CNN sentiment verified: correct header position, value, rating, source, zero score, future rejection, cached outage, unavailable state, dark/light and 320/375px layouts.");
  } finally {await browser.close();}
}
main().catch(error => {console.error(error); process.exitCode = 1;}).finally(() => server.close());
