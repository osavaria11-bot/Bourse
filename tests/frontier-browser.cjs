"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),http=require("node:http");
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE_PATH||"playwright"),U=require("../js/fnb-frontier-utils.js");
const root=path.resolve(__dirname,".."),D=JSON.parse(fs.readFileSync(path.join(root,"data/fnb-analysis.json"),"utf8")),original=JSON.stringify(D),E=U.extend(D,fs.existsSync(path.join(root,"data/fnb-frontier-universe.json"))?JSON.parse(fs.readFileSync(path.join(root,"data/fnb-frontier-universe.json"),"utf8")):null);
const server=http.createServer((req,res)=>{const pathname=new URL(req.url,"http://localhost").pathname,f=path.resolve(root,"."+(pathname==='/'?'/index.html':pathname));if(!f.startsWith(root+path.sep)||!fs.existsSync(f)||!fs.statSync(f).isFile()){res.writeHead(404);return res.end();}res.setHeader("Content-Type",f.endsWith(".html")?"text/html":f.endsWith(".css")?"text/css":f.endsWith(".js")?"text/javascript":"application/json");fs.createReadStream(f).pipe(res);});
async function check(browser,engine){
 const ctx=await browser.newContext({viewport:{width:1440,height:960},acceptDownloads:true}),page=await ctx.newPage(),errors=[];page.on("pageerror",e=>errors.push(e.message));await page.route("https://**",r=>r.abort());
 const url="http://127.0.0.1:"+server.address().port;
 const legacyKey="savy:fnb-frontier:v2:"+E.assumptions.as_of+":"+E.optimization.source_digest,legacy={ids:Object.keys(D.results.proposal.weights),weights:D.results.proposal.weights,cap:.35,sample:"split",mode:"risk",priority:.5};
 await ctx.addInitScript(({key,value})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(value));},{key:legacyKey,value:legacy});
 await page.goto(url+"/reports/portefeuilles-fnb.html");assert.equal(await page.locator('#frontier[data-ready]').count(),0,"Laboratory computes lazily");
 await page.locator('.nav [data-tab="frontier"]').click();await page.waitForSelector('#frontier[data-ready="true"]',{timeout:90000});
 const weights=async()=>JSON.parse(await page.locator('#frontier').getAttribute('data-weights'));
 const valid=async cap=>{const actual=await weights(),w=Object.values(actual);assert.ok(U.weightsOK(w,cap));for(const [id,v] of Object.entries(actual))assert.ok(v<=Math.min(cap,E.frontier_caps[id])+1e-8,id+" exceeds its fund limit");assert.equal(await page.locator('#frontierTotal').textContent(),'100,0 %');};
 await valid(.35);assert.equal(await page.locator("#frontierWeights tr").count(),E.optimization.eligible_funds.length);assert.equal(await page.locator("#frontierFundChoices input").count(),E.optimization.eligible_funds.length);assert.equal(await page.locator("#frontierSources tr").count(),E.optimization.eligible_funds.length);assert.equal(await page.locator('[data-frontier-include="VEQT"]').count(),0);
 assert.match(await page.locator("#frontierAssetMix").textContent(),/crypto .*3 % maximum/);
 for(const id of ["FEQT","CGL.C","RUD","VEE"]){assert.equal(await page.locator(`[data-frontier-include="${id}"]`).isChecked(),true,id+" enabled after restoring legacy selection");assert.equal(await page.locator(`[data-frontier-fund="${id}"]`).isVisible(),true,id+" allocation row visible");}
 const restored=await weights(),expected=U.allocate(U.prepare(E,{cap:.35}),E.optimization.eligible_funds.map(id=>legacy.weights[id]||0));E.optimization.eligible_funds.forEach((id,i)=>assert.ok(Math.abs(restored[id]-expected[i])<1e-9,"Legacy weights preserved for "+id));
 for(const [id,max] of [["CGL.C","5"],["XIT","10"],["ZEB","10"]])assert.equal(await page.locator(`[data-frontier-fund="${id}"] input`).getAttribute("max"),max,id+" slider limit");
 assert.equal(await page.locator("#frontierShowZeros").isChecked(),true,"All candidate funds are visible by default");
 assert.equal(await page.locator("#frontierWeights tr:visible").count(),E.optimization.eligible_funds.length);
 await page.locator("#frontierShowZeros").uncheck();
 assert.equal(await page.locator("#frontierWeights tr:visible").count(),Object.values(await weights()).filter(v=>v>.00005).length,"Compact view hides only zero weights");
 await page.locator("#frontierShowZeros").check();
 assert.equal(await page.locator("#frontierWeights tr:visible").count(),E.optimization.eligible_funds.length);

 const previousWeights=Object.fromEntries(Object.entries(restored).map(([id,w])=>[id,w*.7]));previousWeights["CGL.C"]+=.3;
 await page.evaluate(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:legacyKey.replace(":v2:",":v3:"),value:{...legacy,ids:E.optimization.eligible_funds,weights:previousWeights}});
 await page.reload();await page.locator('.nav [data-tab="frontier"]').click();await page.waitForSelector('#frontier[data-ready="true"]',{timeout:90000});await valid(.35);assert.ok(Math.abs((await weights())["CGL.C"]-.05)<1e-8,"Existing gold allocations are reduced to the new 5% limit");

 assert.ok((await page.locator('#frontierDates').textContent()).includes('2025-10 → 2026-09'));
 await page.locator('#frontierMaxSharpe').click();const sr=JSON.parse(await page.locator('#frontier').getAttribute('data-metrics'));await page.locator('#frontierMaxIR').click();const ir=JSON.parse(await page.locator('#frontier').getAttribute('data-metrics'));
 assert.ok(sr.sharpe>ir.sharpe);assert.ok(ir.information>sr.information);await valid(.35);
 const p=U.prepare(E,{cap:.35});
 const actual=await weights(),metrics=U.metrics(p.fit,p.ids.map(id=>actual[id]));assert.ok(Math.abs(metrics.information-ir.information)<1e-10);
 await page.locator('#frontierBalanced').click();await page.locator('#frontierPriority').fill('80');assert.equal(await page.locator('#frontierBalanced').getAttribute('aria-pressed'),'true');await valid(.35);
 await page.locator("#frontierShowZeros").check();
 for(const id of ["FEQT","CGL.C","RUD","VEE"]){
  const target=id==="CGL.C"?4:10;await page.locator(`[data-frontier-fund="${id}"] input`).fill(String(target));await valid(.35);const w=await weights(),e=JSON.parse(await page.locator("#frontier").getAttribute("data-exposures"));assert.ok(e.valid);assert.ok(w[id]>target*.009,id+" participates in calculations");
  const m=U.metrics(p.fit,p.ids.map(name=>w[name])),shown=JSON.parse(await page.locator("#frontier").getAttribute("data-metrics"));assert.ok(Math.abs(shown.mean-m.mean)<1e-10);
  if(id==="CGL.C"){assert.ok(Math.abs(e.assets.gold-w[id])<1e-10);assert.match(await page.locator("#frontierAssetMix").textContent(),/or physique/);}
  if(id==="FEQT"){assert.ok(Math.abs(e.assets.crypto-w[id]*D.universe.crypto.FEQT)<1e-10);assert.match(await page.locator("#frontierAssetMix").textContent(),/crypto/);}
 }
 for(const id of ["XIT","ZEB"]){await page.locator(`[data-frontier-fund="${id}"] input`).fill("10");await valid(.35);assert.ok((await weights())[id]>.095,id+" can now exceed the old 5% limit");}
 await page.locator('#frontierMode').selectOption('active');assert.match(await page.locator('#frontierPlot svg').getAttribute('aria-label'),/Tracking/);
 await page.locator('#frontierPlot svg').scrollIntoViewIfNeeded();
 const before=JSON.stringify(await weights()),box=await page.locator('#frontierPlot svg').boundingBox();await page.mouse.move(box.x+box.width*.8,box.y+box.height*.3);await page.mouse.down();await page.mouse.move(box.x+box.width*.35,box.y+box.height*.65,{steps:6});await page.mouse.up();assert.notEqual(JSON.stringify(await weights()),before);await valid(.35);
 for(const mode of ['risk','active','ratios']){await page.locator('#frontierMode').selectOption(mode);assert.equal(await page.locator('#frontierPlot svg').count(),1);await page.locator('#frontierTrace').fill('5');await valid(.35);}
 const event=page.waitForEvent('download');await page.locator('#frontierExport').click();const file=await event,data=JSON.parse(fs.readFileSync(await file.path(),'utf8'));assert.equal(data.kind,'savy_frontier_local_simulation');assert.equal(data.validation.length,12);assert.equal(data.benchmark,'VEQT');assert.equal(data.constraints.crypto_cap,.03);assert.ok(data.exposures.assets.crypto<=.03+1e-8);
 await page.locator('.frontier-settings-panel>summary').click();await page.locator('#frontierCap').selectOption('0.25');await page.waitForSelector('#frontier[data-ready="true"]',{timeout:90000});await valid(.25);
 await page.locator('#frontierSample').selectOption('all');await page.waitForSelector('#frontier[data-ready="true"]',{timeout:90000});assert.match(await page.locator('#frontierMeanTest').textContent(),/Sans validation/);await valid(.25);
 await page.locator('#frontierUniverse>summary').click();await page.locator('[data-frontier-include="FCMO"]').uncheck();await page.waitForSelector('#frontier[data-ready="true"]',{timeout:90000});assert.equal(await page.locator('#frontierWeights tr').count(),E.optimization.eligible_funds.length-1);await valid(.25);
 await page.locator('[data-frontier-include="FCMO"]').check();await page.waitForSelector('#frontier[data-ready="true"]',{timeout:90000});assert.equal(await page.locator('#frontierWeights tr').count(),E.optimization.eligible_funds.length);await valid(.25);
 await page.locator('#frontierUniverse>summary').click();await page.locator('.frontier-settings-panel>summary').click();
 for(const width of [768,390,375,320]){await page.setViewportSize({width,height:900});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),engine+' frontier overflow '+width);assert.ok(await page.locator('#frontierPlot svg').evaluate(n=>n.getBoundingClientRect().width<=innerWidth));}
 if(process.env.QA_SCREENSHOTS_DIR){fs.mkdirSync(process.env.QA_SCREENSHOTS_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.QA_SCREENSHOTS_DIR,engine+'-frontier-mobile.png')});}
 await page.reload();await page.locator('.nav [data-tab="frontier"]').click();await page.waitForSelector('#frontier[data-ready="true"]',{timeout:90000});assert.equal(await page.locator('#frontierCap').inputValue(),'0.25');await valid(.25);
 await page.locator(".frontier-settings-panel>summary").click();await page.locator("#frontierUniverse>summary").click();await page.locator('[data-frontier-include="CGL.C"]').uncheck();await page.waitForSelector('#frontier[data-ready="true"]',{timeout:90000});
 await page.reload();await page.locator('.nav [data-tab="frontier"]').click();await page.waitForSelector('#frontier[data-ready="true"]',{timeout:90000});assert.equal(await page.locator("#frontierWeights tr").count(),E.optimization.eligible_funds.length-1,"Current selections survive reload");
 await page.locator(".frontier-settings-panel>summary").click();await page.locator("#frontierAllFunds").click();await page.waitForSelector('#frontier[data-ready="true"]',{timeout:90000});assert.equal(await page.locator("#frontierWeights tr:visible").count(),30);await valid(.25);
 assert.equal(await page.locator('#analysis').evaluate(n=>JSON.stringify(JSON.parse(n.textContent))),original,"No stored portfolio data changes");
 await page.setViewportSize({width:390,height:844});await page.goto(url+'/index.html#view=analyses&tab=overview');const frame=page.frameLocator('#fundAnalysisFrame');await frame.locator('html[data-ready="true"]').waitFor();await frame.locator('.nav [data-tab="frontier"]').click();await frame.locator('#frontier[data-ready="true"]').waitFor({timeout:90000});
 await page.waitForFunction(()=>{const f=document.getElementById('fundAnalysisFrame');return Math.abs(f.clientHeight-Math.ceil(f.contentDocument.querySelector('.wrap').getBoundingClientRect().height)-1)<2;});
 assert.equal(await frame.locator('.frontier-metrics').evaluate(n=>getComputedStyle(n).gridTemplateColumns.split(' ').length),2,'Readable two-column mobile metrics');
 assert.ok(await frame.locator('html').evaluate(n=>n.scrollHeight<=n.clientHeight+2),'One outer page, no nested vertical scrolling');
 if(process.env.QA_SCREENSHOTS_DIR)await page.screenshot({path:path.join(process.env.QA_SCREENSHOTS_DIR,engine+'-frontier-integrated-390.png')});
 assert.deepEqual(errors,[]);console.log(engine+': 30 funds including FEQT/CGL.C/RUD/VEE, actual asset mix, legacy migration, worker, drag/slider, distinct Sharpe/IR, validation, cap, export, persistence and 320/375/390/768px passed.');await ctx.close();
}
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));for(const [engine,type] of [['chromium',chromium],...(process.env.PORTAL_WEBKIT==='1'?[['webkit',webkit]]:[])]){const browser=await type.launch({headless:true});try{await check(browser,engine);}finally{await browser.close();}}})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
