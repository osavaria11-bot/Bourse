"use strict";
// All profiles and forecasts below are isolated synthetic test data.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const V=require('../js/valuation-utils.js'),root=path.resolve(__dirname,'..');
const config=V.universe(JSON.parse(fs.readFileSync(path.join(root,'data/valuation-universe.json'),'utf8')));
const dates=[],day=new Date('2026-07-01T12:00:00Z');while(dates.length<75){if(day.getUTCDay()>0&&day.getUTCDay()<6)dates.push(day.toISOString().slice(0,10));day.setUTCDate(day.getUTCDate()+1);}
function observations(offset=0){return dates.map((date,i)=>({date,observed_at:date+'T22:00:00Z',source_url:'https://example.com/consensus/',
  currency:'USD',price:100+offset+i*.3+Math.sin(i/3)*4,price_date:date,complete_session:true,fiscal_month:12,market_cap_millions:1000,
  enterprise_value_millions:1200,ev_bridge_date:'2025-12-31',
  forecasts:[{period_end:'2026-12-31',eps:5+i*.01,ebitda_millions:100+i*.2},{period_end:'2027-12-31',eps:6+i*.03,ebitda_millions:140+i*.2},{period_end:'2028-12-31',eps:8+i*.01,ebitda_millions:190+i*.3}]}));}
const histories=Object.fromEntries(['AAPL','NVDA','RY','MSFT','SNDKUS'].map((id,i)=>[id,{schema_version:1,kind:'savy_stock_valuation',id,financial:id==='RY',observations:observations(i*10)}]));
const index={schema_version:1,kind:'savy_valuations',generated_at:dates.at(-1)+'T22:00:00Z',instruments:config.instruments.map(i=>({...i,fetch_status:histories[i.id]?'fresh':'unavailable',latest:histories[i.id]?.observations.at(-1)||null}))};
const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname,file=path.resolve(root,'.'+(name==='/'?'/index.html':name));if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.json':'application/json','.html':'text/html'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);});
async function check(browser,engine){
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push({url:r.url(),body:r.postData()}));
  await page.route('https://**',r=>r.abort());
  await page.route('**/data/valuations/index.json?*',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(index)}));
  await page.route('**/data/valuations/*.json?*',r=>{
    const id=path.basename(new URL(r.request().url()).pathname,'.json');
    return id==='index'?r.fulfill({contentType:'application/json',body:JSON.stringify(index)}):histories[id]?r.fulfill({contentType:'application/json',body:JSON.stringify(histories[id])}):r.abort();
  });
  await page.addInitScript(()=>{
    const profiles={
      '':[{ticker:'AAPL',quantity:2},{ticker:'FEQT',quantity:1}],
      ':2':[{ticker:'RY',quantity:3},{ticker:'VBAL',quantity:1}],
      ':3':[{ticker:'MSFTCDR',quantity:4},{ticker:'SNDK',quantity:5},{ticker:'VGRO',quantity:1}]
    };
    for(const[suffix,positions]of Object.entries(profiles))localStorage.setItem('savy:private-holdings:v1'+suffix,JSON.stringify({schema_version:1,base_currency:'CAD',positions}));
  });
  await page.goto('http://127.0.0.1:'+server.address().port+'/#view=recherche&tab=valuation');
  await page.waitForFunction(()=>document.querySelector('#valuationPeChart svg'));
  assert.equal(await page.locator('#page-recherche .portal-tabs a').allTextContents().then(a=>a.join('|')),'Recherche & suivi|Valorisation|Archives');
  assert.match(await page.locator('#valuationMembership').innerText(),/3\/3 portefeuilles/);
  const privateResult=await page.evaluate(()=>window.SavyPortfolioStocks.list());
  assert.deepEqual(privateResult,{OS:['AAPL','FEQT'],JMC:['RY','VBAL'],MCL:['MSFTCDR','SNDK','VGRO']});
  assert.equal(JSON.stringify(privateResult).includes('quantity'),false);
  for(const[scope,expected]of[['OS',['AAPL']],['JMC',['RY']],['MCL',['MSFT','SNDKUS']]]){
    await page.locator('#valuationScope').selectOption(scope);
    const values=await page.locator('#valuationStock option').evaluateAll(nodes=>nodes.map(n=>n.value));assert.deepEqual(values,expected);
    await page.waitForFunction(scope=>document.querySelector('#valuationSourceNote').textContent.includes(({OS:'Apple',JMC:'Royal Bank',MCL:'Microsoft'})[scope]),scope);
    if(scope==='JMC')assert.match(await page.locator('#valuationEvNote').innerText(),/société financière/);
  }
  await page.locator('#valuationScope').selectOption('research');await page.locator('#valuationStock').selectOption('NVDA');
  await page.waitForFunction(()=>document.querySelector('#valuationSourceNote').textContent.includes('NVIDIA'));
  for(const id of ['NVDA','WMG','FIX','SN','SNDKUS'])assert.equal(await page.locator('#valuationStock option[value="'+id+'"]').count(),1);
  for(const id of ['FEQT','VFV','VGRO','VBAL'])assert.equal(await page.locator('#valuationStock option[value="'+id+'"]').count(),0);
  const fmt=(n,d=1)=>new Intl.NumberFormat('fr-CA',{minimumFractionDigits:d,maximumFractionDigits:d}).format(n);
  for(const horizon of[1,2]){
    await page.locator('[data-horizon="'+horizon+'"]').click();
    const expected=V.model(histories.NVDA,index.instruments.find(i=>i.id==='NVDA').latest,horizon,'5Y');
    await page.waitForFunction(text=>document.querySelector('[data-metric="pe"] .valuation-reading').textContent===text,fmt(expected.pe.latest)+'×');
    assert.equal(await page.locator('[data-metric="ev_ebitda"] .valuation-reading').innerText(),fmt(expected.ev_ebitda.latest)+'× ≈');
    for(const key of['pe','ev_ebitda']){
      const card=page.locator('[data-metric="'+key+'"]');assert.equal(await card.locator('.valuation-stats strong').first().innerText(),fmt(expected[key].latestRsi));
      assert.equal(await card.locator('svg path.valuation-line').count(),1);assert.equal(await card.locator('svg path.valuation-rsi-line').count(),1);
      await card.locator('svg').focus();await card.locator('svg').press('End');assert.match(await card.locator('.chart-tooltip').innerText(),/RSI du multiple/);
    }
  }
  assert.equal(await page.locator('.valuation-charts>article').count(),2);
  for(const width of[320,375,768,1440]){
    await page.setViewportSize({width,height:1000});
    await page.waitForFunction(()=>Math.abs(document.querySelector('#valuationPeChart svg').viewBox.baseVal.width-Math.max(300,document.querySelector('#valuationPeChart').clientWidth))<=1);
    const geometry=await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth,cards:[...document.querySelectorAll('.valuation-card')].map(n=>({x:n.getBoundingClientRect().left,right:n.getBoundingClientRect().right})),bad:[...document.querySelectorAll('.valuation-chart path')].some(n=>/NaN|Infinity/.test(n.getAttribute('d')))}));
    assert.ok(geometry.width<=width+1,engine+' overflow at '+width);assert.equal(geometry.bad,false);assert.ok(geometry.cards.every(c=>c.x>=0&&c.right<=width+1));
  }
  const before=await page.locator('[data-metric="pe"] .valuation-reading').innerText();
  await page.route('**/data/valuations/**',r=>r.abort());await page.locator('#valuationRefresh').click();
  await page.waitForFunction(()=>!document.querySelector('#valuationRefresh').disabled);
  assert.equal(await page.locator('[data-metric="pe"] .valuation-reading').innerText(),before);
  assert.equal(requests.some(r=>(r.body||'').includes('quantity')||(r.body||'').includes('average_cost')),false);
  assert.deepEqual(errors,[]);await context.close();console.log(engine+': valuation panels, RSI of ratios, 3 private profiles, CDRs, dates, cache and mobile layouts passed');
}
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));try{for(const engine of['chromium','webkit']){const browser=await({chromium,webkit}[engine]).launch({headless:true});try{await check(browser,engine);}finally{await browser.close();}}}finally{server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
