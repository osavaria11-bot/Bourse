'use strict';
importScripts('fnb-factor-utils.js?v=20261024-adaptive-risk','fnb-frontier-utils.js?v=20261025-forward-v2','fnb-forecast-utils.js?v=20261025-forward-v2');
self.onmessage=event=>{
  const {id,data,stress,macro,options,years,ids}=event.data;
  try{self.postMessage({id,result:self.SavyFnbForecast.run(data,stress,macro,options,years,ids)});}
  catch(e){self.postMessage({id,error:e.message});}
};
