"use strict";
// Real report, immutable archives, independent chart choices, exports and compact screens.
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),http=require("node:http");
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE_PATH||"playwright");
const root=path.resolve(__dirname,".."),D=JSON.parse(fs.readFileSync(path.join(root,"data/fnb-analysis.json"),"utf8"));
const server=http.createServer((req,res)=>{const p=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!p.startsWith(root+path.sep)||!fs.existsSync(p)||!fs.statSync(p).isFile()){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',p.endsWith('.html')?'text/html':p.endsWith('.json')?'application/json':p.endsWith('.css')?'text/css':'text/javascript');fs.createReadStream(p).pipe(res);});
async function check(browser,engine){
 const context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.route('https://**',r=>r.abort());
 const url='http://127.0.0.1:'+server.address().port;
 await page.goto(url+'/reports/portefeuilles-fnb.html');await page.waitForSelector('html[data-ready="true"]');
 assert.equal(await page.locator('.monthly-proposal').count(),0);
 assert.equal(await page.locator('[data-preference="proposal"]').count(),1);
 assert.equal(await page.locator('[data-preference="proposal"] .preference-rank').textContent(),'3');
 assert.equal(await page.locator('#allPortfolioBody [data-open-portfolio]').count(),12);
 await page.locator('#allPortfolios [data-open-portfolio="proposal"]').first().click();
 assert.equal(await page.locator('[data-fiche="proposal"]').isVisible(),true);
 assert.equal(await page.locator('[data-fiche="proposal"] [data-fund]').count(),Object.keys(D.results.proposal.weights).length);
 assert.equal(await page.locator('[data-fiche="proposal"] .holdings-section tbody tr').count(),10);
 assert.match(await page.locator('[data-fiche="proposal"]').innerText(),/100 % de l’allocation/);
 await page.locator('[data-fiche="proposal"] [data-open-exposure="proposal"]').click();
 assert.equal(await page.locator('#sectorFocus').inputValue(),'proposal');
 assert.equal(await page.locator('#geoValues tr').count(),D.geo_names.length);
 assert.equal(await page.locator('#sectorValues tr').count(),D.sector_names.length);
 for(const ref of ['FEQT','VEQT','VGRO','VBAL','FBAL','FGRO']){await page.locator('#referenceSelect').selectOption(ref);assert.equal(await page.locator('#geoSvg svg').count(),1);}
 await page.locator('.nav [data-tab="methods"]').click();await page.locator('#monthlyCharts').click();
 assert.equal(await page.locator('#overview').isVisible(),true);
 for(const chart of ['risk','growth']){assert.equal(await page.locator('#'+chart+'-series-proposal').isChecked(),true);}
 assert.equal(await page.locator('#riskSvg .risk-point:visible').count(),6);
 assert.equal(await page.locator('#growthSvg .wealth-line:visible').count(),6);
 await page.locator('#compass .chart-chooser summary').click();await page.locator('#risk-series-proposal').uncheck();await page.locator('#compass .chart-chooser summary').click();
 assert.equal(await page.locator('#riskSvg .risk-point:visible').count(),5);
 assert.equal(await page.locator('#growthSvg .wealth-line:visible').count(),6);
 await page.locator('#monthSlider').fill(String(D.dates.length));
 assert.ok((await page.locator('#monthLabel').innerText()).includes(D.assumptions.as_of.slice(0,4)));
 const csvEvent=page.waitForEvent('download');await page.locator('#monthlyCsv').click();const csv=await csvEvent;
 assert.match(csv.suggestedFilename(),/Mensuels\.csv$/);
 const contents=fs.readFileSync(await csv.path(),'utf8');assert.ok(contents.includes(D.results.proposal.name));
 assert.equal(contents.trim().split('\n').length,D.dates.length+1);
 await page.locator('.nav [data-tab="performance"]').click();await page.waitForSelector('#performance[data-ready="true"]');
 const tracking=JSON.parse(fs.readFileSync(path.join(root,'data/fnb-performance.json'),'utf8'));
 assert.equal(await page.locator('#performanceBody tr').count(),tracking.accounts.length);
 assert.equal(await page.locator('#performanceBenchmark option').count(),4);
 await page.locator('#performanceAll').click();assert.equal(await page.locator('#performanceChart .performance-series').count(),tracking.accounts.filter(a=>a.history.length).length);
 await page.locator('#performanceNone').click();assert.equal(await page.locator('#performanceChart .performance-series').count(),0);
 for(const b of ['FEQT','VEQT','VGRO','VBAL']){await page.locator('#performanceBenchmark').selectOption(b);assert.match(await page.locator('#performanceGap').textContent(),new RegExp(b));}
 await page.locator('#performanceAll').click();
 const trackedDownload=page.waitForEvent('download');await page.locator('#performanceCsv').click();assert.match((await trackedDownload).suggestedFilename(),/Suivi_quotidien/);
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
 for(const width of [768,375,320]){await page.setViewportSize({width,height:900});for(const view of ['allPortfolios','overview','exposures','portfolios','methods','performance']){await page.locator('.nav [data-tab="'+view+'"]').click();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'FNB viewport overflow '+width+' '+view);}}
 assert.deepEqual(errors,[]);console.log(engine+': monthly proposal, all benchmarks/exposures, separate chart choices, exports, frozen archives and 320/375/768px passed.');await context.close();
}
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));for(const [name,type] of [['chromium',chromium],...(process.env.PORTAL_WEBKIT==='1'?[['webkit',webkit]]:[])]){const browser=await type.launch({headless:true});try{await check(browser,name);}finally{await browser.close();}}})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
