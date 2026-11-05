'use strict';
// Synthetic recipient, reports and PDF only; never use an owner's access link.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright'),C=require('../js/committee-crypto-utils.js');
const root=path.resolve(__dirname,'..'),types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.pdf':'application/pdf','.woff2':'font/woff2','.png':'image/png'};
(async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'savy-committee-browser-'));let server;
  try{
    const pair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
    const jwk=await crypto.subtle.exportKey('jwk',pair.privateKey),pub=C.publicJwk(jwk),token=C.b64(Buffer.from(JSON.stringify(jwk)));
    const config={key_id:await C.fingerprint(pub),public_key:pub};fs.writeFileSync(path.join(folder,'recipient.json'),JSON.stringify(config));
    const pdf=Buffer.from('%PDF-1.7\nSynthetic committee test, no owner information');fs.writeFileSync(path.join(folder,'report.pdf'),pdf);
    for(const date of ['2026-10-29','2026-11-05']){
      const sections=Object.fromEntries(['summary','os','jmc','mcl','comparison','optimization','recommendations','follow_up','outlook','methodology'].map(k=>[k,'## Comité automatique de test '+date+'\n\nAnalyse complète **'+k+'**.\n\n| Actif | Avis |\n| --- | --- |\n| TEST | Conserver |\n\n<img src="https://outside.example/pixel">']));
      fs.writeFileSync(path.join(folder,'report.json'),JSON.stringify({schema_version:1,date,data_date:date,finviz_date:date,sections}));
      execFileSync('python',['scripts/encrypt_committee.py','--report',path.join(folder,'report.json'),'--pdf',path.join(folder,'report.pdf'),'--public-key',path.join(folder,'recipient.json'),'--output-dir',folder],{cwd:root,stdio:'pipe'});
    }
    server=http.createServer((req,res)=>{
      const name=new URL(req.url,'http://localhost').pathname;
      const file=name==='/data/committee-reports.json'?path.join(folder,'committee-reports.json'):name.startsWith('/data/committee/')?path.join(folder,name.slice('/data/'.length)):path.resolve(root,'.'+(name==='/'?'/index.html':name));
      if((!file.startsWith(root+path.sep)&&!file.startsWith(folder+path.sep))||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
      res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
    });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin='http://127.0.0.1:'+server.address().port;
    for(const [engine,type] of [['chromium',chromium],...(process.env.PORTAL_WEBKIT==='1'?[['webkit',webkit]]:[])]){
      const browser=await type.launch({headless:true});try{
        const context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true}),page=await context.newPage(),requests=[],errors=[];
        page.on('request',r=>requests.push(r.url()));page.on('pageerror',e=>errors.push(e.message));await page.route('https://**',route=>route.abort());
        await page.goto(origin+'/#view=portefeuilles&tab=analysis&committee-key='+token);
        await page.locator('#portfolioBriefingStatus').filter({hasText:'synchronisé dans SAVY'}).waitFor();
        assert.match(await page.locator('#portfolioBriefingLatestTitle').innerText(),/5 novembre 2026/);
        assert.match(await page.locator('#portfolioBriefingPanel-summary').innerText(),/Comité automatique de test 2026-11-05/);
        assert.match(await page.locator('#portfolioBriefingStatus').innerText(),/synchronisé dans SAVY/);assert.equal(page.url().includes('committee-key'),false);
        assert.ok(requests.every(url=>!url.includes(token)&&!url.includes(jwk.d)),'Access material must never reach an HTTP request');
        for(const section of ['os','jmc','mcl','optimization','decisions','reports']){await page.locator('#portfolioBriefingTab-'+section).click();if(section==='reports')await page.locator('#portfolioBriefingPanel-reports .committee-sources > summary').click();assert.match(await page.locator('#portfolioBriefingPanel-'+section).innerText(),/Comité automatique de test 2026-11-05/);assert.ok(await page.locator('#portfolioBriefingPanel-'+section+' table').count()>0);}
        assert.equal(await page.locator('#portfolioBriefingContent img').count(),0);assert.equal(await page.locator('#portfolioBriefingArchives [data-briefing-date]').count(),2);
        await page.locator('#portfolioBriefingEdition').selectOption('2026-10-29');await page.locator('#portfolioBriefingLatestTitle').filter({hasText:'29 octobre 2026'}).waitFor();
        const downloadPromise=page.waitForEvent('download');await page.locator('#portfolioBriefingPdf').click();const download=await downloadPromise;assert.deepEqual(fs.readFileSync(await download.path()),pdf);
        await page.reload();await page.locator('#portfolioBriefingStatus').filter({hasText:'synchronisé dans SAVY'}).waitFor();assert.match(await page.locator('#portfolioBriefingLatestTitle').innerText(),/5 novembre 2026/);
        for(const width of [375,320]){await page.setViewportSize({width,height:812});await page.locator('#portfolioBriefingTab-os').click();assert.match(await page.locator('#portfolioBriefingPanel-os').innerText(),/Analyse complète os/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
        const anonymous=await browser.newContext(),locked=await anonymous.newPage();await locked.route('https://**',route=>route.abort());await locked.goto(origin+'/#view=portefeuilles&tab=analysis');
        await locked.locator('#portfolioBriefingStatus').filter({hasText:'lien privé'}).waitFor();assert.equal((await locked.locator('#portfolioBriefingContent').innerText()).includes('Comité automatique de test'),false);
        await locked.goto(origin+'/#view=portefeuilles&tab=analysis&committee-key='+token);await locked.locator('#portfolioBriefingStatus').filter({hasText:'synchronisé dans SAVY'}).waitFor();assert.match(await locked.locator('#portfolioBriefingContent').innerText(),/Comité automatique de test/);assert.equal(locked.url().includes('committee-key'),false);
        assert.deepEqual(errors,[]);await anonymous.close();await context.close();console.log(engine+': all ten encrypted report sections, exact private PDF, history, reload, no key in requests, locked public view and mobile layouts passed.');
      }finally{await browser.close();}
    }
  }finally{if(server)await new Promise(resolve=>server.close(resolve));fs.rmSync(folder,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
