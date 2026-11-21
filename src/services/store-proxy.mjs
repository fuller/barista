import {normalizeStoreQuery,storeQueryKey,storeLocationsUrl} from '../domain/store-query.mjs';
import {sanitizePublicStores} from './public-stores.mjs';
const LIMIT=1048576;
const failure=(code='UNAVAILABLE',retryAfterMs)=>Object.assign(new Error(code==='RATE_LIMITED'?'Store search is cooling down':'Store search unavailable'),{code,status:code==='RATE_LIMITED'?429:503,...(retryAfterMs===undefined?{}:{retryAfterMs})});
export function createPublicStoreProxy({fetchImpl=fetch,now=Date.now,ttlMs=300000,maxEntries=64,maxPending=8,timeoutMs=10000}={}){
 for(const [value,max] of [[ttlMs,86400000],[maxEntries,4096],[maxPending,64],[timeoutMs,60000]])if(!Number.isSafeInteger(value)||value<1||value>max)throw Error('Invalid store proxy limits');
 const cache=new Map(),pending=new Map();let cooldownUntil=0;
 return {async search(query){
  let normalized;try{normalized=normalizeStoreQuery(query);}catch{throw failure();}
  const key=storeQueryKey(normalized),time=now();
  for(const [key,entry]of cache)if(entry.expiresAt<=time)cache.delete(key);
  const cached=cache.get(key);if(cached){cache.delete(key);cache.set(key,cached);return structuredClone(cached.stores);}
  if(cooldownUntil>time)throw failure('RATE_LIMITED',cooldownUntil-time);
  if(pending.has(key))return structuredClone(await pending.get(key));
  if(pending.size>=maxPending)throw failure();
  const work=Promise.resolve().then(async()=>{
   if(cooldownUntil>now())throw failure('RATE_LIMITED',cooldownUntil-now());
   try{
    const response=await fetchImpl(storeLocationsUrl(normalized).href,{headers:{Accept:'application/json','X-Requested-With':'XMLHttpRequest'},credentials:'omit',redirect:'manual',signal:AbortSignal.timeout(timeoutMs)});
    if(!response.ok){
     void response.body?.cancel().catch(()=>{});
     if(response.status===429){const raw=response.headers.get('Retry-After'),seconds=raw?.trim()?Number(raw):NaN;const delay=Number.isFinite(seconds)?seconds*1000:Date.parse(raw)-now();const bounded=Math.min(3600000,Math.max(1000,Number.isFinite(delay)?delay:60000));cooldownUntil=Math.max(cooldownUntil,now()+bounded);throw failure('RATE_LIMITED',cooldownUntil-now());}
     throw failure();
    }
    if(!response.headers.get('Content-Type')?.includes('application/json')||Number(response.headers.get('Content-Length'))>LIMIT){void response.body?.cancel().catch(()=>{});throw failure();}
    const reader=response.body?.getReader();if(!reader)throw failure();const chunks=[];let size=0;
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>LIMIT){await reader.cancel();throw failure();}chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    const stores=sanitizePublicStores(JSON.parse(new TextDecoder().decode(bytes)));
    cache.set(key,{stores,expiresAt:now()+ttlMs});while(cache.size>maxEntries)cache.delete(cache.keys().next().value);return stores;
   }catch(error){if(error?.code==='RATE_LIMITED')throw error;throw failure();}
  });
  pending.set(key,work);try{return structuredClone(await work);}finally{if(pending.get(key)===work)pending.delete(key);}
 }};
}
