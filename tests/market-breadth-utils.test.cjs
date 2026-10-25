'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),U=require('../js/market-breadth-utils.js'),P=require('../js/portal-utils.js');
function sample(){return {schema_version:1,windows:[20,50,100,200],markets:U.IDS.map(id=>({id,product:'https://www.ishares.com/us/products/test',status:'current',history:[{date:'2026-10-20',universe:100,above:{20:50,50:60,100:70,200:80},eligible:{20:100,50:100,100:100,200:100},values:{20:50,50:60,100:70,200:80}},{date:'2026-10-21',universe:100,above:{20:60,50:60,100:70,200:80},eligible:{20:100,50:100,100:100,200:100},values:{20:60,50:60,100:70,200:80}}]}))};}
test('the breadth tab is adjacent to rates and preserves normal routing',()=>{const tabs=Object.keys(P.PAGES.marches.tabs);assert.equal(tabs[tabs.indexOf('rates')+1],'breadth');assert.deepEqual(P.route('#view=marches&tab=breadth'),{page:'marches',tab:'breadth'});});
test('four markets and real count denominators are validated without changing data',()=>{const d=sample(),before=JSON.stringify(d);assert.equal(U.normalize(d),d);assert.equal(JSON.stringify(d),before);});
test('invalid percentages, coverage, dates and missing markets are rejected',()=>{for(const mutate of [d=>d.markets.pop(),d=>d.markets[0].history[0].values[20]=101,d=>d.markets[0].history[0].above[20]=200,d=>d.markets[0].history[0].eligible[20]=80,d=>d.markets[0].history[0].date='2026-02-30',d=>d.markets[0].history.reverse()]){const d=sample();mutate(d);assert.throws(()=>U.normalize(d));}});
test('latest complete observation and pointer selection never substitute a missing figure',()=>{const m=sample().markets[0];m.history.at(-1).values[200]=null;assert.equal(U.latest(m).date,'2026-10-20');assert.equal(U.nearest(m.history,1).date,'2026-10-21');assert.equal(U.nearest([],0),null);assert.deepEqual(U.range([], '1Y'),[]);});

test('ten-year ranges and dated RSI readings preserve gaps and reject impossible oscillator values',()=>{
 const history=[{date:'2015-01-01'},{date:'2016-10-23'},{date:'2026-10-23'}];assert.equal(U.range(history,'10Y').length,2);
 const m={rsi_history:[{date:'2026-10-20',value:52},{date:'2026-10-21',value:null}]};assert.equal(U.rsiAt(m,'2026-10-20').value,52);assert.equal(U.rsiAt(m,'2026-10-22').value,null);assert.equal(U.rsiAt(m,'2026-10-26'),null);
 const d=sample();d.markets[0].rsi_history=[{date:'2026-10-20',value:101}];assert.throws(()=>U.normalize(d));
});
