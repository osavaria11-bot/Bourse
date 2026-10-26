"use strict";
// Real report, immutable archives, independent chart choices, exports and compact screens.
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),http=require("node:http");
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE_PATH||"playwright");
const root=path.resolve(__dirname,".."),D=JSON.parse(fs.readFileSync(path.join(root,"data/fnb-analysis.json"),"utf8"));
const server=http.createServer((req,res)=>{const p=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!p.startsWith(root+path.sep)||!fs.existsSync(p)||!fs.statSync(p).isFile()){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',p.endsWith('.html')?'text/html':p.endsWith('.json')?'application/json':p.endsWith('.css')?'text/css':'text/javascript');fs.createReadStream(p).pipe(res);});
async function check(browser,engine){
 const context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true}),page=await context.newPage(),errors=[];
 // Some Chromium versions retain SVG bounding boxes after display:none.
 // Check the CSS selection state directly for SVG series.
 const shownSeries=selector=>page.locator(selector).evaluateAll(ns=>ns.filter(n=>getComputedStyle(n).display!=='none').length);
 await page.clock.install();
 page.on('pageerror',e=>errors.push(e.message));await page.route('https://**',r=>r.abort());
 const url='http://127.0.0.1:'+server.address().port;
 await page.goto(url+'/reports/portefeuilles-fnb.html');await page.waitForSelector('html[data-ready="true"]');
 assert.equal(await page.locator('.monthly-proposal').count(),0);
 assert.equal(await page.locator('[data-preference="proposal"]').count(),1);
 assert.equal(await page.locator('[data-preference="proposal"] .preference-rank').textContent(),String(D.preference_ranking.entries.find(e=>e.id==='proposal').rank));
 assert.equal(await page.locator('#allPortfolioBody [data-open-portfolio]').count(),D.custom_order.length+D.proposal_order.length+D.robust_order.length+D.recommended_order.length+(D.prospective_order||[]).length);
 assert.equal(await page.locator('#referenceSelect').inputValue(),'VEQT','Existing default benchmark is preserved');
 // The decision aid shares one daily convention and keeps the historical
 // leaderboard / allocations unchanged when a personal objective is selected.
 assert.equal(await page.locator('#decision').isVisible(),false);
 assert.equal(await page.locator('.nav [data-tab="frontier"] + [data-tab="decision"]').innerText(),'Comparer pour choisir');
 await page.locator('.nav [data-tab="decision"]').click();
 assert.equal(await page.locator('#allPortfolios').isVisible(),false);
 assert.equal(await page.locator('#decision').isVisible(),true);
 assert.equal(await page.locator('#referenceSelect').isVisible(),true);
 const submitted=require('../data/fnb-prospective/2026-10-26-user-allocations.json');
 for(const q of submitted.portfolios){
  for(const selector of ['summaryFocus','sectorFocus','ficheFocus'])assert.equal(await page.locator('#'+selector+' option[value="'+q.id+'"]').count(),1);
  assert.equal(await page.locator('[data-preference="'+q.id+'"]').count(),1);
  const card=page.locator('[data-fiche="'+q.id+'"]');
  assert.equal(await card.locator('[data-fund]').count(),Object.keys(q.weights).length);
  for(const [t,w] of Object.entries(q.weights))assert.equal(await card.locator('[data-fund="'+t+'"] + td').innerText(),new Intl.NumberFormat('fr-CA',{minimumFractionDigits:1,maximumFractionDigits:1}).format(w*100)+' %');
  assert.match(await card.locator('.holdings-section').innerText(),/Couverture partielle/);
 }
 const prospectiveId=D.prospective_order[0];
 assert.equal(await page.locator('.prospective-project').count(),0);
 for(const selector of ['summaryFocus','sectorFocus','ficheFocus'])assert.equal(await page.locator('#'+selector+' option[value="'+prospectiveId+'"]').count(),1);
 assert.equal(await page.locator('[data-preference="'+prospectiveId+'"]').count(),1);
 await page.waitForSelector('#decisionPanel[data-ready="true"]');
 assert.equal(await page.locator('#decisionBody tr').count(),4);
 const initialChoices=await page.locator('[data-decision-choice]').evaluateAll(nodes=>nodes.map(n=>n.value));
 assert.deepEqual(initialChoices,['7',...D.robust_order.slice(0,2)]);
 const decision=require('../js/fnb-decision-utils'),daily=require('../data/fnb-daily-risk.json');
 const expectedDecision=decision.analyse(D,initialChoices,'VEQT',daily,require('../data/fnb-stress-history.json'));
 for(const row of expectedDecision.rows){
  const actual=page.locator('[data-decision-row="'+row.id+'"]');
  assert.equal(await actual.locator('[data-decision-value="sharpe"]').innerText(),new Intl.NumberFormat('fr-CA',{minimumFractionDigits:2,maximumFractionDigits:2}).format(row.sharpe));
  assert.equal(await actual.locator('[data-decision-value="cvar"]').innerText().then(t=>t.includes('fragile')),true);
 }
 await page.locator('#decisionHorizon').selectOption('2');
 assert.match(await page.locator('#decisionResultTitle').innerText(),/2 ans/);
 const trailing=decision.horizon(expectedDecision,2);
 for(const row of trailing.results)assert.ok((await page.locator('#decisionHorizonResult').innerText()).includes(new Intl.NumberFormat('fr-CA',{minimumFractionDigits:1,maximumFractionDigits:1}).format(row.total*100)+' %'));
 const readingBox=await page.locator('#decisionReading').boundingBox(),decisionTable=await page.locator('.decision-table').boundingBox();assert.ok(readingBox.y+readingBox.height<=decisionTable.y,'The result is immediately above the table');
 await page.locator('#decisionGoal').selectOption('balance');
 assert.deepEqual(await page.locator('[data-decision-choice]').evaluateAll(nodes=>nodes.map(n=>n.value)),initialChoices);
 assert.match(await page.locator('#decisionReading').innerText(),/Sharpe/);
 await page.locator('#decisionHorizon').selectOption('5');await page.locator('#decisionLoss').fill('10,5');await page.locator('#decisionCapital').fill('20 000');
 assert.match((await page.locator('#decisionLossMoney').innerText()).replace(/\s/g,''),/2100/);
 assert.match(await page.locator('#decisionReading').innerText(),/historique est plus court/);
 assert.match(await page.locator('#decisionHorizonResult').innerText(),/Aucune projection/);
 assert.ok(await page.locator('#decisionBody .decision-warning').count()>0);
 await page.locator('#decisionLoss').fill('abc');assert.equal(await page.locator('#decisionLoss').getAttribute('aria-invalid'),'true');
 await page.locator('#decisionLoss').fill('10');
 await page.reload();await page.locator('.nav [data-tab="decision"]').click();await page.waitForSelector('#decisionPanel[data-ready="true"]');
 assert.equal(await page.locator('#decisionGoal').inputValue(),'balance');assert.equal(await page.locator('#decisionLoss').inputValue(),'10');
 await page.locator('#decisionDetails>summary').click();
 assert.match(await page.locator('#decisionProtection').innerText(),/projection linéaire fondée sur le bêta/);
 assert.match(await page.locator('#decisionSensitivity').innerText(),/variantes/);
 assert.match(await page.locator('#decisionSources').innerText(),/2008/);
 await page.locator('#decisionDetails>summary').click();
 await page.locator('#decisionGoal').selectOption('');await page.locator('#decisionHorizon').selectOption('');await page.locator('#decisionLoss').fill('');await page.locator('#decisionCapital').fill('10 000');
 // The prospective view separates history from a declared projection basis,
 // uses readable type, removes false precision in ranks, and keeps detail folded.
 await page.locator('#decisionHorizon').selectOption('');
 await page.locator('#decisionGoal').selectOption('global');
 assert.match(await page.locator('#decisionReading').innerText(),/Comparaison globale/);
 await page.locator('#decisionMode').selectOption('forward');
 await page.waitForSelector('#decisionPanel[data-forecast-ready="true"]',{timeout:30000});
 assert.equal(await page.locator('#decisionHorizon').inputValue(),'2');
 assert.equal(await page.locator('#forecastReturnBasis').inputValue(),'history');
 assert.equal(await page.locator('#decisionBody tr').count(),6);
 assert.equal(await page.locator('#decisionForecastStatus').isVisible(),false);
 assert.match(await page.locator('#forecastBasisNote').innerText(),/2008-01/);
 assert.match(await page.locator('#decisionHead').innerText(),/Passé/);
 assert.match(await page.locator('#decisionHead').innerText(),/Projection/);
 assert.doesNotMatch(await page.locator('#decisionHead').innerText(),/Rang/);
 assert.ok((await page.locator('#decisionReading').innerText()).split(/\s+/).length<45);
 assert.ok(await page.locator('#decisionBody td').first().evaluate(n=>parseFloat(getComputedStyle(n).fontSize)>=15));
 assert.ok(await page.locator('[data-forward-return="7"]').evaluate(n=>parseFloat(getComputedStyle(n).fontSize)>=20));
 assert.equal(await page.locator('#decisionForecastValidation').isVisible(),false);
 for(const ref of ['VFV','FEQT','VEQT'])assert.equal(await page.locator('[data-decision-row="'+ref+'"]').count(),1);
 assert.equal(await page.locator('[data-forward-past="7"]').innerText(),new Intl.NumberFormat('fr-CA',{minimumFractionDigits:1,maximumFractionDigits:1}).format(D.results['7'].cagr*100)+' %');
 // The registered candidate uses the same three-way comparison and forecasts.
 await page.locator('[data-decision-choice="2"]').selectOption(prospectiveId);
 for(const years of ['2','5','10']){
  await page.locator('#decisionHorizon').selectOption(years);
  await page.waitForSelector('#decisionPanel[data-forecast-ready="true"]',{timeout:30000});
  assert.equal(await page.locator('[data-decision-row="'+prospectiveId+'"]').count(),1);
  assert.doesNotMatch(await page.locator('[data-forward-return="'+prospectiveId+'"]').innerText(),/—/);
  assert.doesNotMatch(await page.locator('[data-forward-value="'+prospectiveId+'"]').innerText(),/—/);
 }
 await page.locator('#decisionHorizon').selectOption('2');
 await page.locator('[data-decision-choice="2"]').selectOption(initialChoices[2]);
 await page.waitForSelector('#decisionPanel[data-forecast-ready="true"]',{timeout:30000});
 const firstForward=await page.locator('[data-forward-value="7"]').innerText(),historyReturn=await page.locator('[data-forward-return="7"]').innerText();
 await page.locator('#decisionCapital').fill('100 000');
 assert.notEqual(await page.locator('[data-forward-value="7"]').innerText(),firstForward);
 await page.locator('#forecastReturnBasis').selectOption('planning');
 await page.waitForSelector('#decisionPanel[data-forecast-ready="true"]',{timeout:30000});
 assert.notEqual(await page.locator('[data-forward-return="7"]').innerText(),historyReturn);
 assert.match(await page.locator('#forecastBasisNote').innerText(),/repères prudents/);
 await page.locator('#forecastReturnBasis').selectOption('history');
 await page.waitForSelector('#decisionPanel[data-forecast-ready="true"]',{timeout:30000});
 assert.equal(await page.locator('[data-forward-return="7"]').innerText(),historyReturn);
 await page.locator('#decisionForecastDetails>summary').click();
 await page.locator('#decisionForecastMetrics .forecast-row>summary').first().click();
 assert.match(await page.locator('#decisionForecastMetrics').innerText(),/Atteindre 8 \/ 10 \/ 15 %/);
 await page.locator('#decisionForecastDetails>summary').click();
 await page.locator('#decisionForecastMethod>summary').click();
 assert.match(await page.locator('#decisionForecastExplanation').innerText(),/Avance récente conservée/);
 await page.locator('#forecastRecentCarry').selectOption('0.5');
 await page.waitForSelector('#decisionPanel[data-forecast-ready="true"]',{timeout:30000});
 assert.notEqual(await page.locator('[data-forward-return="7"]').innerText(),historyReturn);
 assert.match(await page.locator('#decisionReading').innerText(),/50 %/);
 await page.locator('#forecastRecentCarry').selectOption('0');
 await page.waitForSelector('#decisionPanel[data-forecast-ready="true"]',{timeout:30000});
 await page.locator('#forecastTechnical>summary').click();
 assert.match(await page.locator('#decisionForecastValidation').innerText(),/24 mois/);
 assert.match(await page.locator('#decisionForecastValidation').innerText(),/Moyenne récente/);
 assert.match(await page.locator('#decisionForecastSensitivity').innerText(),/sans probabilité attribuée/);
 await page.locator('#forecastTechnical>summary').click();
 await page.locator('#decisionForecastMethod>summary').click();
 for(const horizon of ['5','10','2']){
  await page.locator('#decisionHorizon').selectOption(horizon);
  await page.waitForSelector('#decisionPanel[data-forecast-ready="true"]',{timeout:30000});
  assert.match(await page.locator('#decisionResultTitle').innerText(),new RegExp(horizon+' ans'));
 }
 for(const width of [320,375,768]){
  await page.setViewportSize({width,height:900});
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Forward comparison overflow '+width);
  assert.equal(await page.locator('[data-decision-choice]').count(),3);
 }
 await page.setViewportSize({width:1280,height:900});
 await page.locator('#decisionForecastMethod>summary').click();
 await page.locator('#forecastAdvanced>summary').click();
 const originalMean=await page.locator('[data-forward-return="7"]').innerText();
 await page.locator('#forecastEquityView').fill('2');await page.locator('#forecastApply').click();
 await page.waitForSelector('#decisionPanel[data-forecast-ready="true"]',{timeout:30000});
 assert.notEqual(await page.locator('[data-forward-return="7"]').innerText(),originalMean);
 await page.locator('#forecastReset').click();
 await page.waitForSelector('#decisionPanel[data-forecast-ready="true"]',{timeout:30000});
 assert.equal(await page.locator('[data-forward-return="7"]').innerText(),originalMean);
 await page.locator('#decisionHorizon').selectOption('10');
 await page.locator('#forecastEquityView').fill('1.5');await page.locator('#forecastApply').click();
 assert.equal(await page.locator('#decisionPanel').getAttribute('data-forecast-ready'),'loading');
 await page.locator('#decisionMode').selectOption('historical');
 assert.equal(await page.locator('#decisionBody tr').count(),4);
 assert.equal(await page.locator('#decisionForecastDetails').isVisible(),false);
 await page.locator('#decisionHorizon').selectOption('');
 await page.locator('#decisionGoal').selectOption('');
 await page.locator('#decisionCapital').fill('10 000');
 assert.equal(await page.locator('#decision .horizon-columns [data-open-portfolio]:visible').count(),15,'All three top fives are visible in the dedicated comparison tab');
 const tops=require('../data/fnb-horizon-ranking.json');
 for(const h of tops.horizons){
  assert.deepEqual(await page.locator('[data-horizon-top="'+h.years+'"] [data-open-portfolio]').evaluateAll(ns=>ns.map(n=>n.dataset.openPortfolio)),h.order);
 }
 assert.match(await page.locator('.horizon-note').innerText(),/qualitative/);
 assert.equal(await page.locator('#allPortfolios .horizon-panel').count(),0);
 await page.locator('.horizon-ranking summary').click();
 assert.match(await page.locator('.horizon-ranking').innerText(),/pas probabilités calculées/);
 await page.locator('.horizon-ranking summary').click();
 await page.locator('.nav [data-tab="allPortfolios"]').click();
 await page.locator('#recommendedCharts').click();
 assert.equal(await page.locator('#referenceSelect').inputValue(),'VFV');
 for(const chart of ['risk','growth'])assert.equal(await shownSeries('#'+(chart==='risk'?'riskSvg .risk-point':'growthSvg .wealth-line')),D.recommended_order.length+2);
 await page.locator('#tableScope').selectOption('all');
 for(const k of D.recommended_order){
  await page.locator('.nav [data-tab="portfolios"]').click();await page.locator('#ficheFocus').selectOption(k);
  assert.equal(await page.locator('[data-fiche="'+k+'"] [data-fund]').count(),Object.keys(D.results[k].weights).length);
  assert.equal(await page.locator('[data-fiche="'+k+'"] [data-history-period]').count(),3);
  assert.match(await page.locator('[data-fiche="'+k+'"] .mini-metrics').innerText(),/Bêta \/ VFV/);
  assert.equal(await page.locator('[data-fiche="'+k+'"] .holdings-section tbody tr').count(),10);
 }
 await page.locator('#ficheFocus').selectOption('2');assert.equal(await page.locator('#referenceSelect').inputValue(),'VEQT');
 const newId=D.recommended_order[0],ratios=require('../js/fnb-dashboard.js'),betaText=ref=>new Intl.NumberFormat('fr-CA',{minimumFractionDigits:2,maximumFractionDigits:2}).format(ratios.relativeMetrics(D.results[newId],D.results[ref],D.assumptions.risk_free).beta);
 const newStatsRow=page.locator('#statsBody tr').filter({has:page.locator('[data-open-portfolio="'+newId+'"]')});
 assert.equal(await newStatsRow.locator('td').nth(2).textContent(),betaText('VEQT'),'Hidden risk table follows the reference when opening a legacy card');
 await page.locator('#ficheFocus').selectOption(newId);
 assert.equal(await newStatsRow.locator('td').nth(2).textContent(),betaText('VFV'),'Opening a new card immediately recalculates risk against VFV');
 await page.locator('#ficheFocus').selectOption('2');
 // Changing the followed portfolio must change the actual curves, amounts
 // and companion selectors, not only the four summary figures.
 await page.locator('.nav [data-tab="overview"]').click();
 for(const k of ['robust-2026-10-1','5','robust-2026-10-2','2']){
  const previous=await page.locator('#summaryFocus').inputValue();
  await page.locator('#summaryFocus').selectOption(k);
  assert.equal(await page.locator('#sectorFocus').inputValue(),k);assert.equal(await page.locator('#ficheFocus').inputValue(),k);
  assert.equal(await page.locator('#riskSvg .risk-point[data-portfolio="'+k+'"]').isVisible(),true);
  assert.equal(await page.locator('#growthSvg .wealth-line[data-portfolio="'+k+'"]').isVisible(),true);
  if(previous!==k)assert.equal(await page.locator('#growthSvg .wealth-line[data-portfolio="'+previous+'"]').evaluate(n=>getComputedStyle(n).display!=='none'),false);
  assert.equal(await page.locator('#growthReadout [data-portfolio="'+k+'"] b').innerText(),new Intl.NumberFormat('fr-CA',{style:'currency',currency:'CAD',currencyDisplay:'narrowSymbol',maximumFractionDigits:0}).format(D.results[k].end));
 }
 await page.locator('.nav [data-tab="allPortfolios"]').click();
 await page.locator('#robustCharts').click();assert.equal(await page.locator('#overview').isVisible(),true);
 assert.equal(await shownSeries('#riskSvg .risk-point'),5);
 assert.equal(await shownSeries('#growthSvg .wealth-line'),5);
 await page.locator('#capitalInput').fill('20 000');
 for(const k of D.robust_order){
  await page.locator('.nav [data-tab="overview"]').click();
  assert.equal(await page.locator('#risk-series-'+k).isChecked(),true);assert.equal(await page.locator('#growth-series-'+k).isChecked(),true);
  const row=page.locator('#growthReadout [data-portfolio="'+k+'"] b');assert.ok((await row.innerText()).includes(new Intl.NumberFormat('fr-CA',{maximumFractionDigits:0}).format(D.results[k].end*2).replace(/\s/g,' '))||(await row.innerText()).replace(/\s/g,'').includes(String(Math.round(D.results[k].end*2))));
  await page.locator('.nav [data-tab="portfolios"]').click();await page.locator('#ficheFocus').selectOption(k);assert.equal(await page.locator('[data-fiche="'+k+'"] [data-fund]').count(),Object.keys(D.results[k].weights).length);assert.equal(await page.locator('[data-fiche="'+k+'"] .robust-diagnostics tbody tr').count(),5);
  await page.locator('[data-fiche="'+k+'"] [data-open-exposure]').click();assert.equal(await page.locator('#sectorFocus').inputValue(),k);
 }
 await page.locator('.nav [data-tab="overview"]').click();await page.locator('#capitalInput').fill('10 000');await page.locator('.nav [data-tab="allPortfolios"]').click();
 await page.locator('#allPortfolioBody [data-open-portfolio="proposal"]').click();
 assert.equal(await page.locator('[data-fiche="proposal"]').isVisible(),true);
 assert.equal(await page.locator('[data-fiche="proposal"] [data-fund]').count(),Object.keys(D.results.proposal.weights).length);
 assert.equal(await page.locator('[data-fiche="proposal"] .holdings-section tbody tr').count(),10);
 assert.match(await page.locator('[data-fiche="proposal"]').innerText(),/100 % de l’allocation/);
 await page.locator('[data-fiche="proposal"] [data-open-exposure="proposal"]').click();
 assert.equal(await page.locator('#sectorFocus').inputValue(),'proposal');
 assert.equal(await page.locator('#geoValues tr').count(),D.geo_names.length);
 assert.equal(await page.locator('#sectorValues tr').count(),D.sector_names.length);
 for(const ref of ['FEQT','VEQT','VGRO','VBAL','FBAL','FGRO']){await page.locator('#referenceSelect').selectOption(ref);assert.equal(await page.locator('#geoSvg svg').count(),1);}
 // All portfolio/benchmark choices update the same factor sample and estimates.
 const factors = require('../js/fnb-factor-utils.js');
 for (const id of [...D.custom_order, ...D.robust_order, ...D.recommended_order, ...(D.prospective_order||[]), ...D.proposal_order]) {
  await page.locator('#sectorFocus').selectOption(id);
  for (const ref of ['VEQT', 'VFV', 'VBAL']) {
   await page.locator('#referenceSelect').selectOption(ref);
   const c = factors.compare(D, id, ref), row = page.locator('#factorValues [data-factor="market"]');
   assert.equal(await page.locator('#factorContent').isVisible(), true);
   assert.equal(await page.locator('#riskSnapshotContent').isVisible(),true);
   assert.equal(await page.locator('.risk-snapshot-metrics>div').count(),4);
   assert.equal(await page.locator('[data-risk-contribution]').count(),Math.min(4,Object.keys(D.results[id].weights).length));
   assert.equal(await page.locator('#factorValues [data-factor]').count(), 5);
   assert.match(await page.locator('#factorStatus').innerText(), new RegExp(ref + '.*' + D.dates.length + ' mois'));
   assert.equal(await row.locator('td').nth(0).innerText(), (c.factors[0].portfolio > .0005 ? '+' : '') + new Intl.NumberFormat('fr-CA', {minimumFractionDigits:2,maximumFractionDigits:2}).format(c.factors[0].portfolio));
   assert.equal(await page.locator('#factorValues .factor-unavailable').innerText().then(t => t.includes('Non estimé')), true);
  }
 }
 for(const [id,ref] of [['10','VBAL'],['11','VGRO'],['2','VEQT']]){await page.locator('#sectorFocus').selectOption(id);assert.equal(await page.locator('#referenceSelect').inputValue(),ref);}
 // Exercise the adaptive details, source classes, model explanations and compact row.
 await page.locator('#sectorFocus').selectOption('2');await page.locator('#referenceSelect').selectOption('VEQT');
 assert.equal(await page.locator('#factorMetrics>div').count(),4);
 assert.equal(await page.locator('#riskScenario option').count(),8);
 const stress=require('../js/fnb-stress-utils.js'),stressInput=require('../data/fnb-stress-history.json');
 for(const scenario of stress.compare(D,'2','VEQT',stressInput)){
  await page.locator('#riskScenario').selectOption(scenario.id);
  const expected=scenario.portfolio.return===null?'—':new Intl.NumberFormat('fr-CA',{minimumFractionDigits:1,maximumFractionDigits:1}).format(scenario.portfolio.return*100)+' %';
  assert.equal(await page.locator('#riskStress').textContent(),expected);
 }
 await page.locator('.risk-snapshot>.factor-method>summary').click();
 const methodToggle=await page.locator('.risk-snapshot>.factor-method>summary').boundingBox(),methodPopup=await page.locator('.risk-snapshot>.factor-method>.risk-detail-content').boundingBox();
 assert.ok(methodPopup.y>=methodToggle.y+methodToggle.height,'The details panel must not cover its close toggle in Safari');
 assert.equal(await page.locator('#riskScenarios>.stress-scenario-detail').count(),8);
 assert.match(await page.locator('#riskValidation').innerText(),/blocs disjoints de 21 séances/);
 assert.match(await page.locator('#riskAttribution').innerText(),/bêta plus faible/i);
 await page.locator('.risk-snapshot>.factor-method>summary').click();
 await page.setViewportSize({width:1440,height:1000});
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const row=await page.locator('.risk-snapshot,.factor-panel').evaluateAll(ns=>ns.map(n=>{const r=n.getBoundingClientRect();return {top:r.top,height:r.height,bottom:r.bottom,left:r.left,width:r.width,client:n.clientHeight,scroll:n.scrollHeight};}));
 assert.ok(Math.abs(row[0].top-row[1].top)<1);assert.ok(row.every(x=>x.height<=487),'Cards stay within the previous desktop height');
 assert.ok(row.every(x=>x.scroll<=x.client+2),'No content clipped in the compact cards: '+JSON.stringify(row));
 await page.setViewportSize({width:1280,height:900});
 await page.locator('#sectorFocus').selectOption('VEQT');await page.locator('#referenceSelect').selectOption('VEQT');
 await page.locator('.factor-panel > .factor-method > summary').click();
 assert.match(await page.locator('#factorReading').innerText(), /risque actif est nul/);
 await page.locator('.factor-panel > .factor-method > summary').click();
 assert.equal(await page.locator('#factorValues [data-factor="market"] td').last().innerText(), '—');
 for (const width of [390, 768, 1280]) {
  await page.setViewportSize({width, height:900});
  for (const theme of ['petrol', 'light', 'dark']) {
   await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
   assert.equal(await page.locator('#factorTitle').isVisible(), true);
   assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Factor table scrolls inside its container');
  }
 }
 await page.setViewportSize({width:1280,height:900});
 await page.locator('#sectorFocus').selectOption('proposal');

 await page.locator('.nav [data-tab="methods"]').click();await page.locator('#monthlyCharts').click();
 assert.equal(await page.locator('#overview').isVisible(),true);
 for(const chart of ['risk','growth']){assert.equal(await page.locator('#'+chart+'-series-proposal').isChecked(),true);}
 assert.equal(await shownSeries('#riskSvg .risk-point'),6);
 assert.equal(await shownSeries('#growthSvg .wealth-line'),6);
 await page.locator('#compass .chart-chooser summary').click();await page.locator('#risk-series-proposal').uncheck();await page.locator('#compass .chart-chooser summary').click();
 assert.equal(await shownSeries('#riskSvg .risk-point'),5);
 assert.equal(await shownSeries('#growthSvg .wealth-line'),6);
 await page.locator('#monthSlider').fill(String(D.dates.length));
 assert.ok((await page.locator('#monthLabel').innerText()).includes(D.assumptions.as_of.slice(0,4)));
 const csvEvent=page.waitForEvent('download');await page.locator('#monthlyCsv').click();const csv=await csvEvent;
 assert.match(csv.suggestedFilename(),/Mensuels\.csv$/);
 const contents=fs.readFileSync(await csv.path(),'utf8');assert.ok(contents.includes(D.results.proposal.name));
 assert.equal(contents.trim().split('\n').length,D.dates.length+1);
 await page.locator('.nav [data-tab="performance"]').click();await page.waitForSelector('#performance[data-ready="true"]');
 const tracking=JSON.parse(fs.readFileSync(path.join(root,'data/fnb-comparison.json'),'utf8'));
 assert.equal(await page.locator('#performanceBody tr').count(),tracking.accounts.length);
 assert.equal(await page.locator('#performanceBenchmark option').count(),tracking.benchmarks.length);
 assert.equal(await page.locator('#performanceFocus option').count(),tracking.accounts.filter(a=>a.kind!=='benchmark').length+1);
 assert.equal(await page.locator('#performanceCohort').count(),0);
 assert.match(await page.locator('#performanceStart').innerText(),/19 oct/);
 assert.equal(await page.locator('#performanceChart .performance-series').count(),tracking.accounts.filter(a=>a.history.length).length);
 await page.locator('#performanceRecommended').click();
 assert.equal(await page.locator('#performanceBenchmark').inputValue(),'VFV');
 assert.equal(await page.locator('#performanceChart .performance-series').count(),D.recommended_order.length+1);
 for(const k of D.recommended_order){
  await page.locator('#performanceFocus').selectOption(k);
  assert.equal(await page.locator('#performanceBenchmark').inputValue(),'VFV');
  assert.equal(await page.locator('#performanceChart .performance-series').count(),2);
  assert.match(await page.locator('#performanceBody [data-performance-row="'+k+'"]').innerText(),/Simulation depuis le 19 oct/);
  await page.locator('#performanceSlider').fill('0');assert.match(await page.locator('#performanceReadout').innerText(),/10\s000,00/);
 }
 for(const k of ['savy-5','savy-2']){
  await page.locator('#performanceFocus').selectOption(k);
  assert.equal(await page.locator('#performancePositions').inputValue(),k);
  assert.equal(await page.locator('#performanceChart .performance-series').count(),2);
  const expected=tracking.accounts.find(a=>a.id===k).history.at(-1).value;
  assert.ok((await page.locator('#performanceReadout').innerText()).includes(new Intl.NumberFormat('fr-CA',{minimumFractionDigits:2,maximumFractionDigits:2}).format(expected)));
 }
 await page.locator('#performanceFocus').selectOption('robust-2026-10-2');
 assert.equal(await page.locator('#performanceChart .performance-series').count(),2);
 assert.match(await page.locator('#performanceBody [data-performance-row="robust-2026-10-2"]').innerText(),/Simulation depuis le 19 oct/);
 await page.locator('#performanceSlider').fill('0');
 assert.match(await page.locator('#performanceDate').innerText(),/19 oct/);
 assert.match(await page.locator('#performanceReadout').innerText(),/10\s000,00/);
 await page.locator('#performanceRobust').click();assert.equal(await page.locator('#performanceBody tr').count(),tracking.accounts.length);
 assert.equal(await page.locator('#performanceChart .performance-series').count(),D.robust_order.length+tracking.benchmarks.length);
 for(const k of D.robust_order)assert.ok((await page.locator('#performanceBody').innerText()).includes(D.results[k].name));
 await page.locator('#performanceAll').click();assert.equal(await page.locator('#performanceChart .performance-series').count(),tracking.accounts.filter(a=>a.history.length).length);
 await page.locator('#performanceNone').click();assert.equal(await page.locator('#performanceChart .performance-series').count(),0);
 for(const b of ['FEQT','VEQT','VGRO','VBAL']){await page.locator('#performanceBenchmark').selectOption(b);assert.match(await page.locator('#performanceGap').textContent(),new RegExp(b));}
 await page.locator('#performanceAll').click();
 const trackedDownload=page.waitForEvent('download');await page.locator('#performanceCsv').click();const dailyCsv=await trackedDownload;assert.match(dailyCsv.suggestedFilename(),/Suivi_quotidien/);const dailyContents=fs.readFileSync(await dailyCsv.path(),'utf8');assert.match(dailyContents,/simulation/);assert.match(dailyContents,/2026-10-19/);
 // An open tab must detect a missed close without a reload, then integrate
 // the next daily payload while retaining the user's portfolio/benchmark.
 const PU=require('../js/fnb-performance-utils.js');let next=new Date(tracking.as_of+'T12:00:00Z');
 do{next.setUTCDate(next.getUTCDate()+1);}while(!PU.tradingDay(next.toISOString().slice(0,10)));
 const nextDay=next.toISOString().slice(0,10);let comparison=tracking,requests=0,failRefresh=false;
 await page.route('**/data/fnb-comparison.json',async route=>{requests++;await route.fulfill({status:failRefresh?503:200,contentType:'application/json',body:JSON.stringify(comparison)});});
 await page.route('**/data/fnb-comparison-status.json',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({status:'current',as_of:comparison.as_of,expected_session:comparison.as_of})}));
 await page.locator('#performanceFocus').selectOption('savy-5');
 await page.clock.setSystemTime(new Date(nextDay+'T23:30:00Z'));await page.clock.runFor(300001);
 await page.waitForFunction(()=>document.querySelector('#performanceStatus').textContent.includes('Mise à jour en retard'));
 assert.ok(requests>=1);comparison=structuredClone(tracking);comparison.as_of=nextDay;
 for(const a of comparison.accounts)if(a.history.length)a.history.push({date:nextDay,value:a.history.at(-1).value*1.01});
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await page.waitForFunction(()=>document.querySelector('#performanceStatus').textContent.includes('Toutes les clôtures attendues'));
 assert.equal(await page.locator('#performanceFocus').inputValue(),'savy-5');assert.equal(await page.locator('#performanceBenchmark').inputValue(),'VBAL');
 assert.equal(await page.locator('#performanceChart .performance-series').count(),2);
 assert.match(await page.locator('#performanceDate').innerText(),new RegExp(String(next.getUTCDate())));
 failRefresh=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await page.waitForFunction(()=>document.querySelector('#performanceStatus').textContent.includes('Actualisation indisponible'));
 assert.equal(await page.locator('#performanceChart .performance-series').count(),2);
 await page.unroute('**/data/fnb-comparison.json');await page.unroute('**/data/fnb-comparison-status.json');
 await page.reload();await page.waitForSelector('html[data-ready="true"]');await page.locator('.nav [data-tab="performance"]').click();await page.waitForSelector('#performance[data-ready="true"]');
 assert.equal(await page.locator('#performanceBenchmark').inputValue(),'VBAL');
 await page.locator('.nav [data-tab="methods"]').click();await page.locator('.monthly-details summary').click();
 await page.waitForFunction(()=>document.querySelector('#monthlyHistory a'));
 const archive=await page.locator('#monthlyHistory a').first().getAttribute('href');
 await page.goto(archive);await page.waitForSelector('html[data-ready="true"]');
 await page.waitForFunction(()=>document.querySelector('#monthlyStatus').textContent.includes('Archive figée'));
 assert.equal(await page.evaluate(()=>JSON.parse(document.querySelector('#analysis').textContent).optimization.month),D.optimization.month);
 await page.goto(url+'/reports/fnb-history/baseline-2026-10-19.html');await page.waitForSelector('html[data-ready="true"]');
 assert.equal(await page.locator('#allPortfolioBody [data-open-portfolio]').count(),11);
 assert.equal(await page.locator('.monthly-proposal').count(),0);
 await page.goto(url+'/reports/portefeuilles-fnb.html');await page.waitForSelector('html[data-ready="true"]');
 for(const width of [768,375,320]){await page.setViewportSize({width,height:900});for(const view of ['allPortfolios','overview','exposures','portfolios','methods','performance','frontier','decision']){await page.locator('.nav [data-tab="'+view+'"]').click();if(view==='frontier')await page.waitForSelector('#frontier[data-ready="true"]',{timeout:90000});if(view==='overview'){await page.locator('#summaryFocus').selectOption('robust-2026-10-3');assert.equal(await page.locator('#growthSvg .wealth-line[data-portfolio="robust-2026-10-3"]').isVisible(),true);}if(view==='performance'){await page.locator('#performanceFocus').selectOption('savy-1');assert.equal(await page.locator('#performanceChart .performance-series').count(),2);}await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'FNB viewport overflow '+width+' '+view);}}
 assert.deepEqual(errors,[]);console.log(engine+': monthly proposal, all benchmarks/exposures, separate chart choices, exports, frozen archives and 320/375/768px passed.');await context.close();
}
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));for(const [name,type] of [['chromium',chromium],...(process.env.PORTAL_WEBKIT==='1'?[['webkit',webkit]]:[])]){const browser=await type.launch({headless:true});try{await check(browser,name);}finally{await browser.close();}}})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());

