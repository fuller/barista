import {createHeadedTransport} from './headed-transport.mjs';

/** Public store lookup and process health never need a browser process. */
export function createLazyPricingTransport({createTransport=createHeadedTransport}={}){
 let transport=null,startup=null,failed=false,closed=false,stopped=null,disposal=null;
 const unavailable=()=>Error('Browser unavailable');
 const dispose=value=>disposal??=Promise.resolve().then(()=>value.close());
 function get(){
  if(closed)return Promise.reject(unavailable());
  startup??=Promise.resolve().then(createTransport).then(async value=>{
   if(closed){await dispose(value);throw unavailable();}
   transport=value;return value;
  }).catch(()=>{failed=true;throw unavailable();});
  return startup;
 }
 return {
  status(){
   if(transport&&!closed)return {...transport.status(),browserStarted:true,browserFailed:false};
   return {ready:false,sessions:0,awaitingSetup:0,sessionCapacity:4,busy:false,cooldownMs:0,browserStarted:false,browserStarting:Boolean(startup)&&!failed&&!closed,browserFailed:failed,setupFailures:{access_denied:0,rate_limited:0,setup_incomplete:0},setupHttpStatuses:{document:{},guest:{}}};
  },
  async prepare(...args){const value=await get();if(closed)throw unavailable();return value.prepare(...args);},
  async quote(...args){const value=await get();if(closed)throw unavailable();return value.quote(...args);},
  async clear(...args){if(!startup||closed)return;const value=await startup;if(!closed)return value.clear(...args);},
  close(){
   if(!stopped){closed=true;stopped=transport?dispose(transport):startup?startup.then(dispose,()=>{}):Promise.resolve();}
   return stopped;
  }
 };
}
