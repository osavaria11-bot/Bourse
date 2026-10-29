"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const V=require('../js/valuation-utils.js');
const config=V.universe(JSON.parse(fs.readFileSync('data/valuation-universe.json','utf8')));
function snapshot(date='2026-01-02',price=100,eps=5){return {date,observed_at:date+'T22:00:00Z',source_url:'https://example.com/forecasts/',currency:'USD',price,
  price_date:date,complete_session:true,fiscal_month:12,enterprise_value_millions:1200,
  forecasts:[{period_end:'2026-12-31',eps,ebitda_millions:100},{period_end:'2027-12-31',eps:eps*1.2,ebitda_millions:150},{period_end:'2028-12-31',eps:eps*1.5,ebitda_millions:200}]};}
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,actual+' != '+expected);
function businessDays(count){const out=[],d=new Date('2026-01-02T12:00:00Z');while(out.length<count){if(d.getUTCDay()>0&&d.getUTCDay()<6)out.push(d.toISOString().slice(0,10));d.setUTCDate(d.getUTCDate()+1);}return out;}
test('only stocks; membership reads all three accounts and maps CDRs without keeping quantities',()=>{
  const rows=V.memberIds(config,{OS:['AAPL','FEQT','MSFTCDR'],JMC:['RY','VBAL'],MCL:['SNDK','AAPL','VGRO']});
  assert.deepEqual(rows.find(r=>r.id==='AAPL').portfolios,['OS','MCL']);assert.deepEqual(rows.find(r=>r.id==='MSFT').portfolios,['OS']);
  assert.deepEqual(rows.find(r=>r.id==='SNDKUS').portfolios,['MCL']);assert.equal(rows.some(r=>r.id==='FEQT'),false);
  assert.equal(rows.find(r=>r.id==='WMG').research,true);assert.equal(JSON.stringify(rows).includes('quantity'),false);
  assert.throws(()=>V.universe({...config,instruments:[...config.instruments,{id:'ETF',symbol:'ETF',title:'Fund',type:'etf'}]}));
});
test('12/24 months blend EPS and EBITDA, holding EV fixed across horizons',()=>{
  const s=snapshot('2026-10-28',150,5),w=64/365;
  const a=V.values(s,1),b=V.values(s,2);
  close(a.pe,150/(5*w+6*(1-w)));close(b.pe,150/(6*w+7.5*(1-w)));
  close(a.ev_ebitda,1200/(100*w+150*(1-w)));close(b.ev_ebitda,1200/(150*w+200*(1-w)));
  s.forecasts.pop();assert.equal(V.values(s,2).pe,null);
  assert.equal(V.values(s,1,true).ev_ebitda,null);
});
test('fiscal estimates remain an explicitly separate basis',()=>{
  const s=snapshot('2026-10-28');close(V.values(s,1,false,'fiscal').pe,20);close(V.values(s,2,false,'fiscal').pe,100/6);
  assert.equal(V.values(s,1,false,'fiscal').period_end,'2026-12-31');
});
test('Wilder smoothing matches the independent published arithmetic example',()=>{
  const multiples=[44.34,44.09,44.15,43.61,44.33,44.83,45.10,45.42,45.84,46.08,45.89,46.03,45.61,46.28,46.28,46,46.03];
  const result=V.rsi(multiples.map((v,i)=>[businessDays(17)[i],v]));
  assert.equal(result.slice(0,14).every(p=>p[1]===null),true);close(result[14][1],70.46413502109705);close(result[15][1],66.24961855355505);
});
test('RSI moves with consensus revisions while the share price remains constant',()=>{
  const observations=businessDays(35).map((d,i)=>snapshot(d,100,5+i*.1));
  const data={id:'TEST',financial:false,observations},m=V.model(data,observations.at(-1),1,'5Y');
  assert.equal(observations.every(s=>s.price===100),true);assert.equal(m.pe.latestRsi,0);assert.ok(m.pe.points[0][1]>m.pe.points.at(-1)[1]);
});
test('RSI 0/50/100 boundaries and missing observations are handled without interpolation',()=>{
  const dates=businessDays(31);
  for(const [values,expected] of[[dates.map((_,i)=>10+i),100],[dates.map((_,i)=>50-i),0],[dates.map(()=>20),50]])assert.equal(V.rsi(values.map((v,i)=>[dates[i],v])).at(-1)[1],expected);
  const points=dates.map((d,i)=>[d,i===20?null:20+i]);assert.equal(V.rsi(points).at(-1)[1],null);
});
test('a missing actual trading session resets RSI while a documented holiday does not',()=>{
  const dates=businessDays(32),points=dates.map((d,i)=>[d,20+i]);
  const previous=new Map(dates.slice(1).map((d,i)=>[d,dates[i]]));
  const missing=points.filter((_,i)=>i!==20);
  assert.equal(V.rsi(missing,14,previous).at(-1)[1],null);
  previous.set(dates[21],dates[19]);
  assert.equal(V.rsi(missing,14,previous).at(-1)[1],100);
});
test('no fake historical points, price RSI or percentile when the archive is short',()=>{
  const s=snapshot(),m=V.model({observations:[s]},s,1,'5Y');assert.equal(m.pe.points.length,1);assert.equal(m.pe.latestRsi,null);assert.equal(m.pe.stats.available,false);
  s.price_date='2025-12-31';s.complete_session=false;
  const incomplete=V.model({observations:[s]},s,1,'MAX');assert.equal(incomplete.pe.points.length,0);assert.equal(incomplete.pe.latestRsi,null);
});
test('an audit observation on a closed day is not inserted into the trading RSI',()=>{
  const observations=businessDays(35).map((d,i)=>snapshot(d,100+i));
  observations.splice(1,0,{...snapshot('2026-01-03',100),price_date:'2026-01-02',complete_session:false});
  const m=V.model({observations},observations.at(-1),1,'MAX');assert.equal(m.pe.points.length,35);assert.ok(V.finite(m.pe.latestRsi));
});
test('median, percentile and windowed RSI use the same historical multiple definition',()=>{
  const points=businessDays(40).map((d,i)=>[d,10+i]);const stats=V.statistics(points,29.5);assert.equal(stats.available,true);close(stats.median,29.5);close(stats.percentile,50);close(stats.premium,0);
  const observations=businessDays(40).map((d,i)=>snapshot(d,100+i));const a=V.model({observations},observations.at(-1),1,'1Y'),b=V.model({observations},observations.at(-1),1,'MAX');close(a.pe.latestRsi,b.pe.latestRsi);
});
test('snapshot validation rejects future, mismatched date, wrong stock, and duplicate observations',()=>{
  const s=snapshot();assert.equal(V.snapshot(s).date,s.date);assert.throws(()=>V.snapshot({...s,observed_at:'2027-01-01T22:00:00Z'},Date.parse('2026-10-28T22:00:00Z')));
  assert.throws(()=>V.snapshot({...s,date:'2026-01-01'}));assert.throws(()=>V.history({schema_version:1,kind:'savy_stock_valuation',id:'BAD',observations:[s]},'TEST'));
  assert.throws(()=>V.snapshot({...s,consensus_date:'2026-01-03'}));
  assert.throws(()=>V.history({schema_version:1,kind:'savy_stock_valuation',id:'TEST',observations:[s,s]},'TEST'));
});
test('old consensus dates are visible inputs and cannot generate a current trading RSI',()=>{
  const observations=businessDays(35).map((d,i)=>({...snapshot(d,100+i),consensus_date:'2025-12-01'}));
  const model=V.model({observations},observations.at(-1),1,'5Y');assert.equal(model.pe.latestRsi,null);assert.equal(model.pe.stats.available,false);
});
test('native currency conversion must match its dated FX and cannot use a later candle',()=>{
  const s={...snapshot(),price_native:140,price_native_currency:'CAD',fx_rate:1.4,fx_timestamp:'2026-01-02T21:00:00Z',price_close_timestamp:'2026-01-02T21:00:00Z'};
  assert.equal(V.snapshot(s).price,100);assert.throws(()=>V.snapshot({...s,fx_timestamp:'2026-01-02T21:05:00Z'}));assert.throws(()=>V.snapshot({...s,price:105}));
});
test('provider estimate history stays separate from constant-horizon archive and uses ratio RSI',()=>{
  const dates=businessDays(40),metric={definition:'provider_estimate_unspecified_horizon',horizon_months:null,point_in_time_verified:false,
    source_url:'https://example.com/chart/',fetched_at:dates.at(-1)+'T22:00:00Z',quote_currency:'USD',as_of:dates.at(-1),points:dates.map((d,i)=>[d,20+i])};
  const data={schema_version:1,kind:'savy_provider_valuation_history',id:'TEST',source_url:'https://example.com/',checked_at:metric.fetched_at,metrics:{pe:metric}};
  V.providerHistory(data,'TEST');const m=V.providerModel(data,'MAX');assert.equal(m.pe.points.length,40);assert.equal(m.pe.latestRsi,100);assert.equal(m.pe.stats.available,true);assert.equal(m.ev_ebitda.latest,null);
  assert.throws(()=>V.providerHistory({...data,id:'WRONG'},'TEST'));
  assert.throws(()=>V.providerHistory({...data,metrics:{pe:{...metric,horizon_months:12}}},'TEST'));
  assert.throws(()=>V.providerHistory({...data,metrics:{pe:{...metric,points:[...metric.points,[dates.at(-1),12]]}}},'TEST'));
  assert.throws(()=>V.providerHistory({...data,metrics:{pe:{...metric,points:[...metric.points,['2026-12-31',12]]}}},'TEST'));
});
