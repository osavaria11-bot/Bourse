"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const D=require('../data/fnb-analysis.json'),C=require('../data/fnb-horizon-ranking.json'),render=require('../scripts/fnb_horizon_view.cjs'),root=path.resolve(__dirname,'..');
test('horizon preferences are dated qualitative opinions, with distinct top fives and a common VFV objective',()=>{
 assert.equal(render.validate(C,D),C);assert.equal(C.probabilities_calibrated,false);
 assert.deepEqual(C.horizons.map(h=>h.order[0]),['7','robust-2026-10-2','robust-2026-10-3']);
 for(const change of [c=>c.probabilities_calibrated=true,c=>c.benchmark='VEQT',c=>c.horizons[0].order[1]=c.horizons[0].order[0],c=>c.horizons[0].order[0]='missing',c=>c.horizons[1].years=3,c=>c.data_as_of='2099-01-01']){
  const copy=structuredClone(C);change(copy);assert.throws(()=>render.validate(copy,D));
 }
});
test('opinion rendering is idempotent, retains historical rankings, and never edits financial data',()=>{
 const before=JSON.stringify(D),html=fs.readFileSync(path.join(root,'reports/portefeuilles-fnb.html'),'utf8');
 const first=render(html,D,root);assert.equal(render(first,D,root),first);assert.equal(JSON.stringify(D),before);
 const body=first.match(/<!-- fnb-horizon:start -->([\s\S]*?)<!-- fnb-horizon:end -->/)[1];
 assert.equal((body.match(/data-open-portfolio=/g)||[]).length,15);assert.match(body,/pas probabilités calculées/);
 assert.match(body,/S&amp;P 500 en CAD/);assert.match(body,/Avis du 2026-10-24/);assert.ok(!body.includes('<details class="horizon-ranking" open'));
 assert.equal((first.match(/data-preference=/g)||[]).length,D.preference_ranking.entries.length);
 assert.ok(first.indexOf('class="horizon-panel"')<first.indexOf('class="all-layout"'),'Horizon choices appear before the comparison table and historical list');
 assert.equal((body.match(/class="horizon-first"/g)||[]).length,3,'The first choice is highlighted for each horizon');
 assert.equal((body.match(/data-horizon-top=/g)||[]).length,3,'The three top fives are outside the methodology disclosure');
 assert.ok(body.indexOf('class="horizon-columns"')<body.indexOf('<details'),'Top fives remain visible without opening details');
});
