"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),E=require('../js/extended-hours-utils.js');
const now=Date.parse('2026-10-28T13:20:00Z');
function hours(overrides={}){return {price:110,timestamp:'2026-10-28T13:15:00Z',session_date:'2026-10-28',
  baseline_price:100,baseline_session_date:'2026-10-27',baseline_timestamp:'2026-10-27T20:00:00Z',
  start:'2026-10-28T08:00:00Z',end:'2026-10-28T13:30:00Z',fetched_at:'2026-10-28T13:20:00Z',fetch_status:'fresh',observation_kind:'candle_close',...overrides};}
function row(id='AAPL',symbol='AAPL',currency='USD'){return {id,quote_symbol:symbol,currency,exchange_timezone:'America/New_York',extended_hours:{pre:hours()}};}
function fixture(){
  const prices={series:[{id:'AAPL',quote_symbol:'AAPL',currency:'USD',history:[['2026-10-27',100]]},
    {id:'SHOP',quote_symbol:'SHOP.TO',currency:'CAD',history:[['2026-10-27',200]]}]};
  const quotes=[row(),{id:'SHOP',quote_symbol:'SHOP.TO',currency:'CAD'},
    {id:'USDCAD',quote_symbol:'CAD=X',currency:'CAD',intraday_sessions:{'2026-10-27':[['2026-10-27T20:00:00Z',1.4]],
      '2026-10-28':[['2026-10-28T13:15:00Z',1.5],['2026-10-28T13:16:00Z',2]]}}];
  return {prices,payload:{quotes},positions:[{ticker:'AAPL',currency:'USD',quantity:1},{ticker:'SHOP',currency:'CAD',quantity:1}]};
}
test('pre/post percentages use the explicit reference close; supplied percentages are never trusted',()=>{
  const q=row();q.extended_hours.pre.percent=999;assert.ok(Math.abs(E.phase(q,'pre',now).percent-10)<1e-10);
  q.extended_hours.pre.price=100;assert.equal(E.phase(q,'pre',now).percent,0);
  q.extended_hours.post=hours({session_date:'2026-10-27',start:'2026-10-27T20:00:00Z',end:'2026-10-28T00:00:00Z',timestamp:'2026-10-27T23:55:00Z'});
  assert.ok(E.phase(q,'post',now));
});
test('malformed, future, wrongly dated and unsupported observations stay unavailable',()=>{
  for(const change of [p=>p.price=null,p=>p.baseline_price=0,p=>p.timestamp='2026-10-28T13:25:00Z',
    p=>p.baseline_session_date='2026-10-28',p=>p.timestamp='2026-10-28T07:00:00Z',p=>p.fetch_status='live']){
    const q=row();change(q.extended_hours.pre);assert.equal(E.phase(q,'pre',now),null);
  }
  assert.equal(E.index({quotes:[]},'FEQT','pre',now).available,false);
});
test('index proxies are explicit, exact listings and never replace official cash prices',()=>{
  const proxy=row('EXTSPX','SPY');assert.equal(E.index({quotes:[proxy]},'SPX','pre',now).source_symbol,'SPY');
  assert.match(E.index({quotes:[row('EXTIXIC','QQQ')]},'IXIC','pre',now).proxy,/distinct du Nasdaq Composite/);
  proxy.currency='CAD';assert.equal(E.index({quotes:[proxy]},'SPX','pre',now).available,false);
});
test('portfolio impact is weighted across all holdings, retains unavailable closes and includes dated CAD FX',()=>{
  const f=fixture(),r=E.portfolio(f.positions,f.prices,f.payload,'pre',now);
  assert.ok(r.available);assert.ok(Math.abs(r.percent-(365/340-1)*100)<1e-10);
  assert.ok(Math.abs(r.coverage-140/340)<1e-10);assert.equal(r.partial,true);assert.equal(r.timestamp,'2026-10-28T13:15:00Z');
});
test('each of the three portfolios uses its own quantities and coverage; a missing quote is never a zero return',()=>{
  const f=fixture();
  for(const quantity of [1,2,5]){
    f.positions[0].quantity=quantity;const r=E.portfolio(f.positions,f.prices,f.payload,'pre',now);
    assert.ok(Math.abs(r.percent-((quantity*165+200)/(quantity*140+200)-1)*100)<1e-10);
  }
  f.payload.quotes[0].extended_hours={};assert.equal(E.portfolio(f.positions,f.prices,f.payload,'pre',now).available,false);
});
test('no future FX, different session, wrong listing or missing baseline can create a complete portfolio percentage',()=>{
  for(const change of [f=>f.payload.quotes[2].intraday_sessions={},f=>f.payload.quotes[0].currency='CAD',
    f=>f.prices.series[1].history=[],f=>f.positions[0].currency='CAD']){
    const f=fixture();change(f);assert.equal(E.portfolio(f.positions,f.prices,f.payload,'pre',now).available,false);
  }
});
test('new extended observations merge independently of an unchanged regular-session quote',()=>{
  const old=row(),next=row();next.extended_hours.pre=hours({price:115,timestamp:'2026-10-28T13:20:00Z'});
  const merged=E.merge(old,next,now);assert.equal(merged.extended_hours.pre.price,115);
  const rolled=E.merge({...old,...merged},old,now);assert.equal(rolled.extended_hours.pre.price,115);
  next.currency='CAD';assert.deepEqual(E.merge(old,next,now),{});
});
