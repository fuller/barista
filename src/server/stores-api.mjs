import {normalizeStoreQuery} from '../domain/store-query.mjs';
import {pricingServiceConfigured,pricingServiceConfiguration,createStarbucksPricingSource} from '../adapters/starbucks-pricing-source.mjs';
import {createStarbucksStores,createStoreSelection} from '../adapters/starbucks-stores.mjs';
const services=new WeakMap();
export function storeServices(env){
 let service=services.get(env);
 if(!service){
  const secret=pricingServiceConfigured(env)?pricingServiceConfiguration(env).token:crypto.randomUUID()+crypto.randomUUID();
  const selection=createStoreSelection({secret});
  const proxy=pricingServiceConfigured(env)?createStarbucksPricingSource(pricingServiceConfiguration(env)):null;
  service={selection,source:createStarbucksStores({selection,...(proxy?{loadStores:query=>proxy.searchStores(query)}:{})})};services.set(env,service);
 }
 return service;
}
export async function handleStoresApi(request,env){
 const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 if(request.method!=='GET')return json({error:'Method not allowed'},405);
 const params=new URL(request.url).searchParams;let query;
 try{
  const keys=[...params.keys()];
  if(keys.length===1&&keys[0]==='q')query=normalizeStoreQuery(params.get('q'));
  else if(keys.length===2&&keys.includes('lat')&&keys.includes('lng')){
   const latitude=params.get('lat'),longitude=params.get('lng');
   const decimal=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
   if(latitude.length>32||longitude.length>32||!decimal.test(latitude)||!decimal.test(longitude))throw Error();
   query=normalizeStoreQuery({latitude:Number(latitude),longitude:Number(longitude)});
  }else throw Error();
 }catch{return json({error:'Enter a city, address, or ZIP code'},400);}
 try{return json({stores:await storeServices(env).source.search(query)});}catch(error){
  if(error?.code==='RATE_LIMITED'||error?.status===429){const response=json({error:'Store search is temporarily rate limited'},429);const delay=Number.isFinite(error.retryAfterMs)?Math.min(3600000,Math.max(1000,error.retryAfterMs)):60000;response.headers.set('Retry-After',String(Math.ceil(delay/1000)));return response;}
  return json({error:error.status===400?'Enter a city, address, or ZIP code':'Store search unavailable'},error.status===400?400:503);
 }
}
