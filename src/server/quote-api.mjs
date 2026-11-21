import {validateOrder} from '../domain/order.mjs';
import {createStarbucksBrowserSource,browserPricingConfigured} from '../adapters/starbucks-browser-source.mjs';
import {createStarbucksQuoteService} from '../application/starbucks-quote-service.mjs';
import {resolveOrderQuote} from '../application/resolve-order-quote.mjs';
import directory from '../catalog/data/starbucks-menu-directory.json' with {type:'json'};
import {currentCatalogSnapshot,getCatalogService} from '../catalog/service.mjs';
import {createStarbucksWebsiteSource} from '../adapters/starbucks-website.mjs';
import {storeServices} from './stores-api.mjs';
import {getQuoteSession,initializeQuoteSession,quoteCacheScope} from './pricing-session.mjs';
export {initializeQuoteSession} from './pricing-session.mjs';
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const handlers=new WeakMap();
async function readInput(request){
 const reader=request.body?.getReader();if(!reader)throw Error();let size=0;const chunks=[];
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){await reader.cancel();throw Object.assign(Error(),{status:413});}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 const body=JSON.parse(new TextDecoder().decode(bytes));if(!body||Object.keys(body).sort().join(',')!=='order,selectionToken,storeId')throw Error();validateOrder(body.order);return body;
}
export function createQuoteApi({resolveOrder,service,verifyStore=async()=>{throw Error();},now=Date.now,onFailure=event=>console.warn(event)}={}){
 let resolving=0;
 return async request=>{
  if(request.method!=='POST')return json({error:'Method not allowed'},405);
  const url=new URL(request.url),origin=request.headers.get('Origin');
  if(origin&&origin!==url.origin||request.headers.get('Sec-Fetch-Site')==='cross-site')return json({error:'Origin not allowed'},403);
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'Use application/json'},415);
  let input,order,selectedStore;try{input=await readInput(request);order=input.order;}catch(error){return json({error:'Invalid price request'},error.status??400);}
  try{selectedStore=await verifyStore(input.storeId,input.selectionToken);}catch{return json({error:'Choose your store again to refresh live prices.',code:'store_selection_required'},400);}
  const session=getQuoteSession(request),cacheScope=await quoteCacheScope(session);
  const withCookie=response=>initializeQuoteSession(request,response,session);
  if(resolving>=8)return withCookie(json({error:'Pricing is busy'},503));
  resolving++;
  let stage='resolve';
  try{
   const {items,unpriced}=await resolveOrder(order,{signal:request.signal});
   request.signal.throwIfAborted();
   stage='quote';
   const price=items.length?await service.quote(session,{storeNumber:selectedStore.sourceStoreNumber,items},{signal:request.signal,selectedStore,forceRefresh:request.headers.get('X-Price-Refresh')==='1'}):{currency:'USD',estimated:false,source:'starbucks',storeNumber:selectedStore.sourceStoreNumber,expiresAt:now()+60000,items:[],subtotalCents:0,taxCents:0,totalCents:0,taxLabel:'Tax',provenance:'No verified prices for this configuration'};
   stage='response';
   const lines=[...order.items,...(order.menuItems??[])];
   const unavailable=new Set(unpriced.map(item=>item.itemId));
   const result={...price,cacheScope,storeId:selectedStore.storeId,revision:order.revision,unavailable:unpriced,items:lines.map(item=>price.items.find(line=>line.itemId===item.id)??{itemId:item.id,quantity:item.quantity,unitCents:null,totalCents:null,lines:[]})};
   if(unavailable.size){result.pricedSubtotalCents=price.subtotalCents;result.unpricedItemCount=lines.filter(item=>unavailable.has(item.id)).reduce((n,item)=>n+item.quantity,0);result.subtotalCents=null;result.taxCents=null;result.totalCents=null;result.taxLabel='Tax unavailable';}
   const response=json(result);
   return withCookie(response);
  }catch(error){
   const code=['rate_limited','busy','invalid_request','unavailable'].includes(error?.code)?error.code:'unknown';
   const type=['Error','TypeError','RangeError','AbortError','StarbucksQuoteError'].includes(error?.name)?error.name:'unknown';
   try{onFailure({event:'pricing_unavailable',stage,code,type});}catch{}
   const response=json({error:'Live pricing unavailable'},error.code==='rate_limited'?429:503);if(error.code==='rate_limited')response.headers.set('Retry-After',String(Math.max(1,Math.ceil((error.retryAfterMs??60000)/1000))));return withCookie(response);}finally{resolving--;}
 };
}
export function handleQuoteApi(request,env){
 if(!browserPricingConfigured(env))return json({error:'Live pricing unavailable'},503);
 let handler=handlers.get(env);
 if(!handler){
  const source=createStarbucksWebsiteSource({formCodes:[...new Set(directory.products.map(p=>p.formCode))]});
  const details=new Map();
  const resolveProduct=async (identity,{signal}={})=>{
   signal?.throwIfAborted();
   const entry=details.get(identity);if(entry&&entry.expiresAt>Date.now())return entry.promise;
   const product=directory.products.find(p=>p.identity===identity);if(!product)throw Error();
   const promise=source.loadProduct(product).catch(error=>{details.delete(identity);throw error;});
   details.set(identity,{promise,expiresAt:Date.now()+3600000});while(details.size>128)details.delete(details.keys().next().value);return promise;
  };
  const service=createStarbucksQuoteService({source:createStarbucksBrowserSource({url:env.STARBUCKS_BROWSER_URL,token:env.BARISTA_BROWSER_TOKEN})});
  handler=createQuoteApi({service,verifyStore:(storeId,token)=>storeServices(env).selection.verify(storeId,token),resolveOrder:(order,{signal}={})=>resolveOrderQuote(order,{directory,catalog:getCatalogService(order.catalogVersion).getSnapshot?.()??currentCatalogSnapshot,resolveProduct,signal})});handlers.set(env,handler);
 }
 return handler(request);
}
