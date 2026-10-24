(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.MarketBreadthUtils=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const IDS=['sp500','tsx','europe','emerging'],WINDOWS=[20,50,100,200];
 const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d+'T12:00:00Z').toISOString().slice(0,10)===d;
 function normalize(data){
  if(data?.schema_version!==1||JSON.stringify(data.windows)!==JSON.stringify(WINDOWS)||JSON.stringify(data.markets?.map(m=>m.id))!==JSON.stringify(IDS))throw Error('Format des données de participation invalide.');
  for(const m of data.markets){let previous='';if(typeof m.product!=='string'||!/^https:\/\/www\.(?:ishares|blackrock)\.com\//.test(m.product))throw Error('Source de participation invalide.');if(!['current','stale','unavailable'].includes(m.status))throw Error('Statut de participation invalide.');
   for(const p of m.history){if(!validDate(p.date)||p.date<=previous||!Number.isInteger(p.universe)||p.universe<=0)throw Error('Dates ou univers invalides.');previous=p.date;
    for(const w of WINDOWS){const a=p.above[w],n=p.eligible[w],v=p.values[w];if(!Number.isInteger(a)||!Number.isInteger(n)||a<0||a>n||n>p.universe||v!==null&&(!Number.isFinite(v)||v<0||v>100||n<p.universe*.9||Math.abs(v-a/n*100)>.0001))throw Error('Pourcentage ou couverture invalide.');}
   }
  }return data;
 }
 function range(history,key){if(!history.length||key==='ALL')return history;const days={'1M':31,'3M':93,'6M':186,'1Y':366}[key];if(!days)return history;const cutoff=new Date(history.at(-1).date+'T12:00:00Z');cutoff.setUTCDate(cutoff.getUTCDate()-days);return history.filter(p=>p.date>=cutoff.toISOString().slice(0,10));}
 function latest(m){return [...m.history].reverse().find(p=>WINDOWS.every(w=>p.values[w]!==null))||null;}
 function nearest(history,fraction){return history[Math.max(0,Math.min(history.length-1,Math.round(fraction*(history.length-1))))]||null;}
 return {normalize,range,latest,nearest,IDS,WINDOWS};
});
