"use strict";
// Exercise the portal as a user. No automatic navigation helper and no private owner data.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const {chromium, webkit} = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const root = path.resolve(__dirname, ".."), R = require("../js/portal-utils.js");
const fnbData=JSON.parse(fs.readFileSync(path.join(root,"data/fnb-analysis.json"),"utf8"));
const fnbBeta=new Intl.NumberFormat("fr-CA",{minimumFractionDigits:2,maximumFractionDigits:2}).format(fnbData.pairwise.find(p=>p.portfolio==="10"&&p.comparable==="VBAL").beta_vs_comparable);
const types = {".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".json":"application/json", ".pdf":"application/pdf", ".png":"image/png"};
const server = http.createServer((req, res) => {
  const name = new URL(req.url, "http://localhost").pathname;
  const file = path.resolve(root, "." + (name === "/" ? "/index.html" : name));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {res.writeHead(404); res.end(); return;}
  res.setHeader("Content-Type", types[path.extname(file)] || "application/octet-stream"); fs.createReadStream(file).pipe(res);
});
async function check(browser, engine) {
  const context = await browser.newContext({viewport: {width: 1440, height: 900}}), page = await context.newPage(), errors = [], requests = [];
  page.on("pageerror", error => errors.push(error.message)); page.on("request", req => requests.push(req.url()));
  await page.route("https://**", route => route.abort());
  const url = "http://127.0.0.1:" + server.address().port;
  await page.goto(url); await page.waitForFunction(() => document.querySelectorAll("#homeMarkets a").length === 6 && document.querySelectorAll(".indicator-card").length > 30);
  const go = async (section, tab) => {
    await page.locator('.portal-nav [data-page="' + section + '"]').click();
    if (tab) await page.locator('#page-' + section + ' .portal-tabs [data-tab="' + tab + '"]').click();
    assert.equal(await page.locator(".portal-page:visible").count(), 1);
    assert.equal(await page.locator('.portal-nav [aria-current="page"]').getAttribute("data-page"), section);
  };
  const shot = async name => {if (process.env.QA_SCREENSHOTS_DIR) {fs.mkdirSync(process.env.QA_SCREENSHOTS_DIR, {recursive:true}); await page.screenshot({path:path.join(process.env.QA_SCREENSHOTS_DIR, engine + "-" + name + ".png"),fullPage:true});}};
  assert.equal(await page.locator("#page-accueil").isVisible(), true);
  await page.waitForFunction(() => document.querySelectorAll("#homeNews .portal-headline").length > 0);
  await page.waitForFunction(() => document.querySelector("#fearGreedValue").textContent !== "—");
  const home = await page.locator("#kpis").boundingBox();
  assert.ok(home.y + home.height <= 900, "The desktop first screen includes news, sentiment, analyses and macro readings: " + (home.y + home.height));
  assert.equal(await page.locator(".portal-nav a").count(), 8);
  assert.equal(await page.locator(".portal-nav a").last().getAttribute("data-page"), "dashboard"); await shot("home-dark");
  assert.equal(await page.locator("#fundAnalysisFrame").getAttribute("src"), null, "The report is not loaded on Home");
  await go("analyses");
  const fundReport = page.frameLocator("#fundAnalysisFrame");
  await fundReport.locator('html[data-theme="dark"]').waitFor();
  await shot("fnb-dark");
  assert.equal(await fundReport.locator('html').evaluate(n=>getComputedStyle(n).backgroundColor), "rgb(11, 16, 22)");
  await page.locator("#themeToggle").click();
  await fundReport.locator('html[data-theme="light"]').waitFor();
  await shot("fnb-light");
  assert.equal(await fundReport.locator('html').evaluate(n=>getComputedStyle(n).backgroundColor), "rgb(245, 246, 247)");
  await page.locator("#themeToggle").click();
  await fundReport.locator('html[data-ready="true"]').waitFor();
  assert.equal(await fundReport.locator('.nav [data-tab]').first().textContent(), "Vue d’ensemble");
  assert.equal(await fundReport.locator("#allPortfolios").isVisible(), true);
  assert.equal(await fundReport.locator("#allPortfolioBody tr").count(), 15);
  assert.equal(await fundReport.locator("#allPortfolioBody [data-open-portfolio]").count(), 12);
  assert.equal(await fundReport.locator("#monthlyTitle").count(),0);
  assert.equal(await fundReport.locator("[data-preference]").count(), 10);
  assert.equal(await fundReport.locator('[data-preference="5"]').first().textContent().then(t=>t.includes("Élan")), true);
  assert.equal(await fundReport.locator('[data-preference="10"], [data-preference="11"]').count(), 0);
  await fundReport.locator("#referenceSelect").selectOption("VBAL");
  assert.equal(await fundReport.locator('#allPortfolioBody tr').filter({has:fundReport.locator('[data-open-portfolio="10"]')}).locator('td').nth(3).textContent(), fnbBeta);
  await fundReport.locator("#referenceSelect").selectOption("VEQT");
  await fundReport.locator('[data-overview-benchmark="FBAL"]').check();
  assert.equal(await fundReport.locator("#allPortfolioBody tr").count(), 16);
  await fundReport.locator('[data-overview-benchmark="FBAL"]').uncheck();
  await fundReport.locator('[data-all-sort="cagr"]').click();
  assert.equal(await fundReport.locator("#allPortfolioBody [data-open-portfolio]").first().getAttribute("data-open-portfolio"), [...fnbData.proposal_order,...fnbData.custom_order].sort((a,b)=>fnbData.results[b].cagr-fnbData.results[a].cagr)[0]);
  await fundReport.locator('[data-all-sort="rank"]').click();
  assert.equal(await fundReport.locator("#allPortfolioBody [data-open-portfolio]").first().getAttribute("data-open-portfolio"), "5");
  await fundReport.locator('#allPortfolioBody [data-open-portfolio="2"]').click();
  assert.equal(await fundReport.locator('[data-fiche="2"] .holdings-section').isVisible(), true);
  for (let id=1;id<=11;id++) {
    assert.equal(await fundReport.locator('[data-fiche="'+id+'"] .holdings-section tbody tr').count(), 10);
    assert.ok((await fundReport.locator('[data-fiche="'+id+'"] .holdings-count').textContent()).includes("sociétés"));
  }
  assert.equal(await fundReport.locator('[data-fiche="1"] [data-fund="FEQT"] .fund-name').textContent(),"Fidelity All-in-One Equity ETF");
  assert.equal(await fundReport.locator('[data-fiche="1"] [data-fund="FEQT"] .fund-description').textContent(),"Actions mondiales");
  assert.equal(await fundReport.locator('.source-table [data-fund] .fund-name').count(),24);
  await fundReport.locator('.nav [data-tab="portfolios"]').click();
  await fundReport.locator("#ficheFocus").selectOption("all");
  assert.equal(await fundReport.locator(".portfolio-card:visible").count(),12);
  assert.ok(await fundReport.locator('.portfolio-card:visible [data-fund] .fund-name').count()>40);
  await shot("fnb-fund-grid");
  for(const width of [768,320]) {
    await page.setViewportSize({width,height:900});
    assert.ok(await fundReport.locator('html').evaluate(n=>n.scrollWidth<=n.clientWidth),"Fund identities fit at "+width);
  }
  await shot("fnb-fund-grid-mobile");
  await page.setViewportSize({width:1440,height:900});

  await fundReport.locator('.nav [data-tab="overview"]').click();
  const fundNames = ["Horizon", "Équilibre", "Tempo", "Latitude", "Élan", "Synergie", "Conviction", "Dynamique 110", "Audace 120", "60/40", "80/20"];
  for (const [index, name] of fundNames.entries()) {
    const id = String(index + 1);
    assert.equal(await fundReport.locator('[data-fiche="' + id + '"] h3').textContent(), "SAVY " + name);
    assert.ok((await fundReport.locator('#ficheFocus option[value="' + id + '"]').textContent()).includes("SAVY " + name));
    for (const chart of ["risk", "growth"]) {
      assert.ok((await fundReport.locator('#' + chart + '-series-' + id).getAttribute("aria-label")).includes("SAVY " + name));
    }
  }
  assert.ok((await fundReport.locator('#statsBody [data-open-portfolio="2"]').textContent()).includes("Équilibre"));
  assert.ok((await fundReport.locator('#growthReadout [data-portfolio="11"]').textContent()).includes("80/20"));
  assert.equal(await fundReport.locator("#riskSvg .risk-point:visible").count(), 7);
  for (const ticker of ["VBAL", "VGRO", "VEQT"]) {
    assert.equal(await fundReport.locator('#compass .benchmark-controls [data-series="' + ticker + '"]').isVisible(), true);
    assert.equal(await fundReport.locator('#capital .benchmark-controls [data-series="' + ticker + '"]').isVisible(), true);
  }
  await fundReport.locator("#compass .chart-chooser summary").click();
  await fundReport.locator("#risk-series-6").check();
  await fundReport.locator("#compass .chart-chooser summary").click();
  assert.equal(await fundReport.locator("#riskSvg .risk-point:visible").count(), 8);
  assert.equal(await fundReport.locator("#growthSvg .wealth-line:visible").count(), 7, "Each report chart keeps its own selection");
  await fundReport.locator("#summaryFocus").selectOption("10");
  await fundReport.locator("#referenceSelect").selectOption("VBAL");
  assert.equal(await fundReport.locator("#summaryMetrics .kpi").nth(3).locator("strong").textContent(), fnbBeta);
  await fundReport.locator('#compass .benchmark-controls [data-series="VGRO"]').uncheck();
  assert.equal(await fundReport.locator('#capital .benchmark-controls [data-series="VGRO"]').isChecked(), true);
  await fundReport.locator('#compass .benchmark-controls [data-series="VGRO"]').check();
  await fundReport.locator("#capitalInput").fill("12 500,50");
  assert.equal(await fundReport.locator("#capitalError").isVisible(), false);
  await fundReport.locator('.nav [data-tab="exposures"]').click();
  assert.equal(await fundReport.locator("#exposures").isVisible(), true);
  assert.equal(await fundReport.locator("#overview").isVisible(), false);
  await fundReport.locator("#sectorFocus").selectOption("11");
  assert.equal(await fundReport.locator("#geoValues tr").count(), 9);
  await fundReport.locator('.nav [data-tab="portfolios"]').click();
  await fundReport.locator("#ficheFocus").selectOption("10");
  assert.equal(await fundReport.locator('[data-fiche="10"]').isVisible(), true);
  assert.ok((await fundReport.locator('[data-fiche="10"] .asset-mix').textContent()).includes("Actions"));
  await fundReport.locator('.nav [data-tab="overview"]').click();
  await go("accueil"); await go("analyses");
  assert.equal(await fundReport.locator("#risk-series-6").isChecked(), true, "Returning preserves report choices");
  await go("accueil");
  await page.locator('#kpis .kpi[data-id="VIXCLS"] button').click();
  assert.match(await page.locator('#detailCategory').textContent(), /VIXCLS/); await page.keyboard.press("Escape");
  await page.locator("#themeToggle").click(); assert.equal(await page.locator("html").getAttribute("data-theme"), "light"); await shot("home-light");
  await page.locator("#homeNews a").first().click(); assert.equal(await page.locator("#briefingCard").isVisible(), true);
  assert.equal(await page.locator("#briefingAudio").isVisible(), true);
  await go("marches", "rates");
  const oddsNow = new Date().toISOString(), oddsDay = oddsNow.slice(0,10), oddsMeeting = new Date(Date.now()+14*86400000).toISOString().slice(0,10);
  let oddsMode = "new";
  const newOdds = {schema_version:1,kind:"rate_odds",generated_at:oddsNow,decisions:["fed","canada"].map(id=>({id,meeting_date:oddsMeeting,as_of:oddsDay,hike:20,hold:75,cut:5,status:"fresh",methodology:id==="fed"?"SOFR OIS":"CORRA OIS"}))};
  await page.route("**/data/rate-odds.json?*", route => oddsMode === "offline" ? route.fulfill({status:503,body:"{}"}) : route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(oddsMode === "older" ? {...newOdds,generated_at:new Date(Date.parse(oddsNow)-60000).toISOString(),decisions:newOdds.decisions.map(row=>({...row,hike:99,hold:1,cut:0}))} : newOdds)}));
  const refresh = async () => {await page.locator("#refreshButton").click();await page.waitForFunction(()=>!document.getElementById("refreshButton").disabled);};
  await refresh();
  assert.equal(await page.locator("#rateOdds .odds-line strong").first().textContent(), "20 %");
  oddsMode = "offline";await refresh();
  assert.equal(await page.locator("#rateOdds .odds-line strong").first().textContent(), "20 %");
  assert.match(await page.locator("#rateOdds").innerText(),/dernière valeur conservée/);
  oddsMode = "older";await refresh();
  assert.equal(await page.locator("#rateOdds .odds-line strong").first().textContent(), "20 %");
  await page.unroute("**/data/rate-odds.json?*");
  await shot("rates");
  await go("marches", "indices");
  await page.locator("#marketSelect").selectOption("FEQT");
  await page.locator("#marketShowAll").click();
  assert.equal(await page.locator(".market-card:visible").count(), 6);
  await page.locator('#marketRanges [data-range="1Y"]').click();
  assert.equal(await page.locator(".market-card:visible").count(), 6, "Range changes retain the full view");
  await shot("all-indices");
  await page.locator("#marketShowAll").click();
  assert.equal(await page.locator(".market-card:visible").count(), 1);
  assert.equal(await page.locator("#marketSelect").inputValue(), "FEQT", "Returning retains the chosen index");
  await page.locator('#marketRanges [data-range="1M"]').click();
  assert.equal(await page.locator(".market-card:visible").count(), 1);
  assert.equal(await page.locator('.market-card[data-id="FEQT"] svg').isVisible(), true);
  await page.locator("#marketExpand").click(); assert.equal(await page.locator("#expandDialog").evaluate(n=>n.open), true);
  await page.locator('#expandDialog #marketRanges [data-range="3M"]').click();
  assert.equal(await page.locator('#expandDialog .market-card[data-id="FEQT"] svg').isVisible(), true);
  await page.locator("#closeExpand").click();
  assert.equal(await page.locator('#marketRanges [data-range="3M"]').getAttribute("aria-pressed"), "true"); await shot("markets");
  await go("marches", "economy");
  const count = await page.locator(".indicator-card").count();
  assert.equal(count, 41); assert.equal(await page.locator(".indicator-card:visible").count(), count);
  assert.equal(await page.locator("#indicatorSelect,#macroCompare,#macroPaging").count(), 0);
  for (const id of ["DGS10", "VIXCLS", "INDPRO", "NASDAQXAU", "VXEEMCLS", "DTWEXBGS", "DCOILWTICO", "URANIUMSPOT"]) {
    await page.locator('.indicator-card[data-id="' + id + '"]').scrollIntoViewIfNeeded();
    await page.locator('.indicator-card[data-id="' + id + '"] svg').waitFor({state: "visible"});
  }
  await page.locator('.indicator-card[data-id="DGS10"] .detail-button').click();
  for (const key of ["1D", "1W", "1M", "3M", "6M", "YTD", "1Y", "2Y", "5Y"]) assert.equal(await page.locator('#detailRanges [data-range="' + key + '"]').isVisible(), true);
  await page.locator('#detailRanges [data-range="6M"]').click(); await page.keyboard.press("Escape");
  await shot("economy");
  const sentimentNode = await page.locator("#fearGreed").elementHandle();
  await go("dashboard");
  assert.equal(await page.locator(".market-card:visible").count(), 6);
  assert.equal(await page.locator(".indicator-card:visible").count(), count);
  for (const selector of ["#kpis", "#fearGreed", ".policy-odds", "#briefingCard", "#portfolio", "#yieldCurves", "#indicators", ".resources", "#polymarket", "#propertyReport", "#weeklyReports"]) {
    assert.equal(await page.locator(selector).isVisible(), true, "Full dashboard shows " + selector);
    assert.equal(await page.locator(selector).count(), 1, "One live component for " + selector);
  }
  assert.equal(await page.evaluate(node=>node===document.getElementById("fearGreed"), sentimentNode), true);
  await page.locator('#marketRanges [data-range="1M"]').click();
  assert.equal(await page.locator(".market-card:visible").count(), 6, "Refresh keeps all markets visible");
  await page.locator('#rangeControls [data-range="1Y"]').click();
  assert.equal(await page.locator(".indicator-card:visible").count(), count, "Refresh keeps all macro charts visible");
  await shot("dashboard");
  await go("marches", "indices"); assert.equal(await page.locator(".market-card:visible").count(), 1);
  assert.equal(await page.locator("#marketSelect").inputValue(), "FEQT");
  await go("marches", "economy"); assert.equal(await page.locator(".indicator-card:visible").count(), count);
  await go("accueil"); assert.equal(await page.locator("#fearGreed").isVisible(), true);
  assert.equal(await page.evaluate(node=>node===document.getElementById("fearGreed"), sentimentNode), true);
  await page.goto(url + "/#view=dashboard&tab=overview"); await page.reload();
  await page.waitForFunction(()=>document.querySelectorAll(".indicator-card").length>30);
  assert.equal(await page.locator(".indicator-card:visible").count(), count, "Direct dashboard bookmarks open every chart");
  await go("accueil"); await sentimentNode.dispose();
  await go("immobilier"); assert.equal(await page.locator('#propertyReportsGrid [data-report-kind="real_estate"]').isVisible(), true);
  await go("recherche"); assert.equal(await page.locator('#weeklyReportsGrid [data-report-kind="stocks"]').isVisible(), true);
  assert.equal(await page.locator("#researchPlan").isVisible(),true);
  assert.equal(await page.locator("#researchPlan .research-schedule-card").count(),2);
  assert.deepEqual(await page.locator("#researchPlan .research-time").allTextContents(), ["Mercredi · 22 h", "Mercredi · 22 h"]);
  assert.match(await page.locator("#researchPlan").innerText(),/une seule livraison.*Toronto/s);
  assert.doesNotMatch(await page.locator("#researchPlan").innerText(),/22 h UTC|16 h 30/);
  assert.equal(await page.locator('#page-recherche [data-tab="strategies"]').count(),0);
  await page.locator("#researchStrategies summary").click();
  assert.match(await page.locator("#researchStrategies").innerText(),/30 % · 25 % · 20 % · 15 % · 10 %/);
  await page.locator("#researchStrategies summary").click();
  await page.locator(".weekly-stock summary").first().click(); assert.equal(await page.locator(".weekly-stock-details").first().getAttribute("open"), ""); await shot("research");
  await go("recherche", "archives"); assert.ok(await page.locator('#page-recherche .portal-archives a').count() >= 1);
  for (const anchor of await page.locator(".portal-archives a").all()) {const response = await page.request.get(url + "/" + await anchor.getAttribute("href")); assert.equal(response.status(), 200); assert.match(response.headers()["content-type"], /pdf/);}
  await go("polymarket"); assert.equal(await page.locator("#polymarket").isVisible(), true); await shot("polymarket");
  await page.goBack(); assert.equal(await page.locator("#panel-recherche-archives").isVisible(), true); await page.goForward(); assert.equal(await page.locator("#polymarket").isVisible(), true);
  await page.keyboard.press("Control+k"); assert.equal(await page.locator("#searchInput").evaluate(n=>n===document.activeElement), true);

  // Synthetic import exercises the real private positions path, with no owner holdings.
  const positions = {positions:[{ticker:"FEQT",quantity:2,average_cost:10}]};
  await page.goto(url + "/#positions=" + Buffer.from(JSON.stringify(positions)).toString("base64url"));
  await page.reload();
  await page.waitForFunction(()=>!document.querySelector("#portfolioContent").hidden);
  assert.equal(await page.locator("#page-portefeuilles").isVisible(), true); assert.ok(!page.url().includes("positions="));
  await page.locator('#portfolioRanges [data-range="1M"]').click();
  await page.locator("#portfolioExpand").click(); assert.equal(await page.locator("#expandDialog #portfolioChart svg").isVisible(), true); await page.keyboard.press("Escape");
  await go("portefeuilles", "positions"); await page.locator("#portfolioPositionsToggle").click(); assert.equal(await page.locator("#portfolioPositions").isVisible(), true);
  await go("portefeuilles", "allocations"); await page.locator("#portfolioHeatmapTiles button").first().waitFor({state:"visible"});
  await go("portefeuilles", "performance"); assert.equal(await page.locator("#portfolioRisk").isVisible(), true);
  await go("portefeuilles", "transactions"); assert.match(await page.locator("#panel-portefeuilles-transactions").innerText(), /Aucun journal/);
  await go("dashboard");
  for (const tab of Object.keys(R.PAGES.portefeuilles.tabs)) assert.equal(await page.locator("#panel-portefeuilles-" + tab).isVisible(), true);
  assert.equal(await page.locator("#portfolioChart svg").isVisible(), true);
  await page.locator("#portfolioExpand").click(); assert.equal(await page.locator("#expandDialog #portfolioRisk").isVisible(), true); await page.keyboard.press("Escape");
  await go("portefeuilles", "positions"); assert.equal(await page.locator("#panel-portefeuilles-allocations").isVisible(), false);
  await go("portefeuilles"); await shot("portfolio");
  const syntheticKey = "synthetic-test-key-never-a-real-credential";
  await page.goto(url + "/#portfolio-key=" + syntheticKey + "&portfolio=2");
  await page.reload();
  await go("immobilier", "archives"); assert.equal(new URLSearchParams(new URL(page.url()).hash.slice(1)).get("portfolio-key"), syntheticKey);
  await page.reload(); assert.equal(await page.locator("#panel-immobilier-archives").isVisible(), true);
  assert.ok(requests.every(value=>!value.includes(syntheticKey) && !value.includes("positions=")), "Private fragments never reach requests");
  for (const width of [375, 320]) {
    await page.setViewportSize({width, height:812});
    for (const [section, config] of Object.entries(R.PAGES)) {
      await go(section);
      for (const tab of Object.keys(config.tabs)) {
        if (Object.keys(config.tabs).length > 1) await page.locator('#page-' + section + ' .portal-tabs [data-tab="' + tab + '"]').click();
        // Measure after the resized page and its chart observers have painted.
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        const overflow = await page.evaluate(()=>({width:innerWidth, scroll:document.documentElement.scrollWidth,
          root:{client:document.documentElement.clientWidth,offset:document.documentElement.offsetWidth},body:{client:document.body.clientWidth,scroll:document.body.scrollWidth},viewport:visualViewport?.width,focused:document.activeElement?.id,
          scrollers:document.documentElement.scrollWidth <= innerWidth ? [] : [...document.querySelectorAll("body *")].filter(n=>n.clientWidth>0 && n.scrollWidth>n.clientWidth+1).slice(0,20).map(n=>({tag:n.tagName,id:n.id,classes:String(n.className),width:n.clientWidth,scroll:n.scrollWidth,overflow:getComputedStyle(n).overflowX})),
          offenders:document.documentElement.scrollWidth <= innerWidth ? [] : [...document.querySelectorAll("body *")].filter(n=>n.getBoundingClientRect().right>innerWidth+.5 && n.getBoundingClientRect().width>0).slice(0,15).map(n=>({tag:n.tagName,id:n.id,classes:String(n.className),text:n.textContent.slice(0,80),parent:n.parentElement?.className,right:n.getBoundingClientRect().right,width:n.getBoundingClientRect().width}))}));
        if (overflow.scroll > overflow.width) console.log("PORTAL_OVERFLOW_IMAGE " + (await page.screenshot()).toString("base64"));
        assert.equal(overflow.scroll > overflow.width, false, engine + " overflow " + width + " " + section + "/" + tab + " " + JSON.stringify(overflow));
        const nav = await page.locator(".portal-nav").boundingBox(); assert.ok(nav.y >= 700 && nav.y + nav.height <= 813, "iPhone navigation stays on screen");
      }
    }
    await go("accueil"); await shot("mobile-" + width);
  }
  assert.deepEqual(errors, []);
  console.log(engine + ": eight sections, compact home and complete dashboard, charts/periods/expansion, reports/archives, all portfolio views, keyboard/back/reload, fragment privacy and 375/320px layouts passed.");
  await context.close();
}
(async()=>{
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  for (const [engine, type] of [["chromium", chromium], ...(process.env.PORTAL_WEBKIT === "1" ? [["webkit", webkit]] : [])]) {
    const browser = await type.launch({headless:true}); try {await check(browser, engine);} finally {await browser.close();}
  }
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
