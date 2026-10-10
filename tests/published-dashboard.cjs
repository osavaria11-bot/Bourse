"use strict";
const {chromium} = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const root = path.resolve(__dirname, "..");
const mime = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png"};
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
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
    await page.waitForFunction(() => document.querySelectorAll("#marketGrid svg").length === 5 && document.querySelectorAll(".news-section").length === 4);
    const words = await page.locator(".news-section p").evaluateAll(nodes => nodes.reduce((total, node) => total + node.textContent.trim().split(/\s+/u).length, 0));
    assert.equal(words, 500);
    assert.match(await page.locator("#briefingParagraph").innerText(), /FRED — Tes indicateurs à surveiller/);
    assert.equal(await page.locator("#marketGrid path").evaluateAll(nodes => nodes.some(node => /NaN|Infinity/.test(node.getAttribute("d")))), false);
    console.log("Published data verified:", words, "words, 4 sources, 5 actual market histories.");
    if (process.env.SCREENSHOT_LOGS) {
      console.log("SCREENSHOT_MARKETS_DESKTOP " + (await page.locator(".market-section").screenshot()).toString("base64"));
      await page.setViewportSize({width: 375, height: 1000});
      await page.locator("#marketTitle").scrollIntoViewIfNeeded();
      console.log("SCREENSHOT_MARKETS_MOBILE " + (await page.screenshot()).toString("base64"));
    }
    assert.deepEqual(errors, []);
  } finally {await browser.close();}
}
main().catch(error => {console.error(error); process.exitCode = 1;}).finally(() => server.close());
