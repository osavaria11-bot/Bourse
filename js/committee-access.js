(() => {
  'use strict';
  const NAME='savy:committee-private-key:v1', C=window.SavyCommitteeCrypto;
  let promise=null,error='';
  function activate(token,notify){
    error='';
    promise=C.access(token).then(key=>{try{localStorage.setItem(NAME,token);}catch{}return key;}).catch(()=>{error='Le lien privé du comité est invalide sur cet appareil.';return null;});
    if(notify)promise.then(()=>window.dispatchEvent(new Event('savy:committee:access')));
  }
  function capture(notify=false){
    const params=new URLSearchParams(location.hash.slice(1)),incoming=params.get('committee-key');
    if(!incoming)return false;
    // Consume before the portal rewrites the fragment. No key reaches HTTP,
    // another origin, analytics or a connected service.
    params.delete('committee-key');history.replaceState(null,'',location.pathname+location.search+(params.size?'#'+params.toString():''));
    activate(incoming,notify);return true;
  }
  window.SavyCommitteeAccess={get:()=>promise||Promise.resolve(null),error:()=>error};
  if(!capture()){try{const token=localStorage.getItem(NAME);if(token)activate(token,false);}catch{}}
  window.addEventListener('hashchange',()=>capture(true));
})();
