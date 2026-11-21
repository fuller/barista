import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalQuoteCache,createQuoteRecord,materializeQuoteRecord,QUOTE_STORAGE_KEY} from '../src/ui/quote-local-cache.mjs';
const time=1000000,scope='scope-a';
const store={storeId:'store-a',sourceStoreNumber:'85278-313836',selectionToken:'token-a'};
const order={revision:2,catalogVersion:'v1',items:[],menuItems:[{id:'menu-1',identity:'407:Hot',name:'Latte',quantity:1,size:'Grande',instructions:[]}]};
const quote={cacheScope:scope,storeId:store.storeId,revision:2,source:'starbucks',storeNumber:store.sourceStoreNumber,expiresAt:time+60000,currency:'USD',estimated:false,items:[{itemId:'menu-1',quantity:1,unitCents:500,totalCents:500,lines:[{label:'Drink',amountCents:500}]}],subtotalCents:500,taxCents:44,totalCents:544};
function storage(){const data=new Map();return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};}
test('tab-local cache restores exact configuration across reload and remaps only cart correlation',()=>{
 const disk=storage(),cache=createLocalQuoteCache({storage:disk,now:()=>time});cache.set(order,quote,store,scope);
 const next={...order,revision:8,nextId:99,history:[{}],confirmed:true,menuItems:[{...order.menuItems[0],id:'menu-7'}]};
 const reloaded=createLocalQuoteCache({storage:disk,now:()=>time+1000}),record=reloaded.get(next,store,scope);
 const result=materializeQuoteRecord(next,record,store,scope,time+1000);assert.equal(result.revision,8);assert.equal(result.items[0].itemId,'menu-7');assert.equal(result.totalCents,544);assert.equal(result.expiresAt,time+60000);
 assert.equal(disk.getItem(QUOTE_STORAGE_KEY).includes('token-a'),false);
});
test('scope, store, catalog and every changed configuration miss rather than borrowing old prices',()=>{
 const cache=createLocalQuoteCache({storage:storage(),now:()=>time});cache.set(order,quote,store,scope);
 for(const next of [{...order,catalogVersion:'v2'},{...order,menuItems:[{...order.menuItems[0],size:'Venti'}]},{...order,menuItems:[{...order.menuItems[0],instructions:['extra hot']}]},{...order,menuItems:[{...order.menuItems[0],quantity:2}]}])assert.equal(cache.get(next,store,scope),null);
 assert.equal(cache.get(order,{...store,storeId:'store-b'},scope),null);assert.equal(cache.get(order,store,'scope-b'),null);assert.equal(cache.get(order,store,null),null);
});
test('duplicate configurations retain occurrence identity and unavailable-row correlation',()=>{
 const two={...order,menuItems:[order.menuItems[0],{...order.menuItems[0],id:'menu-2'}]};
 const partial={...quote,subtotalCents:null,taxCents:null,totalCents:null,items:[quote.items[0],{itemId:'menu-2',quantity:1,unitCents:null,totalCents:null,lines:[]}],unavailable:[{itemId:'menu-2',reason:'unsupported_configuration'}]};
 const record=createQuoteRecord(two,partial,store,scope,time),next={...two,revision:3,menuItems:two.menuItems.map((line,n)=>({...line,id:'menu-'+(n+10)}))};
 const result=materializeQuoteRecord(next,record,store,scope,time);assert.deepEqual(result.items.map(line=>[line.itemId,line.unitCents]),[['menu-10',500],['menu-11',null]]);assert.equal(result.unavailable[0].itemId,'menu-11');assert.equal(result.totalCents,null);
});
test('cache expiry is capped once and never renewed by a read or reload',()=>{
 const disk=storage();let now=time;const cache=createLocalQuoteCache({storage:disk,now:()=>now});const record=cache.set(order,{...quote,expiresAt:time+900000},store,scope);
 assert.equal(record.expiresAt,time+300000);now=time+200000;assert.equal(cache.get(order,store,scope).expiresAt,time+300000);
 assert.equal(createLocalQuoteCache({storage:disk,now:()=>now}).get(order,store,scope).expiresAt,time+300000);
 now=time+300000;assert.equal(cache.get(order,store,scope),null);
});
test('corrupt storage, tampered arithmetic and expired or foreign quotes fail closed',()=>{
 for(const value of ['{','x'.repeat(524289),JSON.stringify({version:99,entries:[]})]){const disk=storage();disk.setItem(QUOTE_STORAGE_KEY,value);assert.equal(createLocalQuoteCache({storage:disk,now:()=>time}).get(order,store,scope),null);}
 const record=createQuoteRecord(order,quote,store,scope,time);
 for(const bad of [{...record,quote:{...record.quote,totalCents:545}},{...record,expiresAt:time},{...record,expiresAt:time+900000},{...record,cacheScope:'foreign'},{...record,quote:{...record.quote,cacheScope:'foreign'}}])assert.equal(materializeQuoteRecord(order,bad,store,scope,time),null);
});
test('blocked session storage falls back to memory; absence of caller scope never persists',()=>{
 const blocked={getItem(){throw Error('blocked')},setItem(){throw Error('blocked')},removeItem(){throw Error('blocked')}};
 const cache=createLocalQuoteCache({storage:blocked,now:()=>time});assert.ok(cache.set(order,quote,store,scope));assert.ok(cache.get(order,store,scope));
 const disk=storage();createLocalQuoteCache({storage:disk,now:()=>time}).set(order,{...quote,cacheScope:undefined},store,null);assert.equal(disk.getItem(QUOTE_STORAGE_KEY),null);
});
test('cache cardinality is bounded and explicit removal forces a miss',()=>{
 const disk=storage(),cache=createLocalQuoteCache({storage:disk,now:()=>time,maxEntries:2});
 for(let n=1;n<=3;n++){const next={...order,catalogVersion:'v'+n};cache.set(next,quote,store,scope);}
 assert.equal(cache.get(order,store,scope),null);const third={...order,catalogVersion:'v3'};assert.ok(cache.get(third,store,scope));cache.delete(third,store,scope);assert.equal(cache.get(third,store,scope),null);
});
test('caller rotation removes old persisted quotes without affecting new scope records',()=>{
 const disk=storage(),cache=createLocalQuoteCache({storage:disk,now:()=>time});cache.set(order,quote,store,scope);cache.clearScope(scope);
 cache.set(order,{...quote,cacheScope:'scope-b'},store,'scope-b');const reloaded=createLocalQuoteCache({storage:disk,now:()=>time});assert.equal(reloaded.get(order,store,scope),null);assert.ok(reloaded.get(order,store,'scope-b'));
});
test('non-USD or mismatched-scoped quotes are never written to persistent storage',()=>{
 const disk=storage(),cache=createLocalQuoteCache({storage:disk,now:()=>time});for(const value of [{...quote,currency:'CAD'},{...quote,cacheScope:'foreign'},{...quote,cacheScope:undefined}])assert.equal(cache.set(order,value,store,scope),null);assert.equal(disk.getItem(QUOTE_STORAGE_KEY),null);
});

test('hydration and writes reject changed currency or illustrative pricing flags',()=>{
 const record=createQuoteRecord(order,quote,store,scope,time);assert.ok(record);
 for(const fields of [{currency:'CAD'},{estimated:true},{estimated:undefined}]){
  assert.equal(createQuoteRecord(order,{...quote,...fields},store,scope,time),null);
  assert.equal(materializeQuoteRecord(order,{...record,quote:{...record.quote,...fields}},store,scope,time),null);
  const disk=storage();disk.setItem(QUOTE_STORAGE_KEY,JSON.stringify({version:1,entries:[[JSON.stringify([1,scope,store.storeId,store.sourceStoreNumber,record.configuration]),{...record,quote:{...record.quote,...fields}}]]}));
  assert.equal(createLocalQuoteCache({storage:disk,now:()=>time}).get(order,store,scope),null);
 }
});
