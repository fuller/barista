import {browserPricingConfigured,createStarbucksBrowserSource} from '../adapters/starbucks-browser-source.mjs';
import {createStarbucksStores,createStoreSelection} from '../adapters/starbucks-stores.mjs';
const services=new WeakMap();
export function storeServices(env){
 let service=services.get(env);
 if(!service){
  // Search works without optional pricing. Live quotes require the shared token.
  const secret=browserPricingConfigured(env)?env.BARISTA_BROWSER_TOKEN:crypto.randomUUID()+crypto.randomUUID();
  const selection=createStoreSelection({secret});
  const browser=browserPricingConfigured(env)?createStarbucksBrowserSource({url:env.STARBUCKS_BROWSER_URL,token:env.BARISTA_BROWSER_TOKEN}):null;
  service={selection,source:createStarbucksStores({selection,...(browser?{fallbackSearch:query=>browser.searchStores(query)}:{})})};services.set(env,service);
 }
 return service;
}
export async function handleStoresApi(request,env){
 const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 if(request.method!=='GET')return json({error:'Method not allowed'},405);
 const url=new URL(request.url);if([...url.searchParams.keys()].some(k=>k!=='q')||url.searchParams.getAll('q').length!==1)return json({error:'Enter a city, address, or ZIP code'},400);
 try{return json({stores:await storeServices(env).source.search(url.searchParams.get('q'))});}catch(error){return json({error:error.status===400?'Enter a city, address, or ZIP code':'Store search unavailable'},error.status===400?400:503);}
}
