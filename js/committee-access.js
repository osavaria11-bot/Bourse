(() => {
  'use strict';
  const NAME='savy:committee-private-key:v1', C=window.SavyCommitteeCrypto;
  const params=new URLSearchParams(location.hash.slice(1));
  const incoming=params.get('committee-key');let token=null,promise=null,error='';
  if(incoming){
    // Consume before the portal rewrites the fragment. It never reaches a server,
    // an iframe, an analytics URL or a connected service.
    params.delete('committee-key');history.replaceState(null,'',location.pathname+location.search+(params.size?'#'+params.toString():''));
    token=incoming;
  }else{try{token=localStorage.getItem(NAME);}catch{}}
  if(token)promise=C.access(token).then(key=>{try{localStorage.setItem(NAME,token);}catch{}return key;}).catch(()=>{error='Le lien privé du comité est invalide sur cet appareil.';return null;});
  window.SavyCommitteeAccess={get:()=>promise||Promise.resolve(null),error:()=>error};
})();
