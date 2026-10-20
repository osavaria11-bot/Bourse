"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),http=require("node:http");
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE_PATH||"playwright"),U=require("../js/fnb-frontier-utils.js");
const root=path.resolve(__dirname,".."),D=JSON.parse(fs.readFileSync(path.join(root,"data/fnb-analysis.json"),"utf8")),original=JSON.stringify(D);
const server=http.createServer((req,res)=>{const pathname=new URL(req.url,"http://localhost").pathname,f=path.resolve(root,"."+(pathname==='/'?'/index.html':pathname));if(!f.startsWith(root+path.sep)||!fs.existsSync(f)||!fs.statSync(f).isFile()){res.writeHead(404);return res.end();}res.setHeader("Content-Type",f.endsWith(".html")?"text/html":f.endsWith(".css")?"text/css":f.endsWith(".js")?"text/javascript":"application/json");fs.createReadStream(f).pipe(res);});
async function check(browser,engine){
 const ctx=await browser.newContext({viewport:{width:1440,height:960},acceptDownloads:true}),page=await ctx.newPage(),errors=[];page.on("pageerror",e=>errors.push(e.message));await page.route("https://**",r=>r.abort());
 const url="http://127.0.0.1:"+server.address().port;
 await page.goto(url+"/reports/portefeuilles-fnb.html");assert.equal(await page.locator('#frontier[data-ready]').count(),0,"Laboratory computes lazily");
 await page.locator('.nav [data-tab="frontier"]').click();await page.waitForSelector('#frontier[data-ready="true"]',{timeout:90000});
 const weights=async()=>JSON.parse(await page.locator('#frontier').getAttribute('data-weights'));
 const valid=async cap=>{const w=Object.values(await weights());assert.ok(U.weightsOK(w,cap));assert.equal(await page.locator('#frontierTotal').textContent(),'100,0 %');};
 await valid(.4);assert.equal(await page.locator('#frontierWeights tr').count(),8);assert.equal(await page.locator('#frontierFundChoices input').count(),D.optimization.eligible_funds.length);assert.equal(await page.locator('#frontierSources tr').count(),8);
 assert.ok((await page.locator('#frontierDates').textContent()).includes('2025-10 → 2026-09'));
 await page.locator('#frontierMaxSharpe').click();const sr=JSON.parse(await page.locator('#frontier').getAttribute('data-metrics'));await page.locator('#frontierMaxIR').click();const ir=JSON.parse(await page.locator('#frontier').getAttribute('data-metrics'));
 assert.ok(sr.sharpe>ir.sharpe);assert.ok(ir.information>sr.information);await valid(.4);
 const p=U.prepare(D);
 const actual=await weights(),metrics=U.metrics(p.fit,p.ids.map(id=>actual[id]));assert.ok(Math.abs(metrics.information-ir.information)<1e-10);
 await page.locator('#frontierBalanced').click();await page.locator('#frontierPriority').fill('80');assert.equal(await page.locator('#frontierBalanced').getAttribute('aria-pressed'),'true');await valid(.4);
 await page.locator('#frontierWeight0').fill('10');await valid(.4);assert.ok(Math.abs((await weights())[p.ids[0]]-.1)<1e-8);
 await page.locator('#frontierMode').selectOption('active');assert.match(await page.locator('#frontierPlot svg').getAttribute('aria-label'),/Tracking/);
 const before=JSON.stringify(await weights()),box=await page.locator('#frontierPlot svg').boundingBox();await page.mouse.move(box.x+box.width*.8,box.y+box.height*.3);await page.mouse.down();await page.mouse.move(box.x+box.width*.35,box.y+box.height*.65,{steps:6});await page.mouse.up();assert.notEqual(JSON.stringify(await weights()),before);await valid(.4);
 for(const mode of ['risk','active','ratios']){await page.locator('#frontierMode').selectOption(mode);assert.equal(await page.locator('#frontierPlot svg').count(),1);await page.locator('#frontierTrace').fill('5');await valid(.4);}
 const event=page.waitForEvent('download');await page.locator('#frontierExport').click();const file=await event,data=JSON.parse(fs.readFileSync(await file.path(),'utf8'));assert.equal(data.kind,'savy_frontier_local_simulation');assert.equal(data.validation.length,12);assert.equal(data.benchmark,'VEQT');
 await page.locator('.frontier-settings-panel>summary').click();await page.locator('#frontierCap').selectOption('0.25');await page.waitForSelector('#frontier[data-ready="true"]',{timeout:90000});await valid(.25);
 await page.locator('#frontierSample').selectOption('all');await page.waitForSelector('#frontier[data-ready="true"]',{timeout:90000});assert.match(await page.locator('#frontierMeanTest').textContent(),/Sans validation/);await valid(.25);
 await page.locator('#frontierUniverse>summary').click();await page.locator('[data-frontier-include="VEQT"]').check();await page.waitForSelector('#frontier[data-ready="true"]',{timeout:90000});assert.equal(await page.locator('#frontierWeights tr').count(),9);await valid(.25);
 await page.locator('[data-frontier-fund="VEQT"] input').fill('10');await valid(.25);await page.locator('[data-frontier-include="VEQT"]').uncheck();await page.waitForSelector('#frontier[data-ready="true"]',{timeout:90000});assert.equal(await page.locator('#frontierWeights tr').count(),8);await valid(.25);
 await page.locator('#frontierUniverse>summary').click();await page.locator('.frontier-settings-panel>summary').click();
 for(const width of [768,390,375,320]){await page.setViewportSize({width,height:900});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),engine+' frontier overflow '+width);assert.ok(await page.locator('#frontierPlot svg').evaluate(n=>n.getBoundingClientRect().width<=innerWidth));}
 if(process.env.QA_SCREENSHOTS_DIR){fs.mkdirSync(process.env.QA_SCREENSHOTS_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.QA_SCREENSHOTS_DIR,engine+'-frontier-mobile.png')});}
 await page.reload();await page.locator('.nav [data-tab="frontier"]').click();await page.waitForSelector('#frontier[data-ready="true"]',{timeout:90000});assert.equal(await page.locator('#frontierCap').inputValue(),'0.25');await valid(.25);
 assert.equal(await page.locator('#analysis').evaluate(n=>JSON.stringify(JSON.parse(n.textContent))),original,"No stored portfolio data changes");
 await page.setViewportSize({width:390,height:844});await page.goto(url+'/index.html#view=analyses&tab=overview');const frame=page.frameLocator('#fundAnalysisFrame');await frame.locator('html[data-ready="true"]').waitFor();await frame.locator('.nav [data-tab="frontier"]').click();await frame.locator('#frontier[data-ready="true"]').waitFor({timeout:90000});
 await page.waitForFunction(()=>{const f=document.getElementById('fundAnalysisFrame');return Math.abs(f.clientHeight-Math.ceil(f.contentDocument.querySelector('.wrap').getBoundingClientRect().height)-1)<2;});
 assert.equal(await frame.locator('.frontier-metrics').evaluate(n=>getComputedStyle(n).gridTemplateColumns.split(' ').length),2,'Readable two-column mobile metrics');
 assert.ok(await frame.locator('html').evaluate(n=>n.scrollHeight<=n.clientHeight+2),'One outer page, no nested vertical scrolling');
 if(process.env.QA_SCREENSHOTS_DIR)await page.screenshot({path:path.join(process.env.QA_SCREENSHOTS_DIR,engine+'-frontier-integrated-390.png')});
 assert.deepEqual(errors,[]);console.log(engine+': frontier worker, weights, drag/slider, distinct Sharpe/IR, validation, cap, export, persistence and 320/375/390/768px passed.');await ctx.close();
}
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));for(const [engine,type] of [['chromium',chromium],...(process.env.PORTAL_WEBKIT==='1'?[['webkit',webkit]]:[])]){const browser=await type.launch({headless:true});try{await check(browser,engine);}finally{await browser.close();}}})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
