(function(root,factory){
  if(typeof module==="object"&&module.exports)module.exports=factory(require("./macro-utils.js"),require("./portfolio-utils.js"));
  else root.ExtendedHoursUtils=factory(root.MacroUtils,root.PortfolioUtils);
})(typeof globalThis!=="undefined"?globalThis:this,function(U,P){
  "use strict";
  const DAY=86400000,positive=v=>U.validNumber(v)&&v>0;
  const PROXIES={
    SPX:{id:"EXTSPX",symbol:"SPY",name:"SPY · S&P 500"},
    IXIC:{id:"EXTIXIC",symbol:"QQQ",name:"QQQ · Nasdaq 100, distinct du Nasdaq Composite"},
    TSX:{id:"EXTTSX",symbol:"EWC",name:"EWC · MSCI Canada, distinct du S&P/TSX"},
    STOXX600:{id:"EXTSTOXX",symbol:"IEUR",name:"IEUR · MSCI Europe, distinct du STOXX 600"}
  };
  function phase(row,key,now=Date.now()){
    const p=row?.extended_hours?.[key];if(!p||!['pre','post'].includes(key))return null;
    const stamp=U.parseTimestamp(p.timestamp),base=U.parseTimestamp(p.baseline_timestamp),start=U.parseTimestamp(p.start),end=U.parseTimestamp(p.end),fetched=U.parseTimestamp(p.fetched_at);
    if(![stamp,base,start,end,fetched].every(Number.isFinite)||!positive(p.price)||!positive(p.baseline_price)||
      !U.isDate(p.session_date)||!U.isDate(p.baseline_session_date)||stamp>now||stamp>fetched+300000||fetched>now+300000||
      now-stamp>7*DAY||end<=start||end-start>16*3600000||stamp<=start||stamp>end||base>start||
      !['fresh','cached'].includes(p.fetch_status)||p.observation_kind!=="candle_close"||
      (key==='pre'?(p.baseline_session_date>=p.session_date||base>=start):(p.baseline_session_date!==p.session_date||base!==start)))return null;
    try{
      const date=new Intl.DateTimeFormat('en-CA',{timeZone:row.exchange_timezone});
      if(date.format(stamp)!==p.session_date||date.format(base)!==p.baseline_session_date)return null;
    }catch{return null;}
    return {...p,percent:(p.price/p.baseline_price-1)*100,stale:p.fetch_status==='cached'||now-fetched>12*60000||now-stamp>36*3600000||
      (now>=start&&now<end&&now-stamp>30*60000),currency:row.currency,symbol:row.quote_symbol};
  }
  function merge(old,next,now=Date.now()){
    if(!old||old.quote_symbol!==next.quote_symbol||old.currency!==next.currency)return {};
    const hours={};
    for(const key of ['pre','post']){
      const a=phase(old,key,now),b=phase(next,key,now);
      const chosen=!a?b:!b?a:Date.parse(b.timestamp)>Date.parse(a.timestamp)||
        (b.timestamp===a.timestamp&&Date.parse(b.fetched_at)>=Date.parse(a.fetched_at))?b:a;
      if(chosen)hours[key]=chosen;
    }
    const closes=new Map();
    for(const row of [...(old.regular_closes||[]),...(next.regular_closes||[])])
      if(U.isDate(row?.session_date)&&positive(row.price)&&Number.isFinite(U.parseTimestamp(row.timestamp))&&Date.parse(row.timestamp)<=now)
        closes.set(row.session_date,row);
    return {...(Object.keys(hours).length?{extended_hours:hours}:{}),...(closes.size?{regular_closes:[...closes.values()].sort((a,b)=>a.session_date.localeCompare(b.session_date)).slice(-7)}:{})};
  }
  function index(payload,id,key,now=Date.now()){
    const proxy=PROXIES[id],native=id==='EEM'?['EEM','USD']:id==='FEQT'?['FEQT.NE','CAD']:null;
    const row=payload?.quotes?.find(q=>q.id===(proxy?.id||id));
    const valid=row&&row.quote_symbol===(proxy?.symbol||native?.[0])&&row.currency===(proxy?'USD':native?.[1]);
    const value=valid?phase(row,key,now):null;
    return {...(value||{}),available:Boolean(value),proxy:proxy?.name||null,source_symbol:proxy?.symbol||null};
  }
  function portfolio(positions,prices,payload,key,now=Date.now()){
    const none={available:false,coverage:0,partial:false,missing:[],reason:'Cours hors séance non publiés pour ces positions.'};
    if(!positions?.length||!prices?.series||!payload?.quotes)return none;
    const sources=new Map(prices.series.map(p=>[p.id,p])),quotes=new Map(payload.quotes.map(q=>[q.id,q])),hours=new Map();
    for(const pos of positions){
      const d=sources.get(pos.ticker),q=quotes.get(pos.ticker);
      if(d&&q&&d.currency===pos.currency&&q.currency===d.currency&&q.quote_symbol===d.quote_symbol){const h=phase(q,key,now);if(h)hours.set(pos.ticker,h);}
    }
    const latest=[...hours.values()].sort((a,b)=>a.session_date.localeCompare(b.session_date)||a.timestamp.localeCompare(b.timestamp)).at(-1);
    if(!latest)return none;
    const applicable=new Map([...hours].filter(([,h])=>h.session_date===latest.session_date&&h.baseline_timestamp===latest.baseline_timestamp));
    const stamp=[...applicable.values()].map(h=>h.timestamp).sort().at(-1),baseStamp=latest.baseline_timestamp;
    const fxRow=quotes.get('USDCAD');
    const fxHistory=fxRow?.quote_symbol==='CAD=X'&&fxRow.currency==='CAD'?
      [...Object.values(fxRow.intraday_sessions||{}).flat(),...(fxRow.intraday_history||[])].filter(r=>Array.isArray(r)&&positive(r[1])&&r[1]>.5&&r[1]<3&&Number.isFinite(U.parseTimestamp(r[0]))&&Date.parse(r[0])<=now).sort((a,b)=>a[0].localeCompare(b[0])):[];
    const rateAt=time=>{const t=Date.parse(time),p=fxHistory.filter(row=>Date.parse(row[0])<=t).at(-1),age=p?t-Date.parse(p[0]):Infinity;return p&&age>=0&&age<=30*60000?p[1]:null;};
    const usd=positions.some(p=>p.currency==='USD'),baseFx=usd?rateAt(baseStamp):1,currentFx=usd?rateAt(stamp):1;
    if(!baseFx||!currentFx)return {...none,reason:'USD/CAD daté indisponible pour comparer les deux instants.'};
    let baseline=0,current=0,covered=0;const missing=[];
    for(const pos of positions){
      const point=sources.get(pos.ticker),q=quotes.get(pos.ticker),h=applicable.get(pos.ticker);
      if(!point||point.currency!==pos.currency||!positive(pos.quantity)){missing.push(pos.ticker);continue;}
      const same=q&&q.quote_symbol===point.quote_symbol&&q.currency===point.currency;
      const daily=P.observationAt(point.history||[],latest.baseline_session_date);
      const close=same?(q.regular_closes||[]).find(p=>p.session_date===latest.baseline_session_date):null;
      let price=h?.baseline_price||close?.price||(daily?.[0]===latest.baseline_session_date?daily[1]:null);
      if(!positive(price)&&same&&q.session_date===latest.baseline_session_date&&Date.parse(q.session_end)<=now)price=q.price;
      if(!positive(price)&&same&&key==='pre'&&q.session_date===latest.session_date&&q.session_start===latest.end)price=q.previous_close;
      if(!positive(price)){missing.push(pos.ticker);continue;}
      const baseValue=pos.quantity*price*(pos.currency==='USD'?baseFx:1);
      baseline+=baseValue;current+=pos.quantity*(h?h.price:price)*(pos.currency==='USD'?currentFx:1);
      if(h)covered+=baseValue;
    }
    if(missing.length||!(baseline>0)||!(covered>0))return {...none,missing,reason:'Clôture de référence manquante : '+missing.join(', ')};
    return {available:true,percent:(current/baseline-1)*100,coverage:covered/baseline,partial:covered/baseline<1-1e-9,
      session_date:latest.session_date,baseline_session_date:latest.baseline_session_date,baseline_timestamp:baseStamp,timestamp:stamp,
      stale:[...applicable.values()].some(h=>h.stale),missing:[],indicative:true,source_symbol:null};
  }
  function render(host,values){
    if(!host||!globalThis.document)return;
    host.replaceChildren();host.className='extended-hours';
    for(const [key,label] of [['pre','Prémarché'],['post','Après clôture']]){
      const v=values[key]||{},line=document.createElement('div'),name=document.createElement('span'),number=document.createElement('strong');
      line.className='extended-row';line.dataset.extendedPhase=key;
      name.className='extended-label';name.textContent=label+(v.source_symbol?' · '+v.source_symbol:'');
      const good=v.available&&U.validNumber(v.percent);number.className='change '+(good?(v.percent>0?'up':v.percent<0?'down':'flat'):'flat');
      number.textContent=good?((v.proxy||v.partial?'≈ ':'')+(v.percent>0?'+':'')+U.formatNumber(v.percent,2)+' %'):'—';
      if(good){
        const date=new Intl.DateTimeFormat('fr-CA',{timeZone:'UTC',day:'numeric',month:'short'}).format(new Date(v.session_date+'T12:00:00Z'));
        const tag=document.createElement('small');tag.className='extended-date';tag.textContent=date+(v.partial?' · '+Math.round(v.coverage*100)+' % couvert':'')+(v.stale?' · conservé':'');
        name.append(' ',tag);
      }
      line.title=good?(v.proxy?'Repère ETF '+v.proxy+'. Ce pourcentage appartient au FNB, pas à une cotation officielle de l’indice. ':v.indicative?'Indicatif · positions actuelles pondérées en CAD, change inclus. Les positions sans cotation hors séance restent à leur clôture. Couverture '+U.formatNumber(v.coverage*100,1)+' %. ':'Cours hors séance publié par Yahoo Finance. ')+
        'Par rapport à la clôture du '+v.baseline_session_date+' · '+U.timestampLabel(v.timestamp)+(v.stale?' · observation conservée':''):
        v.reason||'Pas de cotation hors séance publiée pour cet instrument.';
      line.append(name,number);host.append(line);
    }
  }
  return {phase,merge,index,portfolio,render,PROXIES};
});
