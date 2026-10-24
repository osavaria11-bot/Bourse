"use strict";
const {componentPage} = require("./portal-navigation.cjs");
const audioUtils = require("../js/briefing-audio-utils.js");
/* Browser fixtures are synthetic and never written to the site's data directory. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const root = path.resolve(__dirname, "..");
const definitions = JSON.parse(fs.readFileSync(path.join(root, "data/series.json"), "utf8")).series;
const indicatorCount = definitions.length;
const now = new Date();
const series = definitions.map((definition, index) => {
  const count = definition.frequency === "quarterly" ? 40 : definition.frequency === "monthly" ? 36 : 80;
  const history = [];
  for (let i = count - 1; i >= 0; i--) {
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    if (definition.frequency === "quarterly") {
      day.setUTCDate(1); day.setUTCMonth(Math.floor(now.getUTCMonth() / 3) * 3 - i * 3);
    } else if (definition.frequency === "monthly") {
      day.setUTCDate(1); day.setUTCMonth(now.getUTCMonth() - i);
    } else day.setUTCDate(day.getUTCDate() - i * (definition.frequency === "weekly" ? 7 : 1));
    history.push([day.toISOString().slice(0, 10), i === 15 ? null : Math.round((index + 2 + Math.sin(i / 4)) * 1000) / 1000]);
  }
  const valid = history.filter(row => row[1] !== null);
  return { ...definition, date: valid.at(-1)[0], value: valid.at(-1)[1],
    previous_date: valid.at(-2)[0], previous_value: valid.at(-2)[1],
    change: valid.at(-1)[1] - valid.at(-2)[1], history, fetch_status: "fresh",
    last_successful_fetch: now.toISOString(), source_url: "https://fred.stlouisfed.org/series/" + definition.id };
});
const dataset = { schema_version: 2, generated_at: now.toISOString(), last_successful_update: now.toISOString(),
  update_status: "fresh_data", data_provider: "SYNTHETIC TEST FIXTURE", series };
const markets = { ...dataset, kind: "market_indices", series: [
  ["SPX", "^GSPC"], ["IXIC", "^IXIC"], ["TSX", "^GSPTSE"], ["STOXX600", "^STOXX"], ["EEM", "EEM"],
  ["FEQT", "FEQT.NE"],
].map(([id, quote_symbol]) => ({...series.find(point => point.frequency === "daily"), id, quote_symbol, title: "Synthetic market " + id, frequency: "daily",
  unit: id === "EEM" ? "$ US" : id === "FEQT" ? "$ CA" : "points", ...(id === "FEQT" ? {currency: "CAD"} : {})})) };
const newsTime = new Date(now.getTime() - 86400000);
const edition = new Intl.DateTimeFormat("en-CA", {timeZone: "America/Toronto"}).format(newsTime);
const briefing = {schema_version: 4, kind: "news_digest", language: "fr", timezone: "America/Toronto",
  generated_at: newsTime.toISOString(), edition_date: edition,
  editorial_note: "Fixture de test — aucune donnée de marché réelle.",
  stories: [0,1,2].map(index => ({topic: "Marchés", title: "Titre synthétique " + index,
    summary: "Une publication récente présente un événement financier vérifié avec une date et une source précise pour guider la lecture des marchés.",
    impact: "Le taux et les bénéfices pourraient réagir selon les nouvelles données.",
    source_label: "Source synthétique", source_url: "https://example.test/article/" + index, published_date: edition})),
  fred_watch: ["CPIAUCSL", "PAYEMS", "DGS10"].map(id => ({series_id: id, title: "Série " + id,
    explanation: "Observation synthétique pour le test du tableau.", observation_date: edition,
    source_url: "https://fred.stlouisfed.org/series/" + id}))};
const odds = {schema_version: 1, kind: "rate_odds", generated_at: now.toISOString(), decisions: ["fed", "canada"].map(id => ({
  id, meeting_date: new Date(now.getTime() + 15 * 86400000).toISOString().slice(0,10), as_of: new Intl.DateTimeFormat("en-CA", {timeZone: "America/Toronto"}).format(now),
  hike: 20, hold: 80, cut: 0, status: "fresh", methodology: "OIS"}))};
let offline = false, failAllData = false, failNews = false, invalidNews = false, failMarkets = false, invalidMarkets = false;
let naturalAudio = false;
const contentTypes = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".png": "image/png" };
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname === "/data/briefing-audio.json") {
    if (!naturalAudio) {response.writeHead(404); response.end("{}"); return;}
    const n = audioUtils.narration(briefing);
    response.writeHead(200, {"Content-Type": "application/json"});
    response.end(JSON.stringify({schema_version: 1, kind: "briefing_audio", text: n.text,
      src: "data/audio/briefing-" + "a".repeat(24) + ".mp3", duration: n.chapters.length * 20,
      voice: "fr-CA-AntoineNeural", voice_label: "Antoine · Français (Canada)",
      chapters: n.chapters.map((chapter, index) => ({...chapter, time_start: index * 20, time_end: (index + 1) * 20}))}));
    return;
  }
  if (pathname === "/data/intraday-quotes.json") {response.writeHead(503); response.end("{}"); return;}
  if (pathname === "/data/market-indices.json") {
    response.writeHead(failMarkets ? 503 : 200, {"Content-Type": "application/json"});
    response.end(failMarkets ? "{}" : JSON.stringify(invalidMarkets ? {...markets, series: markets.series.slice(0, -1)} : markets)); return;
  }
  if (pathname === "/data/macro-data.json") {
    response.writeHead(offline ? 503 : 200, { "Content-Type": "application/json" });
    response.end(offline ? "{}" : JSON.stringify(dataset)); return;
  }
  if (pathname === "/data/daily-briefing.json") {
    response.writeHead(failNews ? 503 : 200, { "Content-Type": "application/json" });
    response.end(failNews ? "{}" : JSON.stringify(invalidNews ? {...briefing, stories: []} : briefing)); return;
  }
  if (pathname === "/data/rate-odds.json") {
    response.writeHead(200, {"Content-Type": "application/json"}); response.end(JSON.stringify(odds)); return;
  }
  if (pathname === "/data/macro-briefing.json" && failAllData) {
    response.writeHead(503); response.end("{}"); return;
  }
  const filename = path.resolve(root, "." + (pathname === "/" ? "/index.html" : decodeURIComponent(pathname)));
  if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
    response.writeHead(404); response.end(); return;
  }
  response.writeHead(200, { "Content-Type": contentTypes[path.extname(filename)] || "application/octet-stream" });
  fs.createReadStream(filename).pipe(response);
});
async function waitCount(page, count) {
  await page.waitForFunction(expected => document.querySelectorAll(".indicator-card").length === expected, count);
}
async function run() {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const page = await componentPage(context,);
    await page.addInitScript(() => {
      const speech = {calls: [], cancelled: 0, current: null,
        getVoices() {return [{lang: "en-US", default: true}, {lang: "fr-CA", name: "Voix française de test"}];},
        speak(utterance) {this.current = utterance; this.calls.push({text: utterance.text, rate: utterance.rate, lang: utterance.lang});},
        cancel() {this.cancelled++; this.current = null;}, resume() {}};
      Object.defineProperty(window, "speechSynthesis", {configurable: true, value: speech});
      Object.defineProperty(window, "SpeechSynthesisUtterance", {configurable: true, value: class {constructor(text) {this.text = text;}}});
      window.__savySpeechTest = speech;
    });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    // A local fetch fixture exercises validation without depending on external HTTPS routing.
    await page.addInitScript(() => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = (input, init) => String(input?.url || input).startsWith("https://biquote.io/api/USDCAD") ?
        Promise.resolve(new Response(JSON.stringify({symbol:"USDCAD",mid:1.4265,timestamp:new Date().toISOString(),marketState:"open"}), {status:200,headers:{"Content-Type":"application/json"}})) : originalFetch(input, init);
    });
    await page.route("https://**", route => route.abort());
    await page.goto(url); await waitCount(page, indicatorCount);
    await page.waitForFunction(() => !document.querySelector("#briefingAudioPlay").disabled);
    const audioPlay = page.locator("#briefingAudioPlay");
    assert.equal(await page.evaluate(() => window.__savySpeechTest.calls.length), 0, "Reading never autoplays");
    await audioPlay.click(); assert.equal(await audioPlay.getAttribute("aria-pressed"), "true");
    assert.equal(await page.evaluate(() => window.__savySpeechTest.current.lang), "fr-CA");
    await page.evaluate(() => window.__savySpeechTest.current.onboundary({charIndex: 25}));
    await audioPlay.click(); assert.match(await audioPlay.innerText(), /Reprendre/);
    const readingPosition = await page.evaluate(() => window.SavyBriefingAudio.snapshot().position);
    assert.equal(readingPosition, 25);
    await audioPlay.click();
    await page.locator("#briefingAudioRate").selectOption("1.5");
    assert.equal(await page.evaluate(() => window.__savySpeechTest.current.rate), 1.5);
    await page.locator("#briefingAudioNext").click();
    assert.equal(await page.locator("#briefingAudioChapter").inputValue(), "1");
    assert.match(await page.evaluate(() => window.__savySpeechTest.current.text), /Nouvelle 1/);
    await page.locator("#briefingAudioPrevious").click();
    await page.locator("#briefingAudioChapter").selectOption("2");
    assert.match(await page.evaluate(() => window.__savySpeechTest.current.text), /Nouvelle 2/);
    const spokenCount = await page.evaluate(() => window.__savySpeechTest.calls.length);
    await page.locator("#refreshButton").click();
    await page.waitForFunction(() => !document.querySelector("#refreshButton").disabled);
    assert.equal(await page.evaluate(() => window.__savySpeechTest.calls.length), spokenCount, "An unchanged edition is not restarted by refreshing quotes");
    assert.equal(await audioPlay.getAttribute("aria-pressed"), "true");
    await page.locator("#briefingAudioStop").click();
    assert.equal(await page.evaluate(() => window.SavyBriefingAudio.snapshot().position), 0);
    assert.match(await audioPlay.innerText(), /Écouter le briefing/);
    for (const width of [320, 375, 768, 1440]) {
      await page.setViewportSize({width, height: 1000});
      assert.ok(await page.locator("#briefingAudio").evaluate(node => node.scrollWidth <= node.clientWidth + 1), "Audio controls fit at " + width);
    }
    const noVoiceContext = await browser.newContext(), noVoice = await componentPage(noVoiceContext,);
    await noVoice.addInitScript(() => {
      Object.defineProperty(window, "speechSynthesis", {configurable: true, value: undefined});
      Object.defineProperty(window, "SpeechSynthesisUtterance", {configurable: true, value: undefined});
    });
    await noVoice.route("https://**", route => route.abort());
    await noVoice.goto(url); await waitCount(noVoice, indicatorCount);
    assert.equal(await noVoice.locator("#briefingAudioPlay").isDisabled(), true);
    assert.match(await noVoice.locator("#briefingAudioStatus").innerText(), /pas disponible/);
    await noVoiceContext.close();
    naturalAudio = true;
    const naturalContext = await browser.newContext(), naturalPage = await componentPage(naturalContext,);
    await naturalPage.addInitScript(() => {
      Object.defineProperty(window, "speechSynthesis", {configurable: true, value: undefined});
      Object.defineProperty(window, "SpeechSynthesisUtterance", {configurable: true, value: undefined});
      window.Audio = class extends EventTarget {
        constructor() {super(); this.currentTime = 0; this.readyState = 1; this.plays = 0; window.__savyNaturalTest = this;}
        play() {this.plays++; return Promise.resolve();}
        pause() {}
        removeAttribute(name) {if (name === "src") this.src = "";}
      };
    });
    await naturalPage.route("https://**", route => route.abort());
    await naturalPage.goto(url); await waitCount(naturalPage, indicatorCount);
    await naturalPage.waitForFunction(() => window.SavyBriefingAudio?.snapshot().natural);
    assert.match(await naturalPage.locator("#briefingAudioStatus").innerText(), /Voix naturelle/);
    assert.match(await naturalPage.locator("#briefingAudioNote").innerText(), /Antoine/);
    assert.equal(await naturalPage.evaluate(() => window.__savyNaturalTest.plays), 0, "Natural audio never autoplays");
    await naturalPage.locator("#briefingAudioPlay").click();
    assert.equal(await naturalPage.evaluate(() => window.SavyBriefingAudio.snapshot().engine), "neural");
    await naturalPage.locator("#briefingAudioChapter").selectOption("2");
    assert.equal(await naturalPage.evaluate(() => window.__savyNaturalTest.currentTime), 40);
    await naturalPage.locator("#briefingAudioRate").selectOption("1.5");
    assert.equal(await naturalPage.evaluate(() => window.__savyNaturalTest.playbackRate), 1.5);
    await naturalPage.evaluate(() => {window.__savyNaturalTest.currentTime = 50; window.__savyNaturalTest.dispatchEvent(new Event("timeupdate"));});
    assert.match(await naturalPage.locator("#briefingAudioTime").innerText(), /0:50/);
    await naturalPage.locator("#briefingAudioPlay").click();
    assert.equal(await naturalPage.evaluate(() => window.SavyBriefingAudio.snapshot().state), "paused");
    await naturalPage.locator("#briefingAudioPlay").click();
    await naturalPage.evaluate(() => window.__savyNaturalTest.dispatchEvent(new Event("ended")));
    assert.match(await naturalPage.locator("#briefingAudioPlay").innerText(), /Réécouter/);
    await naturalContext.close(); naturalAudio = false;
    console.log("Briefing audio controls passed: user gesture, French Canadian voice, pause/resume, speed, chapters, refresh continuity, mobile layout and unsupported browsers.");
    assert.equal(await page.locator("#sortSelect").inputValue(), "recent");
    assert.deepEqual(await page.locator("#kpis .kpi").evaluateAll(nodes => nodes.map(node => node.dataset.id)),
      ["VIXCLS", "DFEDTARU", "CPIAUCSL", "DGS10", "DEXCAUS", "V39079"]);
    await page.waitForFunction(() => {
      const quote = window.SavyLiveFX?.current();
      const value = document.querySelector('#kpis .kpi[data-id="DEXCAUS"] .kpi-value')?.textContent;
      return quote && value === new Intl.NumberFormat("fr-CA", {minimumFractionDigits: 4, maximumFractionDigits: 4}).format(quote.rate);
    });
    assert.match(await page.locator('#kpis .kpi[data-id="DEXCAUS"]').innerText(), /biquote/);
    assert.match(await page.locator('#kpis .kpi[data-id="DFEDTARU"] .kpi-value').innerText(), /–.*%/);
    assert.equal(await page.locator(".odds-card").count(), 2);
    assert.match(await page.locator(".odds-card").first().innerText(), /Hausse.*20 %/s);
    const policyKpi = page.locator('#kpis .kpi[data-id="V39079"]');
    assert.match(await policyKpi.locator(".kpi-value").innerText(), /%/);
    await page.locator("#kpis").scrollIntoViewIfNeeded();
    const desktopPair = await page.evaluate(() => [...document.querySelectorAll('#kpis .kpi[data-id="DEXCAUS"], #kpis .kpi[data-id="V39079"]')].map(node => {
      const rect = node.getBoundingClientRect(); return {top: rect.top, left: rect.left};
    }));
    assert.equal(desktopPair[0].top, desktopPair[1].top);
    assert.ok(desktopPair[1].left > desktopPair[0].left);
    if (process.env.MACRO_SCREENSHOT_LOGS) {
      console.log("SCREENSHOT_MACRO_KPIS_DESKTOP " + (await page.locator("#kpis").screenshot()).toString("base64"));
      await page.setViewportSize({width: 375, height: 900});
      console.log("SCREENSHOT_MACRO_KPIS_MOBILE " + (await page.locator("#kpis").screenshot()).toString("base64"));
      await page.setViewportSize({width: 1440, height: 1000});
    }
    const policyCard = page.locator('.indicator-card[data-id="V39079"]');
    const policySource = policyCard.locator(".card-bottom a");
    assert.match(await policySource.innerText(), /Banque du Canada/);
    assert.equal(await policySource.getAttribute("href"), "https://www.bankofcanada.ca/core-functions/monetary-policy/key-interest-rate/");
    await policyCard.locator(".detail-button").click();
    await page.waitForFunction(() => document.querySelector("#detailDialog").open);
    assert.match(await page.locator("#detailSource").innerText(), /Banque du Canada/);
    assert.equal(await page.locator("#detailSource").getAttribute("href"), await policySource.getAttribute("href"));
    const policyChart = page.locator("#detailChart svg");
    await policyChart.focus(); await policyChart.press("ArrowLeft");
    assert.match(await page.locator("#detailChart .chart-tooltip").innerText(), /%/);
    await page.keyboard.press("Escape");
    await page.waitForSelector(".news-section");
    assert.equal(await page.locator(".news-section").count(), 3);
    assert.equal(await page.locator("#fredWatchList li").count(), 3);
    await page.locator("#fredWatchList button").first().click();
    await page.waitForFunction(() => document.querySelector("#detailDialog").open);
    assert.match(await page.locator("#detailCategory").innerText(), /CPIAUCSL/);
    await page.keyboard.press("Escape");
    assert.match(await page.locator("#briefingDate").innerText(), new RegExp(edition + ".*3 nouvelles"));
    assert.match(await page.locator("#briefingDate").innerText(), /nouvelle édition en attente/);
    assert.equal(await page.locator("#briefingParagraph script").count(), 0);
    assert.equal(await page.locator(".news-section a").first().getAttribute("rel"), "noopener noreferrer");
    assert.equal(await page.locator('#marketRanges [data-range="INTRADAY"]').getAttribute("aria-pressed"), "true");
    // This fixture deliberately has no intraday feed; exercise daily
    // histories by choosing a historical period explicitly.
    await page.locator('#marketRanges [data-range="1Y"]').click();
    await page.waitForSelector("#marketGrid svg");
    assert.equal(await page.locator(".market-card").count(), 6);
    assert.equal(await page.locator("#marketGrid svg").count(), 6);
    assert.match(await page.locator("#marketStatus").innerText(), /6\/6 marchés/);
    assert.match(await page.locator('.market-card[data-id="IXIC"] h4').innerText(), /Nasdaq Composite/);
    assert.match(await page.locator('.market-card[data-id="EEM"] .market-value').innerText(), /\$ US/);
    assert.match(await page.locator('.market-card[data-id="EEM"] h4').innerText(), /ETF EEM/);
    const feqtCard = page.locator('.market-card[data-id="FEQT"]');
    assert.match(await feqtCard.locator("h4").innerText(), /FEQT.*Fidelity/);
    assert.match(await feqtCard.locator(".market-value").innerText(), /\$ CA/);
    assert.match(await feqtCard.locator("a").innerText(), /FNB/);
    assert.equal(await feqtCard.locator("a").getAttribute("href"), "https://finance.yahoo.com/quote/FEQT.NE/");
    const marketRange = page.getByRole("group", {name: "Période des indices boursiers"});
    assert.equal(await marketRange.getByRole("button").count(), 12);
    const history = markets.series[0].history;
    const oneMonth = new Date(markets.series[0].date + "T00:00:00Z");
    const anchorDay = oneMonth.getUTCDate(); oneMonth.setUTCDate(1); oneMonth.setUTCMonth(oneMonth.getUTCMonth() - 1);
    const lastDay = new Date(Date.UTC(oneMonth.getUTCFullYear(), oneMonth.getUTCMonth() + 1, 0)).getUTCDate();
    oneMonth.setUTCDate(Math.min(anchorDay, lastDay));
    for (const [label, baseline] of [
      ["1 jour", history.at(-2)],
      ["3 jours", history.at(-4)], ["1 semaine", history.at(-6)],
      ["1 mois", history.filter(row => row[0] <= oneMonth.toISOString().slice(0, 10)).at(-1)],
    ]) {
      await marketRange.getByRole("button", {name: label, exact: true}).click();
      assert.equal(await marketRange.getByRole("button", {name: label, exact: true}).getAttribute("aria-pressed"), "true");
      const percent = (history.at(-1)[1] / baseline[1] - 1) * 100;
      const expected = (percent > 0 ? "+" : "") + new Intl.NumberFormat("fr-CA", {minimumFractionDigits: 2, maximumFractionDigits: 2}).format(percent) + " % · " + label;
      for (const card of await page.locator(".market-card").all()) {
        assert.equal(await card.locator(".market-return").innerText(), expected);
        assert.match(await card.locator(".market-period").innerText(), new RegExp("Du " + baseline[0] + " au " + history.at(-1)[0]));
      }
      const chart = page.locator("#marketGrid svg").first(); await chart.focus();
      assert.match(await page.locator("#marketGrid .chart-tooltip").first().innerText(), new RegExp("% depuis le " + baseline[0]));
    }
    await marketRange.getByRole("button", {name: "3 mois", exact: true}).click();
    assert.equal(await marketRange.getByRole("button", {name: "3 mois", exact: true}).getAttribute("aria-pressed"), "true");
    const marketChart = page.locator("#marketGrid svg").first();
    await marketChart.focus(); await marketChart.press("ArrowLeft");
    assert.match(await page.locator("#marketGrid .chart-tooltip").first().innerText(), /points/);
    assert.match(await page.locator("#marketGrid .market-return").first().innerText(), /Rendement indisponible/);
    await marketRange.getByRole("button", {name: "YTD", exact: true}).click();
    assert.equal(await marketRange.getByRole("button", {name: "YTD", exact: true}).getAttribute("aria-pressed"), "true");
    assert.match(await page.locator("#marketGrid .market-return").first().innerText(), / · YTD$/);
    assert.equal(await page.locator("#marketGrid path").evaluateAll(nodes => nodes.some(node => /NaN|Infinity/.test(node.getAttribute("d")))), false);
    await page.locator(".indicator-card").first().scrollIntoViewIfNeeded();
    await page.waitForSelector("#grid svg");
    assert.ok((await page.locator("#updated").innerText()).includes(indicatorCount + "/" + indicatorCount));
    assert.equal(await page.locator('.indicator-card[data-id="SP500"]').count(), 0);
    assert.ok(await page.locator("#grid svg").count() > 0);
    assert.equal(await page.locator("#grid path").evaluateAll(nodes => nodes.some(node => /NaN|Infinity/.test(node.getAttribute("d")))), false);
    await page.locator("#searchInput").fill("epargne"); await waitCount(page, 1);
    assert.equal(await page.locator(".indicator-card").getAttribute("data-id"), "A072RC1Q156SBEA");
    await page.locator("#searchInput").fill(""); await waitCount(page, indicatorCount);
    await page.locator("#searchInput").fill("chomage"); await waitCount(page, 4);
    const canadianUnemployment = page.locator('.indicator-card[data-id="V2062815"]');
    assert.match(await canadianUnemployment.locator("h3").innerText(), /Canada/);
    assert.match(await canadianUnemployment.locator(".card-bottom a").innerText(), /Statistique Canada/);
    assert.equal(await canadianUnemployment.locator(".card-bottom a").getAttribute("href"), "https://www150.statcan.gc.ca/t1/tbl1/fr/tv.action?pid=1410028701");
    await canadianUnemployment.locator(".detail-button").click();
    await page.waitForFunction(() => document.querySelector("#detailDialog").open);
    assert.match(await page.locator("#detailSource").innerText(), /Statistique Canada/);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator('.indicator-card[data-id="UNRATE"]').count(), 1);
    assert.equal(await page.locator('.indicator-card[data-id="ICSA"]').count(), 1);
    assert.equal(await page.locator('.indicator-card[data-id="IC4WSA"]').count(), 1);
    await page.locator("#searchInput").fill("inflation canada"); await waitCount(page, 3);
    for (const sid of ["V41690973", "V108785715", "V108785714"]) {
      const card = page.locator('.indicator-card[data-id="' + sid + '"]');
      assert.match(await card.locator(".card-bottom a").innerText(), /Statistique Canada/);
      await card.locator(".detail-button").click();
      await page.waitForFunction(() => document.querySelector("#detailDialog").open);
      assert.match(await page.locator("#detailSource").getAttribute("href"), /statcan\.gc\.ca/);
      assert.equal(await page.locator("#detailChart svg").count(), 1);
      await page.keyboard.press("Escape");
    }
    await page.locator("#searchInput").fill("DFII10"); await waitCount(page, 1);
    assert.match(await page.locator('.indicator-card[data-id="DFII10"] h3').innerText(), /TIPS/);
    await page.locator("#searchInput").fill(""); await waitCount(page, indicatorCount);
    await page.locator("#categoryFilters button").filter({ hasText: /^Canada$/ }).click(); await waitCount(page, 3);
    await page.locator("#categoryFilters button").filter({ hasText: /^Tous$/ }).click(); await waitCount(page, indicatorCount);
    const favoriteId = await page.locator(".indicator-card").first().getAttribute("data-id");
    await page.locator('.indicator-card[data-id="' + favoriteId + '"] .favorite-button').click();
    await page.locator("#favoritesOnly").click(); await waitCount(page, 1);
    await page.locator("#favoritesOnly").click(); await waitCount(page, indicatorCount);
    await page.reload(); await waitCount(page, indicatorCount);
    assert.equal(await page.locator('.indicator-card[data-id="' + favoriteId + '"] .favorite-button').getAttribute("aria-pressed"), "true");
    await page.locator("#rangeControls button[data-range='3M']").click();
    assert.equal(await page.locator("#rangeControls button[data-range='3M']").getAttribute("aria-pressed"), "true");
    await page.locator('.indicator-card[data-id="T10Y2Y"] .detail-button').click();
    await page.waitForFunction(() => document.querySelector("#detailDialog").open);
    assert.ok(await page.locator("#detailTable tr").count() > 0);
    await page.locator("#detailRanges button[data-range='1M']").click();
    const chart = page.locator("#detailChart svg"); await chart.focus();
    const before = await page.locator("#detailChart .chart-tooltip").innerText();
    await chart.press("ArrowLeft");
    assert.notEqual(await page.locator("#detailChart .chart-tooltip").innerText(), before);
    const historyDownload = page.waitForEvent("download"); await page.locator("#detailExport").click();
    const historical = await historyDownload;
    assert.match(historical.suggestedFilename(), /T10Y2Y-1M\.csv$/);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#detailDialog").evaluate(node => node.open), false);
    const snapshotDownload = page.waitForEvent("download"); await page.locator("#exportButton").click();
    const snapshot = await snapshotDownload;
    const csv = fs.readFileSync(await snapshot.path(), "utf8");
    assert.match(csv, /Code de série/); assert.match(csv, /DEXCAUS/); assert.match(csv, /V39079/); assert.match(csv, /bankofcanada\.ca/);
    await page.locator('[data-theme-choice="light"]').click();
    assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
    await page.reload(); await waitCount(page, indicatorCount);
    assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
    for (const width of [1100, 375, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.locator("#kpis").scrollIntoViewIfNeeded();
      await page.waitForFunction(() => {
        const pair = [...document.querySelectorAll('#kpis .kpi[data-id="DEXCAUS"], #kpis .kpi[data-id="V39079"]')].map(node => node.getBoundingClientRect());
        return pair.length === 2 && pair.every(rect => rect.width > 0 && rect.height > 0) && pair[0].top === pair[1].top && pair[1].left > pair[0].left;
      });
      const layout = await page.evaluate(() => ({width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth,
        overflow: [...document.querySelectorAll("body *")].filter(node => node.getBoundingClientRect().right > window.innerWidth + 1)
          .slice(0, 10).map(node => ({tag: node.tagName, className: String(node.className), right: node.getBoundingClientRect().right}))}));
      assert.ok(layout.scrollWidth <= layout.width, "Horizontal overflow at " + width + ": " + JSON.stringify(layout));
      const adjacent = await page.locator('#kpis .kpi[data-id="DEXCAUS"], #kpis .kpi[data-id="V39079"]').evaluateAll(nodes => nodes.map(node => {
        const rect = node.getBoundingClientRect(); return {top: rect.top, left: rect.left};
      }));
      assert.equal(adjacent[0].top, adjacent[1].top, "USD/CAD and Canadian policy rate share a row at " + width);
      assert.ok(adjacent[1].left > adjacent[0].left);
    }
    if (process.env.QA_SCREENSHOTS_DIR) {
      fs.mkdirSync(process.env.QA_SCREENSHOTS_DIR, { recursive: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({ path: path.join(process.env.QA_SCREENSHOTS_DIR, "savy-desktop.png") });
      await page.setViewportSize({ width: 375, height: 900 });
      await page.screenshot({ path: path.join(process.env.QA_SCREENSHOTS_DIR, "savy-mobile.png") });
    }
    offline = true;
    await page.evaluate(point => {
      const key = "savy:macro-data:v2", previous = JSON.parse(localStorage.getItem(key));
      previous.series.push({...point, id: "SP500", title: "Removed cached S&P 500"});
      localStorage.setItem(key, JSON.stringify(previous));
    }, series[0]);
    await page.reload(); await waitCount(page, indicatorCount);
    assert.match(await page.locator("#updated").innerText(), /Copie conservée/);
    await page.waitForFunction(() => !document.querySelector("#refreshButton").disabled);
    assert.equal(await page.locator("#refreshButton").isEnabled(), true);
    invalidNews = true;
    await page.reload(); await page.waitForFunction(() => document.querySelector("#briefingDate").textContent.includes("Copie conservée"));
    assert.equal(await page.locator(".news-section").count(), 3);
    invalidMarkets = true;
    await page.reload(); await page.waitForFunction(() => document.querySelector("#marketStatus").textContent.includes("Copie conservée"));
    assert.equal(await page.locator('#marketRanges [data-range="INTRADAY"]').getAttribute("aria-pressed"), "true");
    await page.locator('#marketRanges [data-range="1Y"]').click();
    assert.equal(await page.locator("#marketGrid svg").count(), 6);
    invalidMarkets = false; failMarkets = true;
    await page.reload(); await page.waitForFunction(() => document.querySelector("#marketStatus").textContent.includes("Copie conservée"));
    await page.locator('#marketRanges [data-range="1Y"]').click();
    assert.equal(await page.locator("#marketGrid svg").count(), 6);
    assert.match(await page.locator("#briefingDate").innerText(), new RegExp(edition));
    invalidNews = false; failNews = true;
    await page.reload(); await page.waitForFunction(() => document.querySelector("#briefingDate").textContent.includes("Copie conservée"));
    assert.equal(await page.locator(".news-section").count(), 3);
    failAllData = true;
    failNews = false;
    const newsContext = await browser.newContext();
    const newsOnly = await componentPage(newsContext,);
    await newsOnly.goto(url);
    await newsOnly.waitForFunction(() => document.querySelector("#updated").textContent.includes("ne sont pas disponibles"));
    await newsOnly.waitForSelector(".news-section");
    assert.equal(await newsOnly.locator(".news-section").count(), 3, "News must load even when macro data is unavailable");
    assert.equal(await newsOnly.locator(".market-card").count(), 6, "Each market must retain a source link when quotes are unavailable");
    assert.equal(await newsOnly.locator("#marketGrid svg").count(), 0);
    await newsContext.close(); failNews = true;
    const freshContext = await browser.newContext();
    const empty = await componentPage(freshContext,);
    await empty.route("https://**", route => route.abort());
    await empty.goto(url);
    await empty.waitForFunction(() => document.querySelector("#updated").textContent.includes("ne sont pas disponibles"));
    await empty.waitForFunction(() => document.querySelector("#briefingDate").textContent === "Édition indisponible");
    await empty.waitForFunction(() => !document.querySelector("#refreshButton").disabled);
    assert.equal(await empty.locator("#refreshButton").isEnabled(), true);
    const oddsContext = await browser.newContext({timezoneId: "America/Toronto", viewport: {width: 375, height: 900}});
    const oddsPage = await componentPage(oddsContext,);
    oddsPage.on("pageerror", error => errors.push(error.message));
    await oddsPage.route("https://**", route => route.abort());
    await oddsPage.clock.setFixedTime(new Date("2026-10-13T02:19:17Z"));
    const eveningOdds = {schema_version: 1, kind: "rate_odds", generated_at: "2026-10-13T00:56:18Z", decisions: [
      {id: "fed", as_of: "2026-10-13", meeting_date: "2026-10-28", hike: 30, hold: 70, cut: 0, status: "fresh", methodology: "SOFR OIS"},
      {id: "canada", as_of: "2026-10-12", meeting_date: "2026-10-28", hike: 28, hold: 72, cut: 0, status: "fresh", methodology: "CORRA OIS"},
    ]};
    await oddsPage.route("**/data/rate-odds.json?*", route => route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify(eveningOdds)}));
    await oddsPage.goto(url);
    await oddsPage.waitForFunction(() => document.querySelectorAll(".odds-bars").length === 2);
    const fedOdds = oddsPage.locator(".odds-card").first(), canadaOdds = oddsPage.locator(".odds-card").nth(1);
    assert.match(await fedOdds.innerText(), /cotes du 2026-10-13 \(date du fournisseur\)/);
    assert.equal(await fedOdds.locator(".odds-line strong").allTextContents().then(values => values.join(",")), "30 %,70 %,0 %");
    assert.match(await canadaOdds.innerText(), /cotes du 2026-10-12/);
    assert.doesNotMatch(await canadaOdds.innerText(), /date du fournisseur/);
    assert.equal(await oddsPage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    eveningOdds.decisions[0].as_of = "2026-10-14";
    await oddsPage.reload();
    await oddsPage.waitForFunction(() => document.querySelectorAll(".odds-card").length === 2);
    assert.equal(await fedOdds.locator(".odds-bars").count(), 1, "Keep the prior valid observation when the new source date is invalid");
    assert.match(await fedOdds.innerText(), /cotes du 2026-10-13.*dernière valeur conservée/);
    assert.doesNotMatch(await fedOdds.innerText(), /cotes du 2026-10-14/);
    assert.equal(await canadaOdds.locator(".odds-line").count(), 3, "One invalid bank must not hide the other");
    eveningOdds.decisions[0].as_of = "2026-10-12"; eveningOdds.decisions[0].status = "cached";
    await oddsPage.reload();
    await oddsPage.waitForFunction(() => document.querySelectorAll(".odds-bars").length === 2);
    assert.match(await fedOdds.innerText(), /cotes du 2026-10-13.*dernière valeur conservée/);
    await oddsContext.close();
    assert.deepEqual(errors, []);
    console.log("Browser checks passed: " + indicatorCount + " macro cards, live FX, both policy rates and meeting odds, Quebec evening UTC odds rollover, sourced selective briefing, offline preservation and 320px mobile.");
    await freshContext.close(); await context.close();
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());

