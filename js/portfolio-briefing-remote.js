(() => {
  "use strict";
  const root=document.getElementById("panel-portefeuilles-analysis");
  if(!root)return;
  const ORIGIN="https://savy-comite-prive.gentle-newt-9113.chatgpt.site";
  const node=(tag,className,text)=>{const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n;};
  for(const selector of [".committee-edition",".committee-nav","#portfolioBriefingContent",".portfolio-briefing-disclaimer"]){const n=root.querySelector(selector);if(n)n.dataset.committeeLocal="true";}
  const controls=node("div","committee-source-controls"),toggle=node("button","button quiet","Rapports enregistrés sur cet appareil");toggle.type="button";toggle.id="portfolioBriefingSource";toggle.setAttribute("aria-pressed","false");controls.append(toggle);
  const remote=node("section","committee-remote");remote.id="portfolioBriefingRemote";remote.setAttribute("aria-label","Comité d’investissement privé synchronisé");
  const toolbar=node("div","committee-remote-toolbar"),status=node("p","meta","Chargement du rapport privé…");status.id="portfolioBriefingRemoteStatus";status.setAttribute("role","status");
  const actions=node("div","committee-remote-actions"),open=node("a","button quiet","Ouvrir le comité privé ↗"),refresh=node("button","button quiet","Actualiser le rapport");
  open.href=ORIGIN+"/";open.target="_blank";open.rel="noopener noreferrer";open.id="portfolioBriefingRemoteOpen";refresh.type="button";refresh.id="portfolioBriefingRemoteRefresh";actions.append(open,refresh);toolbar.append(status,actions);
  const frame=node("iframe","committee-remote-frame");frame.id="portfolioBriefingRemoteFrame";frame.title="Analyse privée OS, JMC et MCL";frame.referrerPolicy="no-referrer";frame.loading="lazy";
  // Authentication stays at the private origin. Never copy report contents,
  // identity, cookies or service credentials into this public page.
  frame.src=ORIGIN+"/?embed=1";remote.append(toolbar,frame);
  const intro=root.querySelector(".portfolio-briefing-intro");intro.after(controls,remote);root.dataset.committeeSource="remote";
  let ready=false,opened=false;
  const retry=()=>{ready=false;status.textContent="Chargement du rapport privé…";frame.src=ORIGIN+"/?embed=1&t="+Date.now();};
  refresh.addEventListener("click",retry);open.addEventListener("click",()=>{opened=true;});
  window.addEventListener("focus",()=>{if(opened&&!ready){opened=false;retry();}});
  toggle.addEventListener("click",()=>{const local=root.dataset.committeeSource!=="local";root.dataset.committeeSource=local?"local":"remote";remote.hidden=local;toggle.setAttribute("aria-pressed",String(local));toggle.textContent=local?"Revenir au comité synchronisé":"Rapports enregistrés sur cet appareil";});
  window.addEventListener("message",event=>{
    if(event.origin!==ORIGIN||event.source!==frame.contentWindow||!event.data||typeof event.data!=="object")return;
    if(event.data.type==="savy:committee:height"&&Number.isFinite(event.data.height))frame.style.height=Math.max(480,Math.min(60000,event.data.height+12))+"px";
    if(event.data.type==="savy:committee:ready"&&/^\d{4}-\d{2}-\d{2}$/.test(event.data.date||"")){ready=true;status.textContent="Comité privé · Édition du "+new Intl.DateTimeFormat("fr-CA",{timeZone:"America/Toronto",day:"numeric",month:"long",year:"numeric"}).format(new Date(event.data.date+"T12:00:00Z"));}
  });
  setTimeout(()=>{if(!ready)status.textContent="Si une connexion est demandée, ouvre le comité privé avec ton compte ChatGPT, puis actualise le rapport ici.";},15000);
})();
