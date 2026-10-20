"use strict";
importScripts("fnb-frontier-utils.js?v=20261020-crypto3");
self.onmessage=event=>{const {id,prepared}=event.data;try{self.postMessage({id,result:self.SavyFrontierUtils.solve(prepared)});}catch(error){self.postMessage({id,error:error.message});}};
