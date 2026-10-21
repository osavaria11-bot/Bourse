"use strict";
const fs=require("node:fs"),U=require("../js/fnb-frontier-utils.js");
const d=U.extend(require("../data/fnb-analysis.json"),require("../data/fnb-frontier-universe.json")),p=U.prepare(d);
const results=[];
for(const active of [false,true])for(const lambda of [.02,.1,1]){
 const c=active?p.fit.activeCovariance:p.fit.covariance,linear=p.fit.mu.map(v=>v*lambda);
 results.push({active,lambda,c,linear,...U.quadratic(c,linear,p.cap,p.feasible,p.limits)});
}
process.stdout.write(JSON.stringify({limits:p.limits,start:p.feasible,results}));
