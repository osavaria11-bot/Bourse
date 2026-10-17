"use strict";
const {chromium} = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http"), crypto = require("node:crypto");
const root = path.resolve(__dirname, ".."), original = JSON.parse(fs.readFileSync(path.join(root, "data/weekly-reports.json"), "utf8"));
let mode = "fresh";
function fixture() {
  const data = structuredClone(original);
  if (mode === "invalid") data.reports.stocks.document.path = "javascript:alert(1)";
  if (mode === "older") {
    const day = new Date(Date.parse(data.reports.stocks.edition_date + "T00:00:00Z") - 7 * 86400000).toISOString().slice(0,10);
    data.reports.stocks.edition_date = day; data.reports.stocks.reference_date = day; data.reports.stocks.document.path = "reports/stocks/" + day + ".pdf";
  }
  return data;
}
const mime = {".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".json":"application/json", ".pdf":"application/pdf"};
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/data/weekly-reports.json") {
    res.writeHead(mode === "offline" ? 503 : 200, {"Content-Type":"application/json"}); res.end(JSON.stringify(fixture())); return;
  }
  const filename = path.resolve(root, "." + (url.pathname === "/" ? "/index.html" : url.pathname));
  if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {res.writeHead(404); res.end(); return;}
  res.writeHead(200, {"Content-Type":mime[path.extname(filename)] || "application/octet-stream"}); fs.createReadStream(filename).pipe(res);
});
async function main() {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:1000}}), errors = [];
    page.on("pageerror", error => errors.push(error.message)); await page.route("https://**", route => route.abort());
    const url = "http://127.0.0.1:" + server.address().port;
    await page.goto(url + "/#weeklyReports");
    await page.waitForFunction(() => document.querySelectorAll(".weekly-report-document a").length === 2);
    assert.equal(await page.locator("#weeklyReports").evaluate(node => node.previousElementSibling.classList.contains("resources") && node.nextElementSibling.tagName === "FOOTER"), true);
    assert.deepEqual(await page.locator(".weekly-stock").evaluateAll(nodes => nodes.map(node => node.dataset.ticker)), original.reports.stocks.stocks.map(row=>row.ticker));
    assert.ok((await page.locator('[data-report-kind="stocks"] .weekly-report-count').innerText()).includes(original.reports.stocks.stocks.length ? original.reports.stocks.stocks.length + " titre" : "Aucun titre"));
    if (original.reports.real_estate.document_scope === "summary") assert.match(await page.locator('[data-report-kind="real_estate"] .weekly-report-document').innerText(), /synthèse/);
    for (const [kind, report] of Object.entries(original.reports)) {
      const card = page.locator('[data-report-kind="' + kind + '"]'), link = card.locator(".weekly-report-document a");
      assert.equal(await card.locator("time").getAttribute("datetime"), report.edition_date);
      assert.equal(await link.getAttribute("href"), report.document.path); assert.equal(await link.getAttribute("target"), "_blank");
      const response = await page.request.get(url + "/" + report.document.path), bytes = await response.body();
      assert.equal(response.status(), 200); assert.match(response.headers()["content-type"], /application\/pdf/);
      assert.equal(bytes.subarray(0,5).toString(), "%PDF-");
      assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), report.document.sha256);
    }
    for (const current of ["older", "invalid"]) {
      mode = current; await page.locator("#refreshButton").click();
      await page.waitForFunction(() => document.getElementById("weeklyReportsStatus").textContent.includes("conservées"));
      assert.equal(await page.locator('[data-report-kind="stocks"] time').getAttribute("datetime"), original.reports.stocks.edition_date);
      assert.equal(await page.locator('[data-report-kind="stocks"] .weekly-report-document a').getAttribute("href"), original.reports.stocks.document.path);
    }
    mode = "offline"; await page.reload();
    await page.waitForFunction(() => document.getElementById("weeklyReportsStatus").textContent.includes("conservées"));
    assert.equal(await page.locator(".weekly-report-document a").count(), 2);
    for (const width of [1440, 800, 375, 320]) {
      await page.setViewportSize({width,height:1000}); await page.locator("#weeklyReportsTitle").scrollIntoViewIfNeeded();
      for (let theme = 0; theme < 2; theme++) {
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "no horizontal overflow at " + width);
        const cards = await page.locator(".weekly-report").evaluateAll(nodes => nodes.map(node => {const r=node.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};}));
        assert.ok(width > 800 ? cards[1].x >= cards[0].right : cards[1].y >= cards[0].bottom);
        for (const link of await page.locator(".weekly-report-document a").all()) assert.equal(await link.isVisible(), true);
        await page.locator("#themeToggle").click();
      }
    }
    const empty = await browser.newPage(); await empty.route("https://**", route => route.abort()); await empty.goto(url);
    await empty.waitForFunction(() => document.getElementById("weeklyReportsStatus").textContent.includes("indisponibles"));
    assert.equal(await empty.locator(".weekly-report-document a").count(), 0);
    assert.deepEqual(errors, []);
    console.log("Weekly reports verified: bottom placement, actual dated ranking, correct PDF editions/bytes, safe links, cached outage, stale rejection and desktop/mobile dark/light layouts.");
  } finally {await browser.close();}
}
main().catch(error => {console.error(error); process.exitCode=1;}).finally(() => server.close());
