import {validateStoreQuery,sanitizePublicStores} from './public-stores.mjs';
import {createPublicStoreProxy} from './store-proxy.mjs';
import {validateSelectedStore} from './selected-store.mjs';
import {timingSafeEqual} from 'node:crypto';
import {buildStarbucksQuoteRequest,normalizeStarbucksQuote} from '../adapters/starbucks-quote-protocol.mjs';
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function validateQuoteBody(body){
 const order=body?.variables?.order;
 if(!order||!Array.isArray(order.cart?.items))throw Error('invalid');
 const units=order.cart.items;
 if(units.length<1||units.length>100)throw Error('invalid');
 const builtUnits=units.map((i,n)=>buildStarbucksQuoteRequest({storeNumber:order.storeNumber,fulfillment:order.fulfillment,items:[{itemId:String(n),sku:i.commerce?.sku,quantity:1,modifiers:i.childItems?.map(c=>({sku:c.commerce?.sku,quantity:c.quantity}))}]}).body);
 const rebuilt=builtUnits[0];
 rebuilt.variables.order.cart.items=builtUnits.map(unit=>unit.variables.order.cart.items[0]);
 const keys=new Set();
 rebuilt.variables.order.cart.items.forEach((item,n)=>{const original=units[n];if(typeof original.key!=='string'||!/^[A-Za-z0-9_:()/.-]{1,128}$/.test(original.key)||keys.has(original.key)||original.quantity!==1)throw Error('invalid');keys.add(original.key);item.key=original.key;});
 // Key order is immaterial; unknown fields are prohibited.
 const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
 if(!equal(canonical(body),canonical(rebuilt)))throw Error('invalid');
 return rebuilt;
}
export function sanitizeEnvelope(envelope,body){
 const correlation=body.variables.order.cart.items.map(i=>({key:i.key,itemId:i.key,sku:i.commerce.sku,quantity:1,modifiers:i.childItems.map(c=>({sku:c.commerce.sku,quantity:c.quantity}))}));
 normalizeStarbucksQuote(envelope,{correlation,storeNumber:body.variables.order.storeNumber});
 const source=envelope.data.priceOrder;
 return {data:{priceOrder:{__typename:source.__typename,currency:source.currency,expiresIn:source.expiresIn,cart:{items:source.cart.items.map(i=>({key:i.key,sku:i.sku,quantity:i.quantity,price:i.price,isAvailable:i.isAvailable,availability:i.availability,lineItems:i.lineItems.map(l=>({key:l.key,sku:l.sku,quantity:l.quantity,label:l.label,price:l.price}))}))},summary:{price:source.summary.price,lineItems:source.summary.lineItems.map(l=>({key:l.key,price:l.price})),additionalFeeDescription:[]}}}};
}
export function createBrowserPricingHandler({token,transport,stores=createPublicStoreProxy()}){
 if(typeof token!=='string'||token.length<32)throw Error('BARISTA_BROWSER_TOKEN must contain at least 32 characters');
 const expected=Buffer.from(`Bearer ${token}`);
 return async request=>{
  const supplied=Buffer.from(request.headers.get('authorization')??'');
  if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return Response.json({error:'unauthorized'},{status:401});
  const url=new URL(request.url);
  if(['/status','/health'].includes(url.pathname)&&request.method==='GET')return Response.json(transport.status());
  if(url.pathname==='/stores'&&request.method==='POST'){
   let query;try{const text=await request.text();if(text.length>1024)throw Error();const input=JSON.parse(text);if(!input||Object.keys(input).join(',')!=='query')throw Error();query=validateStoreQuery(input.query);}catch{return Response.json({error:'invalid_request'},{status:400});}
   try{return Response.json(sanitizePublicStores(await stores.search(query)),{headers:{'Cache-Control':'no-store'}});}catch(error){const limited=error?.code==='RATE_LIMITED';return Response.json({error:limited?'rate_limited':'unavailable'},{status:limited?429:503,headers:{'Cache-Control':'no-store',...(limited?{'Retry-After':String(Math.max(1,Math.ceil((error.retryAfterMs??60000)/1000)))}:{})}});}
  }
  if(url.pathname==='/prepare'&&request.method==='POST'){
   let input,selectedStore;
   try{const text=await request.text();if(text.length>8192)throw Error();input=JSON.parse(text);if(!input||Object.keys(input).sort().join(',')!=='selectedStore,sessionKey'||typeof input.sessionKey!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(input.sessionKey))throw Error();selectedStore=validateSelectedStore(input.selectedStore,input.selectedStore?.sourceStoreNumber);}catch{return Response.json({error:'invalid_request'},{status:400});}
   try{const result=await transport.prepare(input.sessionKey,{selectedStore});if(result?.ready!==true)throw Error();return Response.json({ready:true},{headers:{'Cache-Control':'no-store'}});}catch(error){return Response.json({error:error?.code==='RATE_LIMITED'?'rate_limited':error?.code==='SETUP_REQUIRED'?'setup_required':'unavailable'},{status:error?.code==='RATE_LIMITED'?429:503,headers:{'Cache-Control':'no-store',...(error?.code==='RATE_LIMITED'?{'Retry-After':String(Math.max(1,Math.ceil((error.retryAfterMs??60000)/1000)))}:{})}});}
  }
  if(url.pathname==='/clear' &&request.method==='POST'){try{const text=await request.text();if(text.length>256)throw Error();const value=JSON.parse(text);if(Object.keys(value).join(',')!=='sessionKey'||typeof value.sessionKey!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(value.sessionKey))throw Error();await transport.clear(value.sessionKey);return Response.json({cleared:true});}catch{return Response.json({error:'invalid_request'},{status:400});}}
  if(url.pathname!=='/quote'||request.method!=='POST')return Response.json({error:'not_found'},{status:404});
  let input,body,selectedStore;
  try{const text=await request.text();if(text.length>65536)throw Error();input=JSON.parse(text);if(!input||Object.keys(input).sort().join(',')!=='body,selectedStore,sessionKey'||typeof input.sessionKey!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(input.sessionKey))throw Error();body=validateQuoteBody(input.body);selectedStore=validateSelectedStore(input.selectedStore,body.variables.order.storeNumber);}catch{return Response.json({error:'invalid_request'},{status:400});}
  try{return Response.json(sanitizeEnvelope(await transport.quote(input.sessionKey,body,{selectedStore}),body),{headers:{'Cache-Control':'no-store'}});}catch(error){return Response.json({error:error?.code==='RATE_LIMITED'?'rate_limited':error?.code==='SETUP_REQUIRED'?'setup_required':'unavailable'},{status:error?.code==='RATE_LIMITED'?429:503,headers:{'Cache-Control':'no-store',...(error?.code==='RATE_LIMITED'?{'Retry-After':String(Math.max(1,Math.ceil((error.retryAfterMs??60000)/1000)))}:{})}});}
 };
}
