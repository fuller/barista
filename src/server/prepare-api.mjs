import {browserPricingConfigured,createStarbucksBrowserSource} from '../adapters/starbucks-browser-source.mjs';
import {storeServices} from './stores-api.mjs';
import {getQuoteSession,initializeQuoteSession,quoteCacheScope} from './pricing-session.mjs';
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const handlers=new WeakMap();
async function readInput(request){
 const reader=request.body?.getReader();if(!reader)throw Error();let size=0;const chunks=[];
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8192){await reader.cancel();throw Object.assign(Error(),{status:413});}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 const value=JSON.parse(new TextDecoder().decode(bytes));if(!value||Object.keys(value).sort().join(',')!=='selectionToken,storeId')throw Error();return value;
}
export function createPrepareApi({verifyStore,source}={}){
 let pending=0;
 return async request=>{
  if(request.method!=='POST')return json({error:'Method not allowed'},405);
  const origin=request.headers.get('Origin');if(origin&&origin!==new URL(request.url).origin||request.headers.get('Sec-Fetch-Site')==='cross-site')return json({error:'Origin not allowed'},403);
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'Use application/json'},415);
  let value,selectedStore;try{value=await readInput(request);}catch(error){return json({error:'Invalid preparation request'},error.status??400);}
  try{selectedStore=await verifyStore(value.storeId,value.selectionToken);}catch{return json({error:'Choose your store again to refresh live prices.',code:'store_selection_required'},400);}
  const session=getQuoteSession(request),withCookie=response=>initializeQuoteSession(request,response,session);
  if(pending>=8)return withCookie(json({error:'Pricing is busy'},503));pending++;
  try{
   request.signal.throwIfAborted();const result=await source.prepare(session,{selectedStore,signal:request.signal});request.signal.throwIfAborted();
   if(result?.ready!==true)throw Error();
   return withCookie(json({ready:true,storeId:selectedStore.storeId,cacheScope:await quoteCacheScope(session)}));
  }catch(error){const limited=error?.code==='RATE_LIMITED';const response=json({error:'Live pricing unavailable'},limited?429:503);if(limited)response.headers.set('Retry-After',String(Math.max(1,Math.ceil((error.retryAfterMs??60000)/1000))));return withCookie(response);}
  finally{pending--;}
 };
}
export function handlePrepareApi(request,env){
 if(!browserPricingConfigured(env))return json({error:'Live pricing unavailable'},503);
 let handler=handlers.get(env);if(!handler){handler=createPrepareApi({verifyStore:(id,token)=>storeServices(env).selection.verify(id,token),source:createStarbucksBrowserSource({url:env.STARBUCKS_BROWSER_URL,token:env.BARISTA_BROWSER_TOKEN})});handlers.set(env,handler);}return handler(request);
}
