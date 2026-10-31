"use strict";
const{test}=require('node:test'),assert=require('node:assert/strict'),U=require('../js/fnb-performance-utils.js');
const h=(date,value)=>({date,value});
test('daily freshness follows Toronto completed sessions, holidays and daylight saving time',()=>{
 for(const [now,expected] of [['2026-10-22T07:00:00-04:00','2026-10-21'],['2026-10-22T16:14:59-04:00','2026-10-21'],['2026-10-22T16:15:00-04:00','2026-10-22'],['2026-10-22T17:59:00-04:00','2026-10-22'],['2026-10-12T20:00:00-04:00','2026-10-09'],['2026-12-28T20:00:00-05:00','2026-12-24'],['2027-03-29T07:00:00-04:00','2027-03-25'],['2026-11-02T16:14:59-05:00','2026-10-30'],['2026-11-02T16:15:00-05:00','2026-11-02'],['2026-10-31T16:15:00-04:00','2026-10-30']])assert.equal(U.expectedSession(new Date(now)),expected,now);
 for(const day of ['2026-05-18','2026-07-01','2026-08-03','2026-09-07'])assert.equal(U.tradingDay(day),false,day);
 assert.equal(U.tradingDay('2026-09-30'),true);
});
test('a green collector status cannot conceal an old or incomplete comparison',()=>{
 const now=new Date('2026-10-22T07:00:00-04:00'),data={as_of:'2026-10-20',accounts:[{history:[h('2026-10-20',10000)]}]};
 const status={status:'current',as_of:'2026-10-20',expected_session:'2026-10-20'};
 assert.equal(U.freshness(data,status,now).stale,true);assert.equal(U.freshness(data,status,now).current,false);
 data.as_of='2026-10-21';status.as_of=status.expected_session=data.as_of;assert.equal(U.freshness(data,status,now).current,true);
 assert.equal(U.freshness(data,null,now).current,false);
 data.accounts[0].history=[];assert.equal(U.freshness(data,status,now).current,false);
});
test('initial session has zero total gain and insufficient daily/weekly/monthly history',()=>{assert.deepEqual(U.metrics([h('2026-10-19',10000)]),{value:10000,gain:0,total:0,day:null,week:null,month:null});});
test('daily, trailing week and trailing month use available preceding closes',()=>{const m=U.metrics([h('2026-10-19',10000),h('2026-10-23',10100),h('2026-11-12',10200),h('2026-11-18',10500),h('2026-11-19',10600)]);assert.ok(Math.abs(m.day-(10600/10500-1))<1e-10);assert.ok(Math.abs(m.week-(10600/10200-1))<1e-10);assert.ok(Math.abs(m.month-.06)<1e-10);assert.equal(m.gain,600);});
test('calendar month clamps March 31 to February 28',()=>{assert.equal(U.monthBefore('2027-03-31'),'2027-02-28');assert.equal(U.monthBefore('2028-03-31'),'2028-02-29');});
test('new monthly account compares to benchmark over its own exact dates',()=>{const a={launch_date:'2026-11-02',capital:10000,history:[h('2026-11-02',10000),h('2026-11-03',10300)]},b={capital:10000,history:[h('2026-10-19',10000),h('2026-11-02',12000),h('2026-11-03',12120)]};assert.ok(Math.abs(U.gap(a,b)-.02)<1e-10);assert.equal(U.rebase(b,'2026-11-02')[0].value,10000);assert.equal(U.rebase(b,'2026-11-02')[1].value,10100);assert.equal(U.gap(a,{history:b.history.slice(0,2)}),null);});
test('ranking shares ties and separates different launch cohorts',()=>{const a=(id,launch,value)=>({id,kind:'portfolio',launch_date:launch,history:[h(launch,10000),h('2026-11-03',value)]});const ranks=U.ranking([a('a','2026-10-19',10500),a('b','2026-10-19',10500),a('c','2026-10-19',10400),a('d','2026-11-02',10100)]);assert.deepEqual([...ranks],[['a',1],['b',1],['c',3],['d',1]]);});
test('published tracking snapshot starts funded accounts at ten thousand and preserves pending launches',()=>{const d=require('../data/fnb-performance.json');assert.equal(U.validate(d),d);assert.ok(d.accounts.length>=16);for(const a of d.accounts)if(a.history.length)assert.ok(Math.abs(a.history[0].value-10000)<.001);const copy=structuredClone(d),a=copy.accounts[0];copy.as_of=a.launch_date;a.history=[h(a.launch_date,11000)];assert.throws(()=>U.validate(copy),/Lancement/);});
test('all common comparisons share 19 October sessions, including explicitly simulated later allocations',()=>{
 const d=require('../data/fnb-comparison.json');assert.equal(U.validateComparison(d),d);
 for(const a of d.accounts){assert.equal(a.launch_date,'2026-10-19');assert.equal(a.history[0].date,'2026-10-19');}
 const robust=d.accounts.filter(a=>a.id.startsWith('robust-'));assert.equal(robust.length,3);
 for(const a of robust){assert.equal(a.series_type,'simulation');assert.equal(a.actual_launch_date,'2026-10-21');assert.equal(a.history.length,d.accounts.find(a=>a.id==='VEQT').history.length);}
 const bad=structuredClone(d);bad.accounts.find(a=>a.id===robust[0].id).series_type='recorded_from_common_start';assert.throws(()=>U.validateComparison(bad),/non signalée/);
 const rank=U.ranking(d.accounts);assert.equal(rank.size,d.accounts.filter(a=>a.kind!=='benchmark').length);
});

