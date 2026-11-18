import {validateOrder} from '../domain/order.mjs';
import {createStarbucksBrowserSource,browserPricingConfigured} from '../adapters/starbucks-browser-source.mjs';
import {createStarbucksQuoteService} from '../application/starbucks-quote-service.mjs';
import {resolveOrderQuote} from '../application/resolve-order-quote.mjs';
import directory from '../catalog/data/starbucks-menu-directory.json' with {type:'json'};
import {currentCatalogSnapshot,getCatalogService} from '../catalog/service.mjs';
import {createStarbucksWebsiteSource} from '../adapters/starbucks-website.mjs';
export const PRICING_STORE={zip:'11201',storeNumber:'85278-313836',storeName:'104 Jay St'};
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const handlers=new WeakMap();
export function initializeQuoteSession(request,response){
 const matches=(request.headers.get('Cookie')??'').split(';').map(c=>c.trim()).filter(c=>c.startsWith('barista_quote='));
 if(matches.length===1&&/^barista_quote=[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(matches[0]))return response;
 response.headers.set('Set-Cookie',`barista_quote=${crypto.randomUUID()}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=900${new URL(request.url).protocol==='https:'?'; Secure':''}`);return response;
}
async function readInput(request){
 const reader=request.body?.getReader();if(!reader)throw Error();let size=0;const chunks=[];
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){await reader.cancel();throw Object.assign(Error(),{status:413});}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 const body=JSON.parse(new TextDecoder().decode(bytes));if(!body||Object.keys(body).join(',')!=='order')throw Error();validateOrder(body.order);return body.order;
}
export function createQuoteApi({resolveOrder,service,now=Date.now,onFailure=event=>console.warn(event)}={}){
 let resolving=0;
 return async request=>{
  if(request.method!=='POST')return json({error:'Method not allowed'},405);
  const url=new URL(request.url),origin=request.headers.get('Origin');
  if(origin&&origin!==url.origin||request.headers.get('Sec-Fetch-Site')==='cross-site')return json({error:'Origin not allowed'},403);
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'Use application/json'},415);
  let order;try{order=await readInput(request);}catch(error){return json({error:'Invalid price request'},error.status??400);}
  const cookies=(request.headers.get('Cookie')??'').split(';').map(c=>c.trim()).filter(c=>c.startsWith('barista_quote='));
  const supplied=cookies.length===1?cookies[0].slice('barista_quote='.length):'';
  const valid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(supplied);
  const session=valid?supplied:crypto.randomUUID();
  const withCookie=response=>{if(!valid)response.headers.set('Set-Cookie',`barista_quote=${session}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=900${url.protocol==='https:'?'; Secure':''}`);return response;};
  if(resolving>=8)return withCookie(json({error:'Pricing is busy'},503));
  resolving++;
  let stage='resolve';
  try{
   const {items,unpriced}=await resolveOrder(order,{signal:request.signal});
   request.signal.throwIfAborted();
   stage='quote';
   const price=items.length?await service.quote(session,{storeNumber:PRICING_STORE.storeNumber,items},{signal:request.signal}):{currency:'USD',estimated:false,source:'starbucks',storeNumber:PRICING_STORE.storeNumber,expiresAt:now()+60000,items:[],subtotalCents:0,taxCents:0,totalCents:0,taxLabel:'Tax',provenance:'No verified prices for this configuration'};
   stage='response';
   const lines=[...order.items,...(order.menuItems??[])];
   const unavailable=new Set(unpriced.map(item=>item.itemId));
   const result={...price,revision:order.revision,unavailable:unpriced,items:lines.map(item=>price.items.find(line=>line.itemId===item.id)??{itemId:item.id,quantity:item.quantity,unitCents:null,totalCents:null,lines:[]})};
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
  handler=createQuoteApi({service,resolveOrder:(order,{signal}={})=>resolveOrderQuote(order,{directory,catalog:getCatalogService(order.catalogVersion).getSnapshot?.()??currentCatalogSnapshot,resolveProduct,signal})});handlers.set(env,handler);
 }
 return handler(request);
}
