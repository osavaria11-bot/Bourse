'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const root=path.resolve(__dirname,'..'),types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.pdf':'application/pdf','.woff2':'font/woff2','.png':'image/png'};
(async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'savy-public-committee-'));let server;
  try{
    const pdf=Buffer.from('%PDF-1.7\nPublic synthetic committee fixture');fs.writeFileSync(path.join(folder,'source.pdf'),pdf);
    for(const date of ['2026-10-29','2026-11-05']){
      const sections=Object.fromEntries(['summary','os','jmc','mcl','comparison','optimization','recommendations','follow_up','outlook','methodology'].map(k=>[k,'## Comité public de test '+date+'\n\nAnalyse complète **'+k+'**.\n\n| Actif | Avis |\n| --- | --- |\n| TEST | Conserver |\n\n<img src="https://outside.example/pixel">']));
      fs.writeFileSync(path.join(folder,'source.json'),JSON.stringify({schema_version:1,date,data_date:date,finviz_date:date,sections}));
      execFileSync('python',['scripts/publish_committee.py','--report',path.join(folder,'source.json'),'--pdf',path.join(folder,'source.pdf'),'--site-dir',folder],{cwd:root,stdio:'pipe'});
    }
    server=http.createServer((req,res)=>{
      const name=new URL(req.url,'http://localhost').pathname;
      const isReport=name==='/data/committee-reports.json'||name.startsWith('/data/committee/')||name.startsWith('/reports/committee/');
      const file=path.resolve(isReport?folder:root,'.'+(name==='/'?'/index.html':name));
      if((!file.startsWith(root+path.sep)&&!file.startsWith(folder+path.sep))||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
      res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
    });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin='http://127.0.0.1:'+server.address().port;
    for(const [engine,type] of [['chromium',chromium],...(process.env.PORTAL_WEBKIT==='1'?[['webkit',webkit]]:[])]){
      const browser=await type.launch({headless:true});try{
        const context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true}),page=await context.newPage(),errors=[];
        page.on('pageerror',e=>errors.push(e.message));await page.route('https://**',route=>route.abort());
        // Public reports must never ask the legacy access provider for a key.
        await page.addInitScript(()=>Object.defineProperty(window,'SavyCommitteeAccess',{configurable:false,get:()=>({get(){throw Error('Public report requested a private key');},error:()=>''}),set(){}}));
        await page.goto(origin+'/#view=portefeuilles&tab=analysis');
        await page.locator('#portfolioBriefingStatus').filter({hasText:'Rapport public synchronisé'}).waitFor();
        assert.match(await page.locator('#portfolioBriefingLatestTitle').innerText(),/5 novembre 2026/);
        assert.equal(await page.evaluate(()=>localStorage.getItem('savy:committee-private-key:v1')),null);
        for(const section of ['summary','os','jmc','mcl','optimization','decisions','reports']){
          await page.locator('#portfolioBriefingTab-'+section).click();
          if(section==='reports')await page.locator('#portfolioBriefingPanel-reports .committee-sources > summary').click();
          assert.match(await page.locator('#portfolioBriefingPanel-'+section).innerText(),/Comité public de test 2026-11-05/);
        }
        assert.equal(await page.locator('[data-committee-content]').count(),10);
        for(const body of await page.locator('[data-committee-content]').allTextContents())assert.match(body,/Analyse complète/);
        assert.equal(await page.locator('#portfolioBriefingContent img').count(),0);
        assert.equal(await page.locator('#portfolioBriefingArchives [data-briefing-date]').count(),2);
        assert.equal(await page.locator('#portfolioBriefingPdf').getAttribute('href'),'reports/committee/2026-11-05-comite-investissement.pdf');
        const downloadPromise=page.waitForEvent('download');await page.locator('#portfolioBriefingPdf').click();assert.deepEqual(fs.readFileSync(await (await downloadPromise).path()),pdf);
        await page.locator('#portfolioBriefingEdition').selectOption('2026-10-29');await page.locator('#portfolioBriefingLatestTitle').filter({hasText:'29 octobre 2026'}).waitFor();
        assert.match(await page.locator('#portfolioBriefingContent').innerText(),/Comité public de test 2026-10-29/);
        await page.reload();await page.locator('#portfolioBriefingStatus').filter({hasText:'Rapport public synchronisé'}).waitFor();
        for(const width of [375,320]){await page.setViewportSize({width,height:812});await page.locator('#portfolioBriefingTab-os').click();assert.match(await page.locator('#portfolioBriefingPanel-os').innerText(),/Analyse complète os/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
        const brokenContext=await browser.newContext(),broken=await brokenContext.newPage();await broken.route('https://**',r=>r.abort());
        await broken.route('**/reports/committee/*.pdf',r=>r.fulfill({contentType:'application/pdf',body:'%PDF-1.7\nCorrupted'}));
        await broken.goto(origin+'/#view=portefeuilles&tab=analysis');await broken.locator('#portfolioBriefingStatus').filter({hasText:'Le PDF ne correspond pas'}).waitFor();
        assert.equal((await broken.locator('#portfolioBriefingContent').innerText()).includes('Comité public de test'),false);
        assert.deepEqual(errors,[]);await brokenContext.close();await context.close();console.log(engine+': anonymous public report, all ten sections, exact public PDF, history, reload, integrity and mobile layouts passed.');
      }finally{await browser.close();}
    }
  }finally{if(server)await new Promise(resolve=>server.close(resolve));fs.rmSync(folder,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
