"use strict";
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright'),U=require('../js/macro-utils.js');
const root=path.resolve(__dirname,'..'),load=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const prices=load('data/security-prices.json'),catalog=load('data/securities.json'),day=prices.series.find(p=>p.id==='AAPL').history.at(-1)[0];
const next=new Date(Date.parse(day+'T12:00:00Z')+86400000).toISOString().slice(0,10),now=Date.parse(next+'T13:20:00Z');
const close=day+'T20:00:00Z',pre=next+'T13:15:00Z',post=day+'T23:55:00Z';
// The session clock is synthetic. A repository price file can have been
// downloaded later on the same day than this fixture's 09:20 premarket clock.
// Align only fixture collection metadata; keep all real closing inputs intact.
const fixturePrices=structuredClone(prices),fixtureCollected=new Date(now-60000).toISOString();
fixturePrices.generated_at=fixtureCollected;fixturePrices.last_successful_update=fixtureCollected;
for(const row of fixturePrices.series)if(row.last_successful_fetch)row.last_successful_fetch=fixtureCollected;
const profiles={1:[['AAPL',2],['SHOP',1]],2:[['MSFT',1],['VBAL',10]],3:[['NVDA',3],['VGRO',4]]};
for(const key of Object.keys(profiles))profiles[key]=profiles[key].map(([ticker,quantity])=>({ticker,quantity,currency:catalog.series.find(p=>p.id===ticker).currency}));
const base=id=>prices.series.find(p=>p.id===id)?.history.filter(r=>r[0]===day).at(-1)?.[1]||100;
function quote(id,symbol,currency,price,extended){return {id,quote_symbol:symbol,currency,price,previous_close:price,
  timestamp:close,fetched_at:new Date(now).toISOString(),session_date:day,exchange_timezone:'America/New_York',market_state:'closed',
  session_start:day+'T13:30:00Z',session_end:close,fetch_status:'fresh',intraday_history:[[day+'T19:55:00Z',price],[close,price]],
  ...(extended?{extended_hours:{pre:{price:price*1.01,timestamp:pre,session_date:next,start:next+'T08:00:00Z',end:next+'T13:30:00Z',baseline_price:price,baseline_session_date:day,baseline_timestamp:close,fetched_at:new Date(now).toISOString(),fetch_status:'fresh',observation_kind:'candle_close'},
    post:{price:price*.99,timestamp:post,session_date:day,start:close,end:next+'T00:00:00Z',baseline_price:price,baseline_session_date:day,baseline_timestamp:close,fetched_at:new Date(now).toISOString(),fetch_status:'fresh',observation_kind:'candle_close'}}}: {})};}
const ids=[...new Set(Object.values(profiles).flat().map(p=>p.ticker).concat(['FEQT']))];
const quotes=ids.map(id=>{const d=catalog.series.find(p=>p.id===id);return quote(id,d.quote_symbol,d.currency,base(id),d.currency==='USD');});
for(const [id,symbol] of [['EXTSPX','SPY'],['EXTIXIC','QQQ'],['EXTTSX','EWC'],['EXTSTOXX','IEUR']])quotes.push(quote(id,symbol,'USD',100,true));
quotes.push({...quote('USDCAD','CAD=X','CAD',1.4,false),timestamp:pre,session_date:next,intraday_sessions:{[day]:[[close,1.4],[post,1.4]],[next]:[[pre,1.4]]}});
const snapshot={schema_version:1,kind:'intraday_quotes',generated_at:new Date(now).toISOString(),quotes};let offline=false;
const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname;
  if(name==='/data/security-prices.json'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(fixturePrices));return;}
  if(name==='/data/intraday-quotes.json'){res.writeHead(offline?503:200,{'Content-Type':'application/json'});res.end(offline?'{}':JSON.stringify(snapshot));return;}
  const file=path.resolve(root,'.'+(name==='/'?'/index.html':name));if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);});
async function main(){await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
  try{browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));await page.route('https://**',r=>r.abort());
    await page.addInitScript(({profiles,now})=>{Date.now=()=>now;for(const [id,positions]of Object.entries(profiles))localStorage.setItem('savy:private-holdings:v1'+(id==='1'?'':':'+id),JSON.stringify({schema_version:1,positions}));},{profiles,now});
    await page.goto('http://127.0.0.1:'+server.address().port);
    await page.waitForFunction(()=>window.SavyLiveQuotes?.dataset()?.quotes.some(q=>q.id==='EXTSPX'));
    await page.locator('.portal-nav [data-page="marches"]').click();await page.locator('#marketSelect').selectOption('SPX');
    const index=page.locator('.market-card[data-id="SPX"] .extended-hours');assert.match(await index.innerText(),/SPY/);assert.match(await index.innerText(),/≈ \+1,00 %/);
    assert.equal(await index.locator('svg').count(),0);
    await page.locator('.portal-nav [data-page="portefeuilles"]').click();
    for(const id of ['1','2','3']){if(id!=='1')await page.locator('[data-portfolio-id="'+id+'"]').click();
      await page.waitForFunction(id=>document.querySelector('#portfolio').dataset.portfolio===id,id);
      const positions=profiles[id],total=positions.reduce((s,p)=>s+p.quantity*base(p.ticker)*(p.currency==='USD'?1.4:1),0),usd=positions.filter(p=>p.currency==='USD').reduce((s,p)=>s+p.quantity*base(p.ticker)*1.4,0);
      // The profile label is available before the asynchronous closing-price
      // file. Wait for the calculated output rather than racing initialization.
      await page.waitForFunction(({id,expected})=>document.querySelector('#portfolio').dataset.portfolio===id&&document.querySelector('#portfolioExtendedHours [data-extended-phase="pre"] strong')?.textContent===expected,{id,expected:'≈ +'+U.formatNumber(usd/total,2)+' %'});
      const text=await page.locator('#portfolioExtendedHours').innerText();assert.match(text,/Prémarché/);assert.match(text,/Après clôture/);
      const preText=await page.locator('#portfolioExtendedHours [data-extended-phase="pre"] strong').innerText();
      assert.equal(preText,'≈ +'+U.formatNumber(usd/total,2)+' %');
      assert.equal(await page.locator('#portfolioExtendedHours [data-extended-phase="post"] strong').innerText(),'≈ '+U.formatNumber(-usd/total,2)+' %');
      assert.match(text,/% couvert/);assert.equal(await page.locator('#portfolioExtendedHours svg').count(),0);
    }
    for(const width of [1440,768,375,320]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Overflow at '+width);}
    const before=await page.locator('#portfolioExtendedHours').innerText();offline=true;await page.evaluate(()=>window.SavyLiveQuotes.refresh());assert.equal(await page.locator('#portfolioExtendedHours').innerText(),before);
    assert.deepEqual(errors,[]);console.log('Pre/post percentages verified: all three portfolios, dated proxy indices, actual CAD weights, coverage, offline retention and 320–1440px; no new charts.');
  }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}}
main().catch(e=>{console.error(e);process.exitCode=1;});
