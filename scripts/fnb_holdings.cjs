"use strict";
// Consolidate issuer exposures, rather than adding ETF holding counts together.
const aliases = {
  taiwansemiconductor:"taiwansemiconductormanufacturing",taiwansemiconductormfg:"taiwansemiconductormanufacturing",taiwansemiconductormanufacturingadr:"taiwansemiconductormanufacturing",
  canadiannatlrailway:"canadiannationalrailway",canadiannationalry:"canadiannationalrailway",canadiannaturalres:"canadiannaturalresources",cannaturalresources:"canadiannaturalresources",
  canadianpackansascity:"canadianpacifickansascity",canadianpacificrailway:"canadianpacifickansascity",
  royalbankcda:"royalbankcanada",royalbkcanada:"royalbankcanada",royalbkcda:"royalbankcanada",
  bankmontreal:"bankmontreal",torontodominion:"torontodominionbank",torontodominionbkont:"torontodominionbank",
  cdnimperialbkcommerce:"canadianimperialbankcommerce",canimperialbkcommerce:"canadianimperialbankcommerce",canadianimperialbkcommerce:"canadianimperialbankcommerce",
  natlbankcanada:"nationalbankcanada",nationalbkcanada:"nationalbankcanada",canadapower:"powercanada",
  amazoncom:"amazon",amazoncomamazon:"amazon",amazoncominc:"amazon",google:"alphabet",
  metaplatformsfb:"metaplatforms",facebook:"metaplatforms",eliandlilly:"elililly",elilillyand:"elililly",lillyeli:"elililly",lillyeliand:"elililly",alphabetcapstk:"alphabet",
  asml:"asmlholding",nestle:"nestle",totalenergies:"totalenergies",novonordiskas:"novonordisk",
  mitsuifudosan:"mitsuifudosan",mitsubishiufjfinancialgroupin:"mitsubishiufjfinancialgroup",sumitomomitsuifinancialgroupin:"sumitomomitsuifinancialgroup",
  appliedmatls:"appliedmaterials",intlbusinessmachines:"internationalbusinessmachines",ibm:"internationalbusinessmachines",
  walmarts:"walmart",walmartstores:"walmart",berkshirehathawayb:"berkshirehathaway",capitalpower:"capitalpower",
};
const display = {
  apple:"Apple",nvidia:"NVIDIA",microsoft:"Microsoft",amazon:"Amazon",alphabet:"Alphabet",metaplatforms:"Meta Platforms",broadcom:"Broadcom",tesla:"Tesla",
  taiwansemiconductormanufacturing:"Taiwan Semiconductor (TSMC)",royalbankcanada:"Banque Royale du Canada",torontodominionbank:"Banque TD",bankmontreal:"Banque de Montréal",banknovascotia:"Banque Scotia",canadianimperialbankcommerce:"Banque CIBC",nationalbankcanada:"Banque Nationale",
  enbridge:"Enbridge",canadiannaturalresources:"Canadian Natural Resources",suncorenergy:"Suncor Énergie",tcenergy:"TC Énergie",canadianpacifickansascity:"Canadien Pacifique Kansas City",canadiannationalrailway:"Canadien National",manulifefinancial:"Manuvie",sunlifefinancial:"Financière Sun Life",powercanada:"Power Corporation du Canada",greatwestlifeco:"Great-West Lifeco",alimentationcouchetard:"Alimentation Couche-Tard",fortis:"Fortis",loblawcompanies:"Loblaw",dollarama:"Dollarama",intactfinancial:"Intact Corporation financière",elililly:"Eli Lilly",costcowholesale:"Costco",walmart:"Walmart",cocacola:"Coca-Cola",microntechnology:"Micron Technology",mastercard:"Mastercard",shell:"Shell",totalenergies:"TotalEnergies",asmlholding:"ASML",nestle:"Nestlé",shopify:"Shopify",fairfaxfinancialholdings:"Fairfax Financial",agnicoeaglemines:"Agnico Eagle",weston:"George Weston",georgeweston:"George Weston",
};
function issuerKey(value) {
  let name=String(value).normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\([^)]*\)/g," ");
  name=name.replace(/\b(?:class|cl|cls)\b\.?\s*[-.]?\s*[a-z0-9]+(?:\s+(?:shares?|stock|sub|voting|nonvoting))*\b/g," ")
    .replace(/\b(?:sponsored|unsponsored|depositary|depository|receipts?|adr|adrs|ads|gdr|registered|regd|reg|ordinary|ord|common|com|preferred|pfd|shares?|stock|subordinate|voting|nonvoting|non|npv)\b/g," ")
    .replace(/\b(?:incorporated|inc|corporation|corp|limited|ltd|plc|company|co|sa|se|nv|ag|spa|oyj|pte|berhad|bhd|the|of)\b/g," ")
    .replace(/[^a-z0-9]/g,"");
  return aliases[name]||name;
}
function consolidate(weights, funds) {
  const positions=new Map(),sources=[],partial=[];
  for(const [ticker,weight] of Object.entries(weights)) {
    if(!Number.isFinite(weight)||weight<0)throw Error("Invalid ETF weight: "+ticker);
    if(!weight)continue;const fund=funds[ticker];if(!fund||(!fund.complete&&!(fund.partial===true&&fund.positions?.length)))throw Error("Incomplete holdings: "+ticker);
    if(!fund.complete)partial.push(ticker);
    sources.push({fund:ticker,date:fund.date,url:fund.source_url});
    for(const [raw,pct] of fund.positions) {
      if(!Number.isFinite(pct)||pct<0)throw Error("Invalid stock weight: "+ticker+" "+raw);
      const id=issuerKey(raw);if(!id)throw Error("Missing issuer");
      const item=positions.get(id)||{id,name:display[id]||raw,weight:0,contributions:{}};
      const contribution=weight*pct;item.weight+=contribution;item.contributions[ticker]=(item.contributions[ticker]||0)+contribution;positions.set(id,item);
    }
  }
  const all=[...positions.values()].sort((a,b)=>b.weight-a.weight||a.id.localeCompare(b.id));
  const dates=sources.map(s=>s.date).filter(Boolean).sort();
  return {stock_count:partial.length?null:all.length,top10:all.slice(0,10),top10_weight:partial.length?null:all.slice(0,10).reduce((s,p)=>s+p.weight,0),equity_covered:all.reduce((s,p)=>s+p.weight,0),date_min:dates[0],date_max:dates.at(-1),sources,estimated:true,...(partial.length?{complete:false,partial_funds:partial,coverage_note:'Positions détaillées partielles pour '+partial.join(', ')+'. Nombre de sociétés et concentration des dix premières indisponibles; positions identifiées seulement.'}:{})};
}
module.exports={issuerKey,consolidate};
