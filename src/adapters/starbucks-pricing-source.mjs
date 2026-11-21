import {normalizeStoreQuery} from '../domain/store-query.mjs';
import {StarbucksGuestError} from './starbucks-guest-session.mjs';
const unavailable=()=>new StarbucksGuestError('UNAVAILABLE',503);
const LIMIT=262144;
function configuration(url,token){
 const parsed=new URL(url);
 if(parsed.username||parsed.password||parsed.search||parsed.hash||parsed.pathname!=='/'||!(parsed.protocol==='https:'||parsed.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(parsed.hostname))||typeof token!=='string'||token.length<32||token.length>512||/[\r\n]/.test(token))throw new Error('Invalid pricing service configuration');
 return parsed.origin;
}
export function pricingServiceConfiguration(env){return {url:env.STARBUCKS_PRICING_URL,token:env.PRICING_SERVICE_TOKEN};}
export function pricingServiceConfigured(env){try{const {url,token}=pricingServiceConfiguration(env);configuration(url,token);return true;}catch{return false;}}
export function createStarbucksPricingSource({url,token,fetchImpl=fetch,timeoutMs=80000}={}){
 const origin=configuration(url,token);
 async function send(path,body,signal){
  signal?.throwIfAborted();
  try{
   const response=await fetchImpl(origin+path,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body),redirect:'manual',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs)});
   if(!response.ok){void response.body?.cancel().catch(()=>{});const retry=response.headers.get('Retry-After');const ms=retry!==null&&/^\d+$/.test(retry)?Math.max(1000,Math.min(Number(retry)*1000,3600000)):null;if(response.status===429)throw new StarbucksGuestError('RATE_LIMITED',429,ms??60000);if(response.status===503&&ms!==null)throw new StarbucksGuestError('BUSY',503,ms);throw unavailable();}
   if(!response.headers.get('Content-Type')?.includes('application/json')||Number(response.headers.get('Content-Length'))>LIMIT)throw unavailable();
   const reader=response.body?.getReader();if(!reader)throw unavailable();const chunks=[];let size=0;
   for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>LIMIT){await reader.cancel();throw unavailable();}chunks.push(value);}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
   signal?.throwIfAborted();return JSON.parse(new TextDecoder().decode(bytes));
  }catch(error){if(error instanceof StarbucksGuestError)throw error;throw unavailable();}
 }
 return {
  async searchStores(query,{signal}={}){
   try{query=normalizeStoreQuery(query);}catch{throw unavailable();}
   return send('/stores',{query},signal);
  },
  quote:(sessionKey,body,{signal,selectedStore}={})=>{const {selectionToken,...store}=selectedStore??{};return send('/quote',{sessionKey,body,selectedStore:store},signal);},
  clear(sessionKey){void send('/clear',{sessionKey}).catch(()=>{});}
 };
}
