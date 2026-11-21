import {normalizeStoreQuery,storeQueryKey,storeLocationsUrl} from '../domain/store-query.mjs';
const encoder=new TextEncoder();
const text=(v,max=200)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
function validateStore(s){
 if(!s||!text(s.storeId,40)||!/^[A-Za-z0-9_-]+$/.test(s.storeId)||s.source!=='starbucks'||!/^\d{1,10}-\d{1,10}$/.test(s.sourceStoreNumber)||!text(s.name)||!s.address||!Array.isArray(s.address.lines)||s.address.lines.length<1||s.address.lines.length>5||!s.address.lines.every(v=>text(v))||!['city','region','postalCode','countryCode'].every(k=>text(s.address[k],100))||!Number.isFinite(s.coordinates?.latitude)||Math.abs(s.coordinates.latitude)>90||!Number.isFinite(s.coordinates.longitude)||Math.abs(s.coordinates.longitude)>180)throw Error('Invalid store');
 return s;
}
const encode=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const decode=value=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
export function createStoreSelection({secret,now=Date.now,ttlMs=86400000}={}){
 if(typeof secret!=='string'||secret.length<32)throw Error('Store selection unavailable');
 const key=crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
 return {
  async sign(store){validateStore(store);const payload=encode(encoder.encode(JSON.stringify({store,expiresAt:now()+ttlMs})));return payload+'.'+encode(new Uint8Array(await crypto.subtle.sign('HMAC',await key,encoder.encode(payload))));},
  async verify(storeId,token){
   if(!text(storeId,40)||typeof token!=='string'||token.length>6000||!/^[-_A-Za-z0-9]+\.[-_A-Za-z0-9]+$/.test(token))throw Error('Invalid store selection');
   const [payload,signature]=token.split('.');if(!await crypto.subtle.verify('HMAC',await key,decode(signature),encoder.encode(payload)))throw Error('Invalid store selection');
   const value=JSON.parse(new TextDecoder().decode(decode(payload)));if(!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=now()||value.expiresAt>now()+ttlMs||value.store?.storeId!==storeId)throw Error('Invalid store selection');return validateStore(value.store);
  }
 };
}
export function createStarbucksStores({selection,fetchImpl=fetch,now=Date.now,ttlMs=300000,maxEntries=64,timeoutMs=5000,loadStores}={}){
 const cache=new Map(),pending=new Map();let limitedUntil=0;
 const rateLimited=delay=>Object.assign(Error('Store search rate limited'),{code:'RATE_LIMITED',status:429,retryAfterMs:delay});
 const boundedDelay=value=>Math.min(3600000,Math.max(1000,Number.isFinite(value)?value:60000));
 return {async search(query){
  let normalized;try{normalized=normalizeStoreQuery(query);}catch{throw Object.assign(Error('Enter a city, address, or ZIP code'),{status:400});}
  const q=storeQueryKey(normalized);const cached=cache.get(q);if(cached&&cached.expiresAt>now())return structuredClone(cached.stores);if(pending.has(q))return structuredClone(await pending.get(q));if(limitedUntil>now())throw rateLimited(limitedUntil-now());if(pending.size>=8)throw Error('Store search busy');
  const promise=(async()=>{
   let raw;
   try{
    if(loadStores)raw=await loadStores(normalized);
    else{
     const url=storeLocationsUrl(normalized);
     const response=await fetchImpl(url.href,{headers:{Accept:'application/json','X-Requested-With':'XMLHttpRequest'},redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
     if(!response.ok){
      void response.body?.cancel().catch(()=>{});
      if(response.status===429){const value=response.headers.get('Retry-After');const seconds=value&&/^\d+$/.test(value)?Number(value)*1000:NaN;const date=value?Date.parse(value)-now():NaN;throw rateLimited(boundedDelay(Number.isFinite(seconds)?seconds:date));}
      throw Error('Store search unavailable');
     }
     if(!response.headers.get('Content-Type')?.includes('application/json')||Number(response.headers.get('Content-Length'))>1048576)throw Error('Invalid store response');
     const reader=response.body?.getReader();if(!reader)throw Error('Invalid store response');let size=0;const chunks=[];for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1048576){await reader.cancel();throw Error('Invalid store response');}chunks.push(value);}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
     raw=JSON.parse(new TextDecoder().decode(bytes));
    }
   }catch(error){
    if(error?.code==='RATE_LIMITED'||error?.status===429){const delay=boundedDelay(error.retryAfterMs);limitedUntil=Math.max(limitedUntil,now()+delay);throw rateLimited(limitedUntil-now());}
    throw Error('Store search unavailable');
   }
   if(!Array.isArray(raw)||raw.length>500||encoder.encode(JSON.stringify(raw)).length>1048576)throw Error('Invalid store response');
   const stores=[];const ids=new Set();for(const entry of raw){const s=entry.store;const store=validateStore({storeId:s?.id,source:'starbucks',sourceStoreNumber:s?.storeNumber,name:s?.name,address:{lines:s?.address?.lines,city:s?.address?.city,region:s?.address?.countrySubdivisionCode,postalCode:s?.address?.postalCode,countryCode:s?.address?.countryCode},coordinates:{latitude:s?.coordinates?.latitude,longitude:s?.coordinates?.longitude}});if(ids.has(store.storeId))continue;ids.add(store.storeId);stores.push({...store,selectionToken:await selection.sign(store)});}
   cache.set(q,{stores,expiresAt:now()+ttlMs});while(cache.size>maxEntries)cache.delete(cache.keys().next().value);return stores;
  })();pending.set(q,promise);try{return structuredClone(await promise);}finally{pending.delete(q);}
 }};
}
