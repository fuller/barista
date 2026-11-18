import {buildStarbucksQuoteRequest,normalizeStarbucksQuote} from '../adapters/starbucks-quote-protocol.mjs';
import {createStarbucksGuestSource,StarbucksGuestError} from '../adapters/starbucks-guest-session.mjs';

export class StarbucksQuoteError extends Error {
 constructor(code,retryAfterMs){super(code==='invalid_request'?'Invalid price request':code==='busy'?'Pricing is busy':'Live pricing is unavailable');this.name='StarbucksQuoteError';this.code=code;this.status=code==='invalid_request'?400:code==='rate_limited'?429:503;if(Number.isSafeInteger(retryAfterMs)&&retryAfterMs>=0&&retryAfterMs<=3600000)this.retryAfterMs=retryAfterMs;}
}
const validKey=key=>typeof key==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(key);
const abortError=()=>new DOMException('Price request cancelled','AbortError');
function consume(promise,signal){
 return new Promise((resolve,reject)=>{
  let finished=false;
  const settle=(callback,value)=>{if(finished)return;finished=true;signal?.removeEventListener('abort',abort);callback(value);};
  const abort=()=>settle(reject,abortError());
  signal?.addEventListener('abort',abort,{once:true});
  promise.then(value=>settle(resolve,structuredClone(value)),error=>settle(reject,error));
  if(signal?.aborted)abort();
 });
}

/** Server-only configured-SKU quotes. No public proxy or free-text-to-SKU inference. */
export function createStarbucksQuoteService({source=createStarbucksGuestSource(),now=Date.now,maxEntries=256,maxPending=32}={}){
 for(const limit of [maxEntries,maxPending])if(!Number.isSafeInteger(limit)||limit<1||limit>4096)throw new Error('Invalid quote service limit');
 const cache=new Map(),pending=new Map();
 const prune=()=>{const time=now();for(const [key,entry] of cache)if(entry.quote.expiresAt<=time)cache.delete(key);};
 return {
  async quote(sessionKey,input,{signal}={}){
   if(signal?.aborted)throw abortError();
   if(!validKey(sessionKey))throw new StarbucksQuoteError('invalid_request');
   let prepared;try{prepared=buildStarbucksQuoteRequest(input);}catch{throw new StarbucksQuoteError('invalid_request');}
   prune();const key=JSON.stringify([sessionKey,prepared.cacheKey]),cached=cache.get(key);
   if(cached){cache.delete(key);cache.set(key,cached);return structuredClone(cached.quote);}
   const existing=pending.get(key);if(existing)return consume(existing.promise,signal);
   if(pending.size>=maxPending)throw new StarbucksQuoteError('busy');
   const entry={sessionKey,promise:null},startedAt=now();
   entry.promise=Promise.resolve().then(()=>{
    if(pending.get(key)!==entry)throw new StarbucksQuoteError('unavailable');
    return source.quote(sessionKey,prepared.body);
   }).then(envelope=>{
    if(pending.get(key)!==entry)throw new StarbucksQuoteError('unavailable');
    const quote=normalizeStarbucksQuote(envelope,prepared,{now:()=>startedAt});
    if(quote.expiresAt<=now())throw new StarbucksQuoteError('unavailable');
    if(pending.get(key)===entry&&quote.expiresAt>now()){
     prune();cache.set(key,{sessionKey,quote});
     while(cache.size>maxEntries)cache.delete(cache.keys().next().value);
    }
    return quote;
   }).catch(error=>{throw new StarbucksQuoteError(error instanceof StarbucksGuestError&&error.code==='RATE_LIMITED'?'rate_limited':'unavailable',error instanceof StarbucksGuestError?error.retryAfterMs:undefined);}).finally(()=>{if(pending.get(key)===entry)pending.delete(key);});
   pending.set(key,entry);return consume(entry.promise,signal);
  },
  clear(sessionKey){
   if(!validKey(sessionKey))throw new StarbucksQuoteError('invalid_request');
   for(const [key,entry] of cache)if(entry.sessionKey===sessionKey)cache.delete(key);
   for(const [key,entry] of pending)if(entry.sessionKey===sessionKey)pending.delete(key);
   source.clear(sessionKey);
  }
 };
}
