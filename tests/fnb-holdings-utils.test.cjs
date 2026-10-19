const test=require("node:test"),assert=require("node:assert/strict");
const {issuerKey,consolidate}=require("../scripts/fnb_holdings.cjs");
const fund=positions=>({complete:true,date:"2026-09-30",source_url:"https://issuer.example",positions});
test("look-through adds overlapping issuer weights using the total portfolio as denominator",()=>{
 const result=consolidate({A:.25,B:.70,GOLD:.05},{A:fund([["Apple Inc",.08],["Microsoft Corp",.04]]),B:fund([["Apple",.02],["MICROSOFT CORPORATION",.01]]),GOLD:fund([])});
 assert.equal(result.stock_count,2);assert.ok(Math.abs(result.top10[0].weight-.034)<1e-12);assert.ok(Math.abs(result.top10[1].weight-.017)<1e-12);assert.ok(Math.abs(result.top10_weight-.051)<1e-12);
});
test("multiple share classes and known ADR names collapse without merging different Brookfield issuers",()=>{
 assert.equal(issuerKey("Alphabet, Cl. A"),issuerKey("Alphabet Inc - Class C Shares"));
 assert.equal(issuerKey("TAIWAN SEMICONDUCTOR MFG ADR"),issuerKey("Taiwan Semiconductor Manufacturing Co Ltd"));
 assert.equal(issuerKey("ROYAL BANK OF CANADA (FIL USD)"),issuerKey("Royal Bank of Canada"));
 assert.notEqual(issuerKey("Brookfield Corp"),issuerKey("Brookfield Asset Management Ltd"));
 assert.equal(issuerKey("CLARIANT AG"),"clariant");
 assert.equal(issuerKey("Cleanaway Co Ltd"),"cleanaway");
 assert.equal(issuerKey("Alphabet Inc. Cap Stk Cl C"),issuerKey("Alphabet, Cl. A"));
});
test("an unexpanded or missing ETF must fail instead of silently understating stock exposures",()=>{
 assert.throws(()=>consolidate({UNKNOWN:1},{}),/Incomplete holdings/);
 assert.throws(()=>consolidate({A:1},{A:{complete:false,positions:[]}}),/Incomplete holdings/);
 assert.throws(()=>consolidate({A:1},{A:fund([["Apple",NaN]])}),/Invalid stock weight/);
});
