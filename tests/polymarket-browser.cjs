"use strict";
const {componentPage} = require("./portal-navigation.cjs");
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||"playwright");
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),http=require("node:http"),fixture=require("./polymarket-fixture.cjs");
const root=path.resolve(__dirname,".."), initial=fixture(); let mode="fresh";
const mime={".html":"text/html",".js":"text/javascript",".css":"text/css",".json":"application/json"};
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,"http://localhost");
  if(url.pathname==="/data/polymarket.json") {
    const data=structuredClone(initial);
    if(mode==="older") {
      data.generated_at=new Date(Date.parse(initial.generated_at)-3600000).toISOString();
      for(const group of Object.values(data.groups)) group.fetched_at=data.generated_at;
      data.groups.finance.events[0].outcomes[0].probability=.01;
    }
    if(mode==="partial") data.groups.popular={ranking:"volume24hr",fetch_status:"unavailable",fetched_at:null,events:[]};
    if(mode==="invalid") data.groups.finance.events[0].url="javascript:bad";
    res.writeHead(mode==="offline"?503:200,{"Content-Type":"application/json"});res.end(JSON.stringify(data));return;
  }
  const filename=path.resolve(root,"."+(url.pathname==="/"?"/index.html":url.pathname));
  if(!filename.startsWith(root+path.sep)||!fs.existsSync(filename)||!fs.statSync(filename).isFile()){res.writeHead(404);res.end();return;}
  res.writeHead(200,{"Content-Type":mime[path.extname(filename)]||"application/octet-stream"});fs.createReadStream(filename).pipe(res);
});
async function main(){
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const browser=await chromium.launch({headless:true});
  try {
    const page=await componentPage(browser,{viewport:{width:1440,height:1000}}),errors=[],url="http://127.0.0.1:"+server.address().port;
    page.on("pageerror",e=>errors.push(e.message));await page.route("https://**",r=>r.abort());await page.goto(url + "/#polymarket");
    await page.waitForFunction(()=>document.querySelectorAll(".polymarket-card[data-event-id]").length===10);
    assert.equal(await page.locator("#polymarket").evaluate(n=>n.closest("#page-polymarket") !== null),true);
    assert.deepEqual(await page.locator(".polymarket-card").evaluateAll(nodes=>nodes.map(n=>n.dataset.group)),["finance","finance","finance","popular","popular","popular","popular","popular","trending","trending"]);
    for(const [i,card]of(await page.locator(".polymarket-card").all()).entries()){
      assert.equal(await card.locator("h3 a").getAttribute("href"),"https://polymarket.com/event/synthetic-event-"+(i+1));
      assert.equal(await card.locator("h3 a").getAttribute("target"),"_blank");
      assert.equal(await card.locator("time").getAttribute("datetime"),initial.groups.finance.fetched_at);
      assert.match(await card.locator(".polymarket-outcomes").innerText(),/Scenario A\s+65 %/);
    }
    for(const width of [1440,800,375,320]){
      await page.setViewportSize({width,height:1000});
      for(let theme=0;theme<2;theme++){
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,"page overflow at "+width);
        const layout=await page.locator("#polymarketRow").evaluate(n=>({width:n.clientWidth,scroll:n.scrollWidth,tops:[...n.children].map(x=>x.offsetTop)}));
        const columns=width>1000?5:width>650?3:2;
        assert.equal(new Set(layout.tops).size,Math.ceil(10/columns),"responsive grid rows at "+width);
        assert.equal(layout.tops.filter(top=>top===layout.tops[0]).length,columns,"cards per row at "+width);
        assert.equal(layout.scroll>layout.width,false,"no horizontal scrolling is needed at "+width);
        await page.locator("#themeToggle").click();
      }
    }
    for(const nextMode of ["older","partial","invalid"]){
      mode=nextMode;await page.locator("#refreshButton").click();
      await page.waitForFunction(()=>document.getElementById("polymarketStatus").textContent.includes("Derniers"));
      assert.equal(await page.locator(".polymarket-card[data-event-id]").count(),10);
      assert.match(await page.locator(".polymarket-card").first().locator(".polymarket-outcomes").innerText(),/65 %/);
    }
    mode="offline";await page.reload();
    await page.waitForFunction(()=>document.querySelector(".polymarket-time")?.textContent.includes("conservé"));
    assert.equal(await page.locator(".polymarket-card[data-event-id]").count(),10);
    const empty=await componentPage(browser,);await empty.route("https://**",r=>r.abort());await empty.goto(url);
    await empty.waitForFunction(()=>document.getElementById("polymarketStatus").textContent.includes("indisponibles"));
    assert.equal(await empty.locator(".polymarket-card h3 a").count(),0);assert.equal(await empty.locator(".polymarket-outcomes").count(),0);
    assert.deepEqual(errors,[]);
    console.log("Polymarket verified: 3 Finance + 5 Politics + 2 broad popular events, source links and scenarios, dedicated page placement, five desktop columns, compact responsive rows, dated outage, partial cache and older snapshot rejection.");
  }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
