(() => {
  'use strict';
  const C=window.SavyCommitteeCrypto,U=window.SavyPortfolioBriefingUtils,cache=new Map();
  let catalog=[],latestLoaded=null;
  const emit=(name,detail)=>window.dispatchEvent(new CustomEvent('savy:committee:'+name,{detail}));
  async function load(date){
    const record=catalog.find(x=>x.date===date);if(!record)throw Error('Cette édition n’est pas disponible.');
    if(cache.get(date)?.sha===record.sha256){emit('loaded',cache.get(date));return;}
    emit('loading',{date});
    try{
      const owner=await window.SavyCommitteeAccess.get();
      if(!owner)throw Error(window.SavyCommitteeAccess.error()||'Ouvre le lien privé d’Analyse communiqué dans ChatGPT sur cet appareil.');
      if(owner.id!==record.recipient)throw Error('Cette édition nécessite le lien privé d’Analyse correspondant.');
      const response=await fetch(record.path,{cache:'no-store',credentials:'same-origin'});
      if(!response.ok||Number(response.headers.get('content-length')||0)>30000000)throw Error('Le rapport chiffré n’est pas disponible.');
      const raw=await response.text();if(raw.length>30000000||await C.digest(new TextEncoder().encode(raw))!==record.sha256)throw Error('Le rapport reçu ne correspond pas à l’édition publiée.');
      const payload=await C.decrypt(JSON.parse(raw),owner),report=U.normalize(payload.report);
      if(Object.keys(U.TITLES).some(key=>!report.sections[key]))throw Error('L’édition ne contient pas toutes ses rubriques.');
      const previous=cache.get(date);if(previous)URL.revokeObjectURL(previous.pdfUrl);
      const result={report,pdfUrl:URL.createObjectURL(new Blob([payload.pdf],{type:'application/pdf'})),sha:record.sha256};
      cache.set(date,result);latestLoaded=date;emit('loaded',result);
    }catch(error){emit('error',{message:error.message||'Le rapport privé ne peut pas être ouvert.'});throw error;}
  }
  async function refresh(force=false){
    try{
      const response=await fetch('data/committee-reports.json',{cache:'no-store',credentials:'same-origin'});
      if(response.status===404)return;if(!response.ok)throw Error('L’historique des comités ne peut pas être actualisé.');
      catalog=C.catalog(await response.json());emit('catalog',{editions:catalog});
      if(!catalog.length)return;
      if(force||!latestLoaded||cache.get(catalog[0].date)?.sha!==catalog[0].sha256)await load(catalog[0].date);
    }catch(error){emit('error',{message:error.message||'Actualisation du comité indisponible.'});}
  }
  window.SavyCommitteeReports={load,refresh};
  const actions=document.querySelector('#panel-portefeuilles-analysis .committee-edition-actions');
  if(actions){const button=document.createElement('button');button.type='button';button.className='button quiet';button.id='portfolioBriefingSync';button.textContent='Actualiser le comité';button.addEventListener('click',()=>refresh(true));actions.append(button);}
  window.addEventListener('focus',()=>refresh(false));window.addEventListener('savy:committee:access',()=>refresh(true));refresh();
})();
