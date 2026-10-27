"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const {chromium} = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const root = path.resolve(__dirname, "..");
const day = new Intl.DateTimeFormat("en-CA", {timeZone: "America/Toronto"}).format(Date.now());
const now = Math.max(Date.now(), Date.parse(day + "T17:00:00Z"));
const envelope = (time, price) => ({schema_version: 1, kind: "intraday_quotes", generated_at: new Date(time).toISOString(), quotes:
  [["SPX", "^GSPC"], ["AAPL", "AAPL"]].map(([id, quote_symbol]) => ({id, quote_symbol, currency: "USD", price,
    previous_close: 100, timestamp: new Date(time - 1000).toISOString(), fetched_at: new Date(time).toISOString(),
    exchange_timezone: "America/New_York", session_date: day, market_state: "regular", fetch_status: "fresh",
    session_start: new Date(now - 3600000).toISOString(), session_end: new Date(now + 3600000).toISOString()}))});
const types = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json"};
const server = http.createServer((req, res) => {
  const name = new URL(req.url, "http://localhost").pathname;
  if (name === "/data/intraday-quotes.json") {
    res.writeHead(200, {"Content-Type": "application/json"}); res.end(JSON.stringify(envelope(now - 3600000, 100))); return;
  }
  const file = path.resolve(root, "." + (name === "/" ? "/index.html" : name));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {res.writeHead(404); res.end(); return;}
  res.setHeader("Content-Type", types[path.extname(file)] || "application/octet-stream"); fs.createReadStream(file).pipe(res);
});
async function main() {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({headless: true});
  try {
    const page = await browser.newPage(), errors = []; let unavailable = false, tick = now;
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(time => {Date.now = () => time;}, now);
    await page.route("https://**", route => route.abort());
    await page.route("https://raw.githubusercontent.com/osavaria11-bot/Bourse/savy-live-quotes/intraday-quotes.json?*", route =>
      route.fulfill({status: unavailable ? 503 : 200, contentType: "application/json", headers: {"Access-Control-Allow-Origin": "*"},
        body: unavailable ? "{}" : JSON.stringify(envelope(tick, 200 + (tick - now) / 60000))}));
    await page.goto("http://127.0.0.1:" + server.address().port);
    await page.waitForFunction(() => window.SavyLiveQuotes?.current("SPX")?.price === 200 && document.querySelector('.market-card[data-id="SPX"]'));
    await page.locator('.portal-nav [data-page="marches"]').click();
    await page.locator('#marketSelect').selectOption("SPX");
    const card = page.locator('.market-card[data-id="SPX"]');
    assert.match(await card.innerText(), /200/);
    assert.match(await card.locator('.meta').first().innerText(), /En séance/);
    unavailable = true; await page.evaluate(() => window.SavyLiveQuotes.refresh());
    assert.equal(await page.evaluate(() => window.SavyLiveQuotes.current("SPX").price), 200);
    tick += 300000; unavailable = false;
    await page.evaluate(time => {Date.now = () => time;}, tick);
    await page.evaluate(() => window.SavyLiveQuotes.refresh());
    assert.equal(await page.evaluate(() => window.SavyLiveQuotes.current("SPX").price), 205);
    assert.equal(await page.evaluate(() => window.SavyLiveQuotes.current("AAPL").price), 205);
    assert.match(await card.innerText(), /205/);
    assert.deepEqual(errors, []);
    console.log("Independent browser feed: fresh index and stock, frozen Pages, provider outage and next collection verified.");
  } finally {await browser.close(); await new Promise(resolve => server.close(resolve));}
}
main().catch(error => {console.error(error); process.exitCode = 1; server.close();});
