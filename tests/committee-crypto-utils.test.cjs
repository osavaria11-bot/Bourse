'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const C=require('../js/committee-crypto-utils.js');
test('Python publication opens with browser WebCrypto; modified ciphertext and another recipient fail',async()=>{
  const pair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
  const jwk=await crypto.subtle.exportKey('jwk',pair.privateKey),pub=C.publicJwk(jwk),id=await C.fingerprint(pub);
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'savy-committee-'));
  try{
    const sections=Object.fromEntries(['summary','os','jmc','mcl','comparison','optimization','recommendations','follow_up','outlook','methodology'].map(k=>[k,'Analyse synthétique '+k+'\n']));
    const report={schema_version:1,date:'2026-11-05',sections},pdf=Buffer.from('%PDF-1.7\nSynthetic test, no personal information');
    fs.writeFileSync(path.join(folder,'report.json'),JSON.stringify(report));fs.writeFileSync(path.join(folder,'report.pdf'),pdf);fs.writeFileSync(path.join(folder,'recipient.json'),JSON.stringify({key_id:id,public_key:pub}));
    const run=()=>execFileSync('python',['scripts/encrypt_committee.py','--report',path.join(folder,'report.json'),'--pdf',path.join(folder,'report.pdf'),'--public-key',path.join(folder,'recipient.json'),'--output-dir',folder],{cwd:path.resolve(__dirname,'..'),stdio:'pipe'});
    run();const raw=fs.readFileSync(path.join(folder,'committee/2026-11-05.json')),envelope=JSON.parse(raw),owner=await C.access(C.b64(Buffer.from(JSON.stringify(jwk))));
    const clear=await C.decrypt(envelope,owner);assert.deepEqual(clear.report,report);assert.deepEqual(Buffer.from(clear.pdf),pdf);assert.ok(!raw.includes(Buffer.from('Analyse synthétique')));
    const catalog=C.catalog(JSON.parse(fs.readFileSync(path.join(folder,'committee-reports.json'))));assert.equal(catalog[0].sha256,await C.digest(raw));
    const altered={...envelope,ciphertext:envelope.ciphertext.slice(0,-5)+'AAAAA'};await assert.rejects(C.decrypt(altered,owner));
    await assert.rejects(C.decrypt({...envelope,date:'2026-11-06'},owner));
    const other=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);const wrong=await C.access(C.b64(Buffer.from(JSON.stringify(await crypto.subtle.exportKey('jwk',other.privateKey)))));await assert.rejects(C.decrypt(envelope,wrong));
    const old={...catalog[0],date:'2026-10-29',path:'data/committee/2026-10-29.json'};fs.writeFileSync(path.join(folder,'committee-reports.json'),JSON.stringify({schema_version:1,editions:[old,...catalog]}));run();assert.equal(C.catalog(JSON.parse(fs.readFileSync(path.join(folder,'committee-reports.json')))).length,2);
    fs.writeFileSync(path.join(folder,'recipient.json'),JSON.stringify({key_id:id,public_key:jwk}));assert.throws(run,'The publisher must refuse a private key in its public configuration');
  }finally{fs.rmSync(folder,{recursive:true,force:true});}
});
test('catalog refuses external URLs, duplicate dates and invalid dates',()=>{
  const entry={date:'2026-11-05',path:'data/committee/2026-11-05.json',recipient:'p256:'+'A'.repeat(43),sha256:'B'.repeat(43)};
  assert.throws(()=>C.catalog({schema_version:1,editions:[{...entry,path:'https://other.example/report'}]}));
  assert.throws(()=>C.catalog({schema_version:1,editions:[entry,entry]}));
  assert.throws(()=>C.catalog({schema_version:1,editions:[{...entry,date:'2026-02-30'}]}));
});
test('public catalogs bind the JSON and PDF to their date and preserve encrypted archives',()=>{
  const date='2026-11-05',entry={date,visibility:'public',path:'data/committee/'+date+'.json',pdf_path:'reports/committee/'+date+'-comite-investissement.pdf',sha256:'A'.repeat(43),pdf_sha256:'B'.repeat(43)};
  const legacy={date:'2026-10-29',path:'data/committee/2026-10-29.json',recipient:'p256:'+'A'.repeat(43),sha256:'C'.repeat(43)};
  assert.equal(C.catalog({schema_version:2,editions:[legacy,entry]})[0].visibility,'public');
  for(const patch of [{pdf_path:'https://other.example/report.pdf'},{pdf_path:entry.pdf_path.replace(date,'2026-10-29')},{pdf_sha256:'invalid'},{path:'../'+entry.path},{visibility:'unknown'}])assert.throws(()=>C.catalog({schema_version:2,editions:[{...entry,...patch}]}));
});
