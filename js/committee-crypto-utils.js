(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.SavyCommitteeCrypto=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const INFO='SAVY committee v1', DATE=/^\d{4}-\d{2}-\d{2}$/;
  const engine=()=>globalThis.crypto.subtle;
  const bytes=value=>{if(typeof value!=='string'||!/^[A-Za-z0-9_-]+$/.test(value)||value.length>30000000)throw Error('Données chiffrées invalides.');const s=atob(value.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(s,c=>c.charCodeAt(0));};
  const b64=value=>{let s='';for(const n of new Uint8Array(value))s+=String.fromCharCode(n);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
  const text=value=>new TextEncoder().encode(value);
  async function digest(value){return b64(await engine().digest('SHA-256',value));}
  function publicJwk(key){if(!key||key.kty!=='EC'||key.crv!=='P-256'||bytes(key.x).length!==32||bytes(key.y).length!==32)throw Error('Clé d’accès invalide.');return {crv:'P-256',kty:'EC',x:key.x,y:key.y};}
  async function fingerprint(key){return 'p256:'+await digest(text(JSON.stringify(publicJwk(key))));}
  async function access(token){
    if(typeof token!=='string'||token.length>1500)throw Error('Lien privé invalide.');
    const jwk=JSON.parse(new TextDecoder().decode(bytes(token))),pub=publicJwk(jwk);
    if(bytes(jwk.d).length!==32)throw Error('Lien privé invalide.');
    return {id:await fingerprint(pub),key:await engine().importKey('jwk',{...pub,d:jwk.d},{name:'ECDH',namedCurve:'P-256'},false,['deriveBits'])};
  }
  async function decrypt(envelope,owner){
    if(!envelope||envelope.schema_version!==1||envelope.kind!=='savy-committee-encrypted'||envelope.algorithm!=='ECDH-P256-HKDF-SHA256-AES256GCM'||!DATE.test(envelope.date)||envelope.recipient!==owner.id)throw Error('Ce lien privé ne correspond pas à ce rapport.');
    const salt=bytes(envelope.salt),iv=bytes(envelope.iv);if(salt.length!==32||iv.length!==12)throw Error('Données chiffrées invalides.');
    const ephemeral=await engine().importKey('jwk',publicJwk(envelope.ephemeral),{name:'ECDH',namedCurve:'P-256'},false,[]);
    const shared=await engine().deriveBits({name:'ECDH',public:ephemeral},owner.key,256);
    const input=await engine().importKey('raw',shared,'HKDF',false,['deriveKey']);
    const key=await engine().deriveKey({name:'HKDF',hash:'SHA-256',salt,info:text(INFO)},input,{name:'AES-GCM',length:256},false,['decrypt']);
    const plain=await engine().decrypt({name:'AES-GCM',iv,additionalData:text(INFO+'|'+envelope.date+'|'+envelope.recipient),tagLength:128},key,bytes(envelope.ciphertext));
    const payload=JSON.parse(new TextDecoder().decode(plain));
    if(payload.schema_version!==1||payload.report?.date!==envelope.date||typeof payload.pdf_base64!=='string')throw Error('Rapport privé invalide.');
    const pdf=bytes(payload.pdf_base64);if(new TextDecoder().decode(pdf.slice(0,5))!=='%PDF-'||await digest(pdf)!==payload.pdf_sha256)throw Error('Le PDF ne correspond pas au rapport vérifié.');
    return {report:payload.report,pdf};
  }
  function catalog(value){
    if(!value||value.schema_version!==1||!Array.isArray(value.editions)||value.editions.length>5000)throw Error('Historique des comités invalide.');
    const dates=new Set();return value.editions.map(e=>{if(!DATE.test(e.date)||new Date(e.date+'T12:00:00Z').toISOString().slice(0,10)!==e.date||dates.has(e.date)||e.path!=='data/committee/'+e.date+'.json'||!/^p256:[A-Za-z0-9_-]{43}$/.test(e.recipient)||!/^[A-Za-z0-9_-]{43}$/.test(e.sha256))throw Error('Édition du comité invalide.');dates.add(e.date);return {date:e.date,path:e.path,recipient:e.recipient,sha256:e.sha256};}).sort((a,b)=>b.date.localeCompare(a.date));
  }
  return {bytes,b64,digest,publicJwk,fingerprint,access,decrypt,catalog};
});
