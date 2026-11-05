(() => {
  'use strict';
  const C=window.SavyCommitteeCrypto,U=window.SavyPortfolioBriefingUtils,cache=new Map();
  let catalog=[],latestLoaded=null;
  const emit=(name,detail)=>window.dispatchEvent(new CustomEvent('savy:committee:'+name,{detail}));
  const version=record=>record.sha256+':'+(record.pdf_sha256||'');
  async function load(date){
    const record=catalog.find(x=>x.date===date);if(!record)throw Error('Cette édition n’est pas disponible.');
    if(cache.get(date)?.sha===version(record)){latestLoaded=date;emit('loaded',cache.get(date));return;}
    emit('loading',{date});
    try{
      let owner;
      if(record.visibility!=='public'){
        owner=await window.SavyCommitteeAccess.get();
        if(!owner)throw Error(window.SavyCommitteeAccess.error()||'Ouvre le lien privé d’Analyse communiqué dans ChatGPT sur cet appareil.');
        if(owner.id!==record.recipient)throw Error('Cette édition nécessite le lien privé d’Analyse correspondant.');
      }
      const response=await fetch(record.path,{cache:'no-store',credentials:'same-origin'});
      if(!response.ok||Number(response.headers.get('content-length')||0)>30000000)throw Error('Le rapport du comité n’est pas disponible.');
      const raw=await response.text();if(raw.length>30000000||await C.digest(new TextEncoder().encode(raw))!==record.sha256)throw Error('Le rapport reçu ne correspond pas à l’édition publiée.');
      let report,pdfUrl;
      if(record.visibility==='public'){
        report=U.normalize(JSON.parse(raw));
        if(report.pdf_url!==record.pdf_path)throw Error('Le PDF n’est pas associé à cette édition.');
        const pdfResponse=await fetch(record.pdf_path,{cache:'no-store',credentials:'same-origin'});
        if(!pdfResponse.ok||Number(pdfResponse.headers.get('content-length')||0)>20000000)throw Error('Le PDF du comité n’est pas disponible.');
        const pdf=new Uint8Array(await pdfResponse.arrayBuffer());
        if(pdf.length>20000000||new TextDecoder().decode(pdf.slice(0,5))!=='%PDF-'||await C.digest(pdf)!==record.pdf_sha256)throw Error('Le PDF ne correspond pas à l’édition publiée.');
        pdfUrl=record.pdf_path;
      }else{
        const payload=await C.decrypt(JSON.parse(raw),owner);report=U.normalize(payload.report);
        pdfUrl=URL.createObjectURL(new Blob([payload.pdf],{type:'application/pdf'}));
      }
      if(report.date!==date)throw Error('La date du rapport ne correspond pas à l’édition publiée.');
      if(Object.keys(U.TITLES).some(key=>!report.sections[key]))throw Error('L’édition ne contient pas toutes ses rubriques.');
      const previous=cache.get(date);if(previous?.pdfUrl.startsWith('blob:'))URL.revokeObjectURL(previous.pdfUrl);
      const result={report,pdfUrl,sha:version(record),public:record.visibility==='public'};
      cache.set(date,result);latestLoaded=date;emit('loaded',result);
    }catch(error){emit('error',{message:error.message||'Le rapport du comité ne peut pas être ouvert.'});throw error;}
  }
  async function refresh(force=false){
    try{
      const response=await fetch('data/committee-reports.json',{cache:'no-store',credentials:'same-origin'});
      if(response.status===404)return;if(!response.ok)throw Error('L’historique des comités ne peut pas être actualisé.');
      catalog=C.catalog(await response.json());emit('catalog',{editions:catalog});
      if(!catalog.length)return;
      if(force||!latestLoaded||cache.get(catalog[0].date)?.sha!==version(catalog[0]))await load(catalog[0].date);
    }catch(error){emit('error',{message:error.message||'Actualisation du comité indisponible.'});}
  }
  window.SavyCommitteeReports={load,refresh};
  const actions=document.querySelector('#panel-portefeuilles-analysis .committee-edition-actions');
  if(actions){const button=document.createElement('button');button.type='button';button.className='button quiet';button.id='portfolioBriefingSync';button.textContent='Actualiser le comité';button.addEventListener('click',()=>refresh(true));actions.append(button);}
  window.addEventListener('focus',()=>refresh(false));window.addEventListener('savy:committee:access',()=>refresh(true));refresh();
})();
