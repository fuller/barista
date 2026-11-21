import {acceptQuote,expiryTime,quoteConfiguration} from './quote-cache.mjs';
export const QUOTE_STORAGE_KEY='barista:price-quotes:v1';
const VERSION=1,MAX_AGE=300000;
const scopeValid=scope=>typeof scope==='string'&&scope.length>0&&scope.length<=256&&!/[\u0000-\u001f\u007f]/.test(scope);
const cartLines=order=>[...order.items,...(order.menuItems??[])];
const entryKey=(order,store,scope)=>JSON.stringify([VERSION,scope,store.storeId,store.sourceStoreNumber,quoteConfiguration(order)]);
function defaultStorage(){try{return globalThis.sessionStorage;}catch{return undefined;}}

export function createQuoteRecord(order,value,store,cacheScope,now=Date.now()){
 try{
  const accepted=acceptQuote(order,value,store,now);
  if(!accepted||accepted.currency!=='USD'||accepted.estimated!==false||cacheScope&&(!scopeValid(cacheScope)||accepted.cacheScope!==cacheScope))return null;
  const expiresAt=Math.min(expiryTime(accepted.expiresAt),now+MAX_AGE);
  return {version:VERSION,cacheScope:cacheScope??null,storeId:store.storeId,storeNumber:store.sourceStoreNumber,configuration:quoteConfiguration(order),receivedAt:now,expiresAt,
   order:structuredClone({revision:order.revision,catalogVersion:order.catalogVersion,items:order.items,menuItems:order.menuItems??[]}),quote:{...accepted,expiresAt}};
 }catch{return null;}
}

export function materializeQuoteRecord(order,record,store,cacheScope,now=Date.now()){
 try{
  if(!store||!record||record.version!==VERSION||record.cacheScope!==(cacheScope??null)||record.storeId!==store.storeId||record.storeNumber!==store.sourceStoreNumber||!Number.isSafeInteger(record.receivedAt)||record.receivedAt>now||!Number.isSafeInteger(record.expiresAt)||record.expiresAt<=now||record.expiresAt>record.receivedAt+MAX_AGE||expiryTime(record.quote.expiresAt)!==record.expiresAt)return null;
  if(cacheScope&&record.quote.cacheScope!==cacheScope)return null;
  const configuration=quoteConfiguration(order);
  if(record.configuration!==configuration||quoteConfiguration(record.order)!==configuration)return null;
  const original=cartLines(record.order),current=cartLines(order);
  if(original.length!==current.length||original.length>100||new Set(original.map(line=>line.id)).size!==original.length||new Set(current.map(line=>line.id)).size!==current.length)return null;
  const accepted=acceptQuote(record.order,record.quote,store,now);if(!accepted||accepted.currency!=='USD'||accepted.estimated!==false)return null;
  const ids=new Map(original.map((line,index)=>[line.id,current[index].id]));
  let unavailable;
  if(accepted.unavailable!==undefined){
   if(!Array.isArray(accepted.unavailable)||accepted.unavailable.some(line=>!ids.has(line.itemId)||typeof line.reason!=='string'||line.reason.length>200))return null;
   unavailable=accepted.unavailable.map(line=>({itemId:ids.get(line.itemId),reason:line.reason}));
  }
  return acceptQuote(order,{...accepted,revision:order.revision,items:accepted.items.map(line=>({...line,itemId:ids.get(line.itemId)})),...(unavailable?{unavailable}:{})},store,now);
 }catch{return null;}
}

export function createLocalQuoteCache({storage=defaultStorage(),now=Date.now,maxEntries=32,maxBytes=524288}={}){
 const entries=new Map();
 const size=value=>new TextEncoder().encode(value).byteLength;
 try{
  const raw=storage?.getItem(QUOTE_STORAGE_KEY);
  if(raw&&raw.length<=maxBytes&&size(raw)<=maxBytes){const data=JSON.parse(raw);if(data.version===VERSION&&Array.isArray(data.entries)&&data.entries.length<=maxEntries)for(const pair of data.entries)if(Array.isArray(pair)&&pair.length===2&&typeof pair[0]==='string')entries.set(pair[0],pair[1]);}
 }catch{                                                           }
 function save(){
  for(const [key,entry]of entries)if(!Number.isSafeInteger(entry?.expiresAt)||entry.expiresAt<=now())entries.delete(key);
  while(entries.size>maxEntries)entries.delete(entries.keys().next().value);
  let value=JSON.stringify({version:VERSION,entries:[...entries]});
  while(entries.size&&size(value)>maxBytes){entries.delete(entries.keys().next().value);value=JSON.stringify({version:VERSION,entries:[...entries]});}
  try{if(entries.size)storage?.setItem(QUOTE_STORAGE_KEY,value);else storage?.removeItem(QUOTE_STORAGE_KEY);}catch{}
 }
 return {
  get(order,store,scope){
   if(!store||!scopeValid(scope))return null;
   const key=entryKey(order,store,scope),record=entries.get(key);
   if(!materializeQuoteRecord(order,record,store,scope,now())){if(entries.delete(key))save();return null;}
   entries.delete(key);entries.set(key,record);return structuredClone(record);
  },
  set(order,value,store,scope){
   const record=createQuoteRecord(order,value,store,scope,now());if(!record||!scopeValid(scope))return record;
   const key=entryKey(order,store,scope);entries.delete(key);entries.set(key,record);save();return structuredClone(record);
  },
  clearScope(scope){for(const [key,record]of entries)if(record?.cacheScope===scope)entries.delete(key);save();},
  delete(order,store,scope){if(store&&scopeValid(scope)){entries.delete(entryKey(order,store,scope));save();}}
 };
}
