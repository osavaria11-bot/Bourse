(function(root,factory){if(typeof module==="object"&&module.exports)module.exports=factory();else root.SavyFrontierUtils=factory();})(typeof globalThis!=="undefined"?globalThis:this,function(){
 "use strict";
 const EPS=1e-10, PERIODS=12;
 const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),matvec=(a,w)=>a.map(row=>dot(row,w));
 const sum=a=>a.reduce((s,v)=>s+v,0),finite=v=>typeof v==="number"&&Number.isFinite(v);
 function project(values,cap=1,total=1){
  if(!Array.isArray(values)||!values.length||values.some(v=>!finite(v))||!finite(cap)||cap<=0||cap>1||!finite(total)||total<0||values.length*cap<total-1e-10)throw Error("Plafond ou allocation impossible");
  if(total===0)return values.map(()=>0);
  let lo=Math.min(...values)-cap,hi=Math.max(...values);
  for(let k=0;k<65;k++){const mid=(lo+hi)/2,s=values.reduce((s,v)=>s+Math.max(0,Math.min(cap,v-mid)),0);if(s>total)lo=mid;else hi=mid;}
  const w=values.map(v=>Math.max(0,Math.min(cap,v-(lo+hi)/2)));let remaining=total-sum(w);
  for(let i=0;i<w.length&&Math.abs(remaining)>1e-15;i++){const step=Math.max(-w[i],Math.min(cap-w[i],remaining));w[i]+=step;remaining-=step;}
  return w;
 }
 function weightsOK(w,cap){return Array.isArray(w)&&w.length>0&&w.every(v=>finite(v)&&v>=-1e-9&&v<=cap+1e-9)&&Math.abs(sum(w)-1)<1e-8;}
 function changeWeight(w,index,target,cap){
  if(!weightsOK(w,cap)||!Number.isInteger(index)||index<0||index>=w.length||!finite(target))throw Error("Pondération invalide");
  if(w.length===1)return [1];
  target=Math.max(0,1-(w.length-1)*cap,Math.min(cap,target));
  const other=w.filter((_,i)=>i!==index),total=sum(other),budget=1-target;
  const adjusted=project(other.map(v=>total>EPS?v*budget/total:budget/other.length),cap,budget);let j=0;
  return w.map((_,i)=>i===index?target:adjusted[j++]);
 }
 function moments(series,benchmark,riskFree){
  const n=benchmark.length,p=series.length;
  if(n<2||!p||!finite(riskFree)||benchmark.some(v=>!finite(v)||v< -1)||series.some(s=>s.length!==n||s.some(v=>!finite(v)||v< -1)))throw Error("Historique commun insuffisant ou invalide");
  const means=series.map(s=>sum(s)/n),bm=sum(benchmark)/n,centered=series.map((s,i)=>s.map(v=>v-means[i]));
  const active=series.map(s=>s.map((v,t)=>v-benchmark[t])),am=active.map(s=>sum(s)/n),ac=active.map((s,i)=>s.map(v=>v-am[i]));
  const covariance=centered.map(a=>centered.map(b=>PERIODS*dot(a,b)/(n-1))),activeCovariance=ac.map(a=>ac.map(b=>PERIODS*dot(a,b)/(n-1)));
  const bmVar=PERIODS*benchmark.reduce((s,v)=>s+(v-bm)**2,0)/(n-1),bmVol=Math.sqrt(Math.max(0,bmVar));
  return {n,series,benchmark,mu:means.map(v=>v*PERIODS),activeMu:am.map(v=>v*PERIODS),covariance,activeCovariance,riskFree,
   reference:{mean:bm*PERIODS,vol:bmVol,sharpe:bmVol>1e-8?(bm*PERIODS-riskFree)/bmVol:null,information:null,tracking:0,excess:0}};
 }

 function extend(data,extra){
  const d=JSON.parse(JSON.stringify(data));
  d.optimization.eligible_funds=d.optimization.eligible_funds.filter(id=>id!=="VEQT"&&id!=="XEQT");
  if(d.universe.returns.RUD&&d.universe.equity.RUD>=.92&&!d.optimization.eligible_funds.includes("RUD"))d.optimization.eligible_funds.push("RUD");
  d.frontier_caps=Object.fromEntries(d.optimization.eligible_funds.map(id=>[id,id==="FINN"?.15:["ZEB","ZEO","XIT"].includes(id)?.05:.35]));
  if(extra){
   if(extra.as_of!==d.assumptions.as_of||JSON.stringify(extra.dates)!==JSON.stringify(d.dates))throw Error("Les nouveaux FNB n’ont pas les mêmes mois que l’analyse. Actualisation nécessaire.");
   for(const [id,f] of Object.entries(extra.funds)){
    if(["VEQT","XEQT"].includes(id)||f.currency!=="CAD"||!["TSX","Cboe Canada"].includes(f.exchange)||f.equity<.92||f.returns.length!==d.dates.length)throw Error("FNB supplémentaire non admissible : "+id);
    for(const key of ["returns","geo","sector","equity","mer"])d.universe[key][id]=f[key];
    d.fund_labels[id]=f.label;d.source_urls[id]=f.source_url;d.source_dates[id]=f.source_dates;d.data_methods[id]=f.method;d.frontier_caps[id]=f.max_weight;
    if(!d.optimization.eligible_funds.includes(id))d.optimization.eligible_funds.push(id);
   }
   d.optimization.source_digest+=":"+extra.source_digest;
  }
  d.optimization.eligible_funds.sort();return d;
 }
 function limitsFor(data,ids,cap){
  const settings=data.optimization.constraints||{},u=data.universe,eq=ids.map(id=>u.equity[id]),rows=[],bounds=[],labels=[];
  const add=(row,bound,label)=>{const norm=Math.sqrt(dot(row,row));if(norm<1e-14){if(bound< -1e-10)throw Error("Expositions incompatibles");return;}rows.push(row.map(v=>v/norm));bounds.push(bound/norm);labels.push(label);};
  const caps=ids.map(id=>Math.min(cap,data.frontier_caps?.[id]??(["ZEB","ZEO","XIT"].includes(id)?.05:id==="FINN"?.15:.35)));
  ids.forEach((id,i)=>{const row=ids.map((_,j)=>i===j?1:0);add(row,caps[i],id+" maximum");add(row.map(v=>-v),0,id+" minimum");});
  const groups=[
   {key:"geo",ref:u.ref_geo,tolerance:settings.geo_tolerance??.1,cap:1},
   {key:"sector",ref:u.ref_sector,tolerance:settings.sector_tolerance??.1,cap:settings.sector_cap??.35}
  ];
  for(const group of groups){
   if(!Array.isArray(group.ref))throw Error("Expositions VEQT manquantes");
   group.ref.forEach((reference,k)=>{
    let lower=Math.max(0,reference-group.tolerance),upper=Math.min(group.cap,reference+group.tolerance);
    if(group.key==="geo"&&k<4){lower=Math.max(lower,[.30,.15,.15,.05][k]);upper=Math.min(upper,[.60,.40,.40,.20][k]);}
    if(group.key==="geo"&&k===4)upper=Math.min(upper,settings.unknown_geography_cap??.05);
    const values=ids.map(id=>u[group.key][id]?.[k]);
    if(values.some(v=>!finite(v)))throw Error("Expositions incomplètes");
    add(values.map((v,i)=>(v-upper)*eq[i]),0,group.key+" "+k+" maximum");
    add(values.map((v,i)=>(lower-v)*eq[i]),0,group.key+" "+k+" minimum");
   });
  }
  return {rows,bounds,labels,caps,equity:eq,geo:ids.map(id=>u.geo[id]),sector:ids.map(id=>u.sector[id]),refGeo:u.ref_geo,refSector:u.ref_sector,geoTolerance:settings.geo_tolerance??.1,sectorTolerance:settings.sector_tolerance??.1,sectorCap:settings.sector_cap??.35,unknownCap:settings.unknown_geography_cap??.05};
 }
 function feasible(w,limits,tol=2e-8){
  return weightsOK(w,1)&&(!limits||limits.rows.every((r,i)=>dot(r,w)<=limits.bounds[i]+tol));
 }
 // Dykstra projection is used only to obtain a feasible starting point.
 // It never substitutes a feasible but unoptimized point for a solved frontier.
 function feasibleStart(values,limits){
  if(feasible(values,limits,1e-10))return [...values];
  const n=values.length,A=[Array(n).fill(1/Math.sqrt(n)),...limits.rows],b=[1/Math.sqrt(n),...limits.bounds],p=A.map(()=>Array(n).fill(0));let w=[...values];
  for(let pass=0;pass<16000;pass++){
   const prev=[...w];
   for(let j=0;j<A.length;j++){
    const a=A[j],v=w.map((x,i)=>x+p[j][i]),gap=dot(a,v)-b[j],step=(j===0?gap:Math.max(0,gap))/dot(a,a);
    const next=v.map((x,i)=>x-step*a[i]);p[j]=v.map((x,i)=>x-next[i]);w=next;
   }
   if(pass%8===0&&Math.max(...w.map((v,i)=>Math.abs(v-prev[i])))<1e-11&&feasible(w,limits,2e-9))return w;
  }
  throw Error("Cet univers ne permet pas les limites par FNB, région et secteur. Réactivez les FNB diversifiants.");
 }
 function linearSolve(matrix,rhs){
  const n=rhs.length,a=matrix.map((row,i)=>[...row,rhs[i]]);
  for(let k=0;k<n;k++){
   let pivot=k;for(let i=k+1;i<n;i++)if(Math.abs(a[i][k])>Math.abs(a[pivot][k]))pivot=i;
   if(Math.abs(a[pivot][k])<1e-13)return null;
   [a[k],a[pivot]]=[a[pivot],a[k]];const v=a[k][k];for(let j=k;j<=n;j++)a[k][j]/=v;
   for(let i=0;i<n;i++)if(i!==k){const f=a[i][k];if(f!==0)for(let j=k;j<=n;j++)a[i][j]-=f*a[k][j];}
  }
  return a.map(row=>row[n]);
 }
 function independent(rows,candidate){
  const basis=[];for(const row of [...rows,candidate]){
   let r=[...row];for(const q of basis){const v=dot(r,q);r=r.map((x,i)=>x-v*q[i]);}
   const norm=Math.sqrt(dot(r,r));if(norm<1e-8){if(row===candidate)return false;continue;}basis.push(r.map(v=>v/norm));
  }return true;
 }
 // Feasible active-set QP for the full polytope of fund, regional and sector limits.
 // A primal/dual residual bound certifies the solution of the unregularized QP.
 function constrainedQuadratic(c,linear,cap,warm,limits){
  const n=linear.length,unit=Array(n).fill(1),ridge=1e-10,H=c.map((r,i)=>r.map((v,j)=>v+(i===j?ridge:0)));
  let w=feasibleStart(warm||Array(n).fill(1/n),limits),active=[];
  const eq=unit.map(v=>v/Math.sqrt(n));
  for(let j=0;j<limits.rows.length;j++)if(Math.abs(dot(limits.rows[j],w)-limits.bounds[j])<2e-8&&independent([eq,...active.map(k=>limits.rows[k])],limits.rows[j]))active.push(j);
  let gap=Infinity,iterations=0;
  for(;iterations<1400;iterations++){
   const g=matvec(H,w).map((v,i)=>v-linear[i]),rows=[eq,...active.map(j=>limits.rows[j])];
   const kkt=[...H.map((row,i)=>[...row,...rows.map(r=>r[i])]),...rows.map(row=>[...row,...rows.map(()=>0)])];
   const step=linearSolve(kkt,[...g.map(v=>-v),...rows.map(()=>0)]);
   if(!step)throw Error("Contraintes numériquement dépendantes");
   const p=step.slice(0,n),lambda=step.slice(n);
   if(Math.max(...p.map(Math.abs))<2e-7){
    let drop=-1;for(let j=0;j<active.length;j++)if(lambda[j+1]< -2e-8&&(drop<0||lambda[j+1]<lambda[drop+1]))drop=j;
    if(drop>=0){active.splice(drop,1);continue;}
    const rawG=matvec(c,w).map((v,i)=>v-linear[i]);
    const residual=rawG.map((v,i)=>v+rows.reduce((s,r,j)=>s+r[i]*lambda[j],0));
    gap=2*Math.max(...residual.map(Math.abs))+active.reduce((s,j,k)=>s+Math.abs(lambda[k+1])*Math.max(0,limits.bounds[j]-dot(limits.rows[j],w)),0);
    if(feasible(w,limits)&&gap<2e-7*(1+Math.max(...linear.map(Math.abs))))break;
   }
   let alpha=1,blocking=-1;
   for(let j=0;j<limits.rows.length;j++){
    if(active.includes(j))continue;const denom=dot(limits.rows[j],p);
    if(denom>1e-10){const step=(limits.bounds[j]-dot(limits.rows[j],w))/denom;if(step<alpha){alpha=Math.max(0,step);blocking=j;}}
   }
   w=w.map((v,i)=>v+alpha*p[i]);
   if(blocking>=0&&independent([eq,...active.map(k=>limits.rows[k])],limits.rows[blocking]))active.push(blocking);
  }
  const objective=.5*dot(w,matvec(c,w))-dot(linear,w);
  if(iterations===1400||!feasible(w,limits)||!finite(gap)||gap>2e-7*(1+Math.max(...linear.map(Math.abs))))throw Error("Optimisation diversifiée non convergée");
  w=w.map(v=>Math.abs(v)<1e-12?0:v);
  return {weights:w,gap,iterations,objective};
 }
 function allocate(prepared,values){
  if(!prepared.limits)return project(values,prepared.cap);
  const n=values.length,I=values.map((_,i)=>values.map((_,j)=>i===j?1:0));
  return constrainedQuadratic(I,values,prepared.cap,prepared.feasible,prepared.limits).weights;
 }
 function edit(prepared,w,index,target){
  if(!prepared.limits)return changeWeight(w,index,target,prepared.cap);
  const desired=changeWeight(w,index,target,prepared.cap),importance=100,n=w.length;
  const H=w.map((_,i)=>w.map((_,j)=>i===j?(i===index?importance:1):0)),linear=desired.map((v,i)=>v*(i===index?importance:1));
  return constrainedQuadratic(H,linear,prepared.cap,w,prepared.limits).weights;
 }
 function exposures(prepared,w){
  const L=prepared.limits;if(!L)return null;const total=dot(w,L.equity);
  const mix=key=>L[key][0].map((_,k)=>w.reduce((s,v,i)=>s+v*L.equity[i]*L[key][i][k],0)/total);
  const geo=mix("geo"),sector=mix("sector");
  return {geo,sector,maxGeoGap:Math.max(...geo.map((v,i)=>Math.abs(v-L.refGeo[i]))),maxSectorGap:Math.max(...sector.map((v,i)=>Math.abs(v-L.refSector[i]))),maxSector:Math.max(...sector),valid:feasible(w,L),equity:total};
 }

 function prepare(data,options={}){
  const available=data.optimization?.eligible_funds?.filter(id=>!["VEQT","XEQT"].includes(id));
  const monthIndex=d=>Number(d.slice(0,4))*12+Number(d.slice(5));
  if(!Array.isArray(available)||!Array.isArray(data.dates)||data.dates.length<24||new Set(data.dates).size!==data.dates.length||data.dates.some((d,i)=>!/^\d{4}-(0[1-9]|1[0-2])$/.test(d)||(i&&monthIndex(d)!==monthIndex(data.dates[i-1])+1))||data.assumptions.as_of.slice(0,7)!==data.dates.at(-1))throw Error("Données FNB mensuelles insuffisantes");
  const ids=options.ids||available,cap=options.cap??.4,riskFree=options.riskFree??data.assumptions.risk_free;
  if(!Array.isArray(ids)||new Set(ids).size!==ids.length||ids.some(id=>!available.includes(id))||ids.length*cap<1-1e-9||cap<=0||cap>1)throw Error("Choisir assez de FNB admissibles pour ce plafond");
  const source=ids.map(id=>data.universe.returns[id]),benchmark=data.universe.returns.VEQT;
  if(!Array.isArray(benchmark)||benchmark.length!==data.dates.length||source.some(s=>!Array.isArray(s)||s.length!==benchmark.length))throw Error("Périodes des FNB et de VEQT incompatibles");
  const split=options.sample!=="all"&&benchmark.length>=36?benchmark.length-12:benchmark.length;
  const fit=moments(source.map(s=>s.slice(0,split)),benchmark.slice(0,split),riskFree);
  const validation=split<benchmark.length?moments(source.map(s=>s.slice(split)),benchmark.slice(split),riskFree):null;
  const limits=limitsFor(data,ids,cap),seed=ids.map(id=>data.results.proposal?.weights[id]||0),feasibleWeights=feasibleStart(project(seed,cap),limits);
  return {ids:[...ids],cap,riskFree,fit,validation,limits,feasible:feasibleWeights,dates:{fit:data.dates.slice(0,split),validation:data.dates.slice(split)},asOf:data.assumptions.as_of};
 }
 function metrics(model,w){
  if(!weightsOK(w,1)||w.length!==model.mu.length)throw Error("Les poids doivent totaliser 100 %");
  const variance=Math.max(0,dot(w,matvec(model.covariance,w))),activeVariance=Math.max(0,dot(w,matvec(model.activeCovariance,w)));
  const mean=dot(w,model.mu),vol=Math.sqrt(variance),tracking=Math.sqrt(activeVariance),excess=dot(w,model.activeMu);
  const monthly=model.benchmark.map((_,t)=>model.series.reduce((s,series,i)=>s+w[i]*series[t],0));
  const wealth=monthly.reduce((p,r)=>p*(1+r),1);
  return {mean,vol,variance,tracking,excess,sharpe:vol>1e-8?(mean-model.riskFree)/vol:null,information:tracking>1e-8?excess/tracking:null,cagr:wealth**(PERIODS/model.n)-1};
 }
 function linearOpt(g,cap,maximize=false){
  const w=g.map(()=>0),order=g.map((_,i)=>i).sort((i,j)=>(maximize?g[j]-g[i]:g[i]-g[j])||i-j);let left=1;
  for(const i of order){w[i]=Math.min(cap,left);left-=w[i];if(left<1e-14)break;}return w;
 }
 // Convex box/budget QP, exact pair-coordinate steps. The Frank-Wolfe gap certifies each solve.
 function quadratic(c,linear,cap,warm,limits){
  if(limits)return constrainedQuadratic(c,linear,cap,warm,limits);
  const n=linear.length,w=project(warm||Array(n).fill(1/n),cap),cw=matvec(c,w),g=cw.map((v,i)=>v-linear[i]);
  const tolerance=2e-10*(1+Math.max(...linear.map(Math.abs),...c.map((r,i)=>Math.abs(r[i]))));let iterations=0;
  for(;iterations<30000;iterations++){
   let i=-1,j=-1;
   for(let k=0;k<n;k++){if(w[k]<cap-1e-12&&(i<0||g[k]<g[i]))i=k;if(w[k]>1e-12&&(j<0||g[k]>g[j]))j=k;}
   if(i<0||j<0||g[j]-g[i]<=tolerance)break;
   const curvature=Math.max(0,c[i][i]+c[j][j]-2*c[i][j]),limit=Math.min(cap-w[i],w[j]);
   const step=curvature>1e-18?Math.min(limit,(g[j]-g[i])/curvature):limit;
   if(step<=1e-15)break;
   w[i]+=step;w[j]-=step;for(let k=0;k<n;k++)g[k]+=step*(c[k][i]-c[k][j]);
  }
  const gap=Math.max(0,dot(g,w)-dot(g,linearOpt(g,cap))),objective=.5*dot(w,matvec(c,w))-dot(linear,w);
  if(!weightsOK(w,cap)||gap>1e-7*(1+Math.abs(objective)))throw Error("Optimisation non convergée; aucune frontière approximative publiée");
  return {weights:w,gap,iterations};
 }
 function trace(model,cap,active=false,count=60,limits=null,start=null){
  const c=active?model.activeCovariance:model.covariance,mu=model.mu,mid=sum(mu)/mu.length,center=mu.map(v=>v-mid);
  const range=Math.max(1e-4,Math.max(...mu)-Math.min(...mu)),scale=Math.max(1e-8,...c.map((r,i)=>r[i]))/range;
  const first=quadratic(c,mu.map(()=>0),cap,start,limits),points=[{...metrics(model,first.weights),...first,lambda:0}];let warm=first.weights;
  for(let k=0;k<count;k++){
   const lambda=scale*10**(-5+8*k/(count-1)),q=quadratic(c,center.map(v=>v*lambda),cap,warm,limits);warm=q.weights;
   points.push({...metrics(model,warm),...q,lambda});
  }
  // Keep the QP endpoint: a pure maximum-mean vertex can be dominated when means tie.
  return {points,c,center,scale,limits};
 }
 function bestRatio(model,cap,curve,key){
  const valid=p=>finite(p[key])&&(key==="sharpe"?p.mean>model.riskFree+1e-10:p.excess>1e-10)&&p[key]>0;
  let index=-1;for(let i=0;i<curve.points.length;i++)if(valid(curve.points[i])&&(index<0||curve.points[i][key]>curve.points[index][key]))index=i;
  if(index<0)return null;
  let best=curve.points[index];if(index===0||index===curve.points.length-1)return best;
  let a=Math.log(curve.points[index-1].lambda||curve.scale*1e-6),b=Math.log(curve.points[index+1].lambda||curve.scale*1e4);
  const phi=(Math.sqrt(5)-1)/2,evalAt=x=>{
   const q=quadratic(curve.c,curve.center.map(v=>v*Math.exp(x)),cap,best.weights,curve.limits),p={...metrics(model,q.weights),...q,lambda:Math.exp(x)};
   if(valid(p)&&p[key]>best[key])best=p;return valid(p)?p[key]:-Infinity;
  };
  let x=b-phi*(b-a),y=a+phi*(b-a),fx=evalAt(x),fy=evalAt(y);
  for(let i=0;i<28;i++){if(fx<fy){a=x;x=y;fx=fy;y=a+phi*(b-a);fy=evalAt(y);}else{b=y;y=x;fy=fx;x=b-phi*(b-a);fx=evalAt(x);}}
  return best;
 }
 function pareto(points){
  let high=-Infinity;return points.filter(p=>finite(p.sharpe)&&finite(p.information)).sort((a,b)=>b.sharpe-a.sharpe||b.information-a.information).filter(p=>{if(p.information<=high+1e-10)return false;high=p.information;return true;}).reverse();
 }
 function compromise(points,priority=.5){
  const choices=pareto(points);if(!choices.length)return null;
  const sr=choices.map(p=>p.sharpe),ir=choices.map(p=>p.information),loS=Math.min(...sr),loI=Math.min(...ir),spanS=Math.max(...sr)-loS,spanI=Math.max(...ir)-loI;
  const score=p=>priority*(spanS>EPS?(p.sharpe-loS)/spanS:1)+(1-priority)*(spanI>EPS?(p.information-loI)/spanI:1);
  return choices.reduce((best,p)=>score(p)>score(best)+1e-12?p:best,choices[0]);
 }
 function solve(prepared){
  const {fit,cap}=prepared,absolute=trace(fit,cap,false,60,prepared.limits,prepared.feasible),active=trace(fit,cap,true,60,prepared.limits,prepared.feasible),sharpe=bestRatio(fit,cap,absolute,"sharpe"),information=bestRatio(fit,cap,active,"information");
  const candidates=[...absolute.points,...active.points];if(sharpe)candidates.push(sharpe);if(information)candidates.push(information);
  let seed=271828;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return (seed+.5)/4294967296;};
  const cloud=[];
  for(let k=0;k<420;k++){const raw=prepared.ids.map(()=>(-Math.log(random()))**(k%3===0?3:1)),w=prepared.limits?(()=>{const a=candidates[Math.floor(random()*candidates.length)].weights,b=candidates[Math.floor(random()*candidates.length)].weights,t=random();return a.map((v,i)=>v*t+b[i]*(1-t));})():project(raw,cap),p={...metrics(fit,w),weights:w};cloud.push(p);}
  candidates.push(...cloud);
  if(sharpe&&information)for(let i=0;i<=80;i++){const w=sharpe.weights.map((v,k)=>v*i/80+information.weights[k]*(1-i/80));candidates.push({...metrics(fit,w),weights:w});}
  return {absolute:absolute.points,active:active.points,sharpe,information,cloud,pareto:pareto(candidates),candidates,
   maxSolverGap:Math.max(...absolute.points.map(p=>p.gap),...active.points.map(p=>p.gap))};
 }
 function marginals(prepared,w){
  const base=metrics(prepared.fit,w),cw=matvec(prepared.fit.covariance,w);
  return w.map((v,i)=>{
   if(v>prepared.cap-.01+1e-10)return {sharpe:null,information:null,riskShare:base.variance>EPS?v*cw[i]/base.variance:null};
   const changed=changeWeight(w,i,Math.min(prepared.cap,v+.01),prepared.cap);
   if(!feasible(changed,prepared.limits))return {sharpe:null,information:null,riskShare:base.variance>EPS?v*cw[i]/base.variance:null};
   const next=metrics(prepared.fit,changed);
   return {sharpe:finite(next.sharpe)&&finite(base.sharpe)?next.sharpe-base.sharpe:null,
    information:finite(next.information)&&finite(base.information)?next.information-base.information:null,riskShare:base.variance>EPS?v*cw[i]/base.variance:null,step:changed[i]-v};
  });
 }
 return {extend,limitsFor,feasible,feasibleStart,constrainedQuadratic,allocate,edit,exposures,project,changeWeight,weightsOK,moments,prepare,metrics,quadratic,trace,bestRatio,pareto,compromise,solve,marginals};
});
