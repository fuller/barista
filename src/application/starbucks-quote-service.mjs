import {buildStarbucksQuoteRequest,normalizeStarbucksQuote} from '../adapters/starbucks-quote-protocol.mjs';
import {createStarbucksGuestSource,StarbucksGuestError} from '../adapters/starbucks-guest-session.mjs';

export class StarbucksQuoteError extends Error {
 constructor(code,retryAfterMs){super(code==='invalid_request'?'Invalid price request':code==='busy'?'Pricing is busy':'Live pricing is unavailable');this.name='StarbucksQuoteError';this.code=code;this.status=code==='invalid_request'?400:code==='rate_limited'?429:503;if(Number.isSafeInteger(retryAfterMs)&&retryAfterMs>=0&&retryAfterMs<=3600000)this.retryAfterMs=retryAfterMs;}
}
const validKey=key=>typeof key==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(key);
const abortError=()=>new DOMException('Price request cancelled','AbortError');
function consume(entry,signal,maxSubscribers){
 if(entry.subscribers.size>=maxSubscribers)return Promise.reject(new StarbucksQuoteError('busy',1000));
 return new Promise((resolve,reject)=>{
  const subscriber={finish:(error,value)=>{
   if(!entry.subscribers.delete(subscriber))return;
   signal?.removeEventListener('abort',abort);
   if(!entry.finished&&entry.subscribers.size===0)entry.cancel(abortError());
   if(error){reject(value);return;}
   try{resolve(structuredClone(value));}catch(error){reject(error);}
  }};
  const abort=()=>subscriber.finish(true,abortError());
  entry.subscribers.add(subscriber);
  signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)abort();
 });
}
function complete(entry,error,value){for(const subscriber of entry.subscribers)subscriber.finish(error,value);}

export function createStarbucksQuoteService({source=createStarbucksGuestSource(),now=Date.now,maxEntries=256,maxPending=32,maxSubscribers=32}={}){
 for(const limit of [maxEntries,maxPending,maxSubscribers])if(!Number.isSafeInteger(limit)||limit<1||limit>4096)throw new Error('Invalid quote service limit');
 const cache=new Map(),pending=new Map();
 let closed=false;
 const prune=()=>{const time=now();for(const [key,entry] of cache)if(entry.quote.expiresAt<=time)cache.delete(key);};
 return {
  async quote(sessionKey,input,{signal,selectedStore,forceRefresh=false}={}){
   if(signal?.aborted)throw abortError();
   if(closed)throw new StarbucksQuoteError('unavailable');
   if(!validKey(sessionKey))throw new StarbucksQuoteError('invalid_request');
   let prepared;try{prepared=buildStarbucksQuoteRequest(input);}catch{throw new StarbucksQuoteError('invalid_request');}
   prune();const key=JSON.stringify([sessionKey,prepared.cacheKey]),cached=cache.get(key);
   if(cached&&!forceRefresh){cache.delete(key);cache.set(key,cached);return structuredClone(cached.quote);}
   const existing=pending.get(key);if(existing)return consume(existing,signal,maxSubscribers);
   if(pending.size>=maxPending)throw new StarbucksQuoteError('busy',1000);
   const entry={sessionKey,promise:null,controller:new AbortController(),subscribers:new Set(),finished:false},startedAt=now();
   let rejectAbort;
   const aborted=new Promise((resolve,reject)=>{rejectAbort=reject;});
   entry.cancel=reason=>{if(entry.finished||entry.controller.signal.aborted)return;if(pending.get(key)===entry)pending.delete(key);rejectAbort(reason);entry.controller.abort();};
   const producer=Promise.resolve().then(()=>{
    if(pending.get(key)!==entry)throw new StarbucksQuoteError('unavailable');
    return source.quote(sessionKey,prepared.body,{selectedStore,signal:entry.controller.signal});
   });
   entry.promise=Promise.race([producer,aborted]).then(envelope=>{
    if(pending.get(key)!==entry)throw new StarbucksQuoteError('unavailable');
    const quote=normalizeStarbucksQuote(envelope,prepared,{now:()=>startedAt});
    if(quote.expiresAt<=now())throw new StarbucksQuoteError('unavailable');
    if(pending.get(key)===entry&&quote.expiresAt>now()){
     prune();cache.set(key,{sessionKey,quote});
     while(cache.size>maxEntries)cache.delete(cache.keys().next().value);
    }
    return quote;
   }).catch(error=>{throw new StarbucksQuoteError(error instanceof StarbucksGuestError?(error.code==='RATE_LIMITED'?'rate_limited':error.code==='BUSY'?'busy':'unavailable'):'unavailable',error instanceof StarbucksGuestError?error.retryAfterMs:undefined);}).finally(()=>{entry.finished=true;if(pending.get(key)===entry)pending.delete(key);});
   entry.promise.then(value=>complete(entry,false,value),error=>complete(entry,true,error));
   pending.set(key,entry);return consume(entry,signal,maxSubscribers);
  },
  clear(sessionKey){
   if(!validKey(sessionKey))throw new StarbucksQuoteError('invalid_request');
   for(const [key,entry] of cache)if(entry.sessionKey===sessionKey)cache.delete(key);
   for(const entry of pending.values())if(entry.sessionKey===sessionKey)entry.cancel(new StarbucksQuoteError('unavailable'));
   source.clear(sessionKey);
  },
  async close(){closed=true;cache.clear();for(const entry of pending.values())entry.cancel(new StarbucksQuoteError('unavailable'));await source.close?.();}
 };
}
