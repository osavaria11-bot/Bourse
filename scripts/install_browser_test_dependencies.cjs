'use strict';
// Keep Playwright's version selection, extraction and validation. Route only
// Chrome for Testing downloads to Google's official public distribution.
const http=require('node:http'),path=require('node:path'),{spawn}=require('node:child_process');

async function install(){
  const server=http.createServer((req,res)=>{
    const match=/^\/builds\/cft\/(\d+\.\d+\.\d+\.\d+)\/(linux64|linux-arm64|mac-x64|mac-arm64|win32|win64)\/(chrome(?:-headless-shell)?-[\w-]+\.zip)$/.exec(req.url||'');
    if(!match){res.writeHead(404);res.end('Unknown browser archive');return;}
    res.writeHead(307,{Location:'https://storage.googleapis.com/chrome-for-testing-public/'+match.slice(1).join('/')});
    res.end();
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  try{
    const args=process.argv.slice(2);
    const cli=path.join(path.dirname(require.resolve('playwright/package.json')),'cli.js');
    const child=spawn(process.execPath,[cli,'install',...(args.length?args:['--with-deps','--only-shell','chromium','webkit'])],{
      stdio:'inherit',env:{...process.env,PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST:'http://127.0.0.1:'+server.address().port}
    });
    process.exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1));});
  }finally{await new Promise(resolve=>server.close(resolve));}
}
install().catch(error=>{console.error(error);process.exitCode=1;});
