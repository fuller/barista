import test from 'node:test';
import assert from 'node:assert/strict';
import {quoteKey,acceptQuote,unknownQuote} from '../src/ui/quote-cache.mjs';
import {pricingAvailable} from '../src/ui/quote-cache.mjs';
test('configured pricing is enabled only from explicit public availability',()=>{assert.equal(pricingAvailable({pricing:{available:true}}),true);for(const value of [{},{pricing:{}},{pricing:{available:false}},{pricing:{available:'true'}}])assert.equal(pricingAvailable(value),false);});
const order={revision:2,catalogVersion:'v1',items:[],menuItems:[{id:'menu-1',quantity:1,size:'grande',instructions:[]}]};
const store={storeId:'store-a',sourceStoreNumber:'85278-313836',selectionToken:'token-a'};
const quote={storeId:'store-a',revision:2,source:'starbucks',storeNumber:'85278-313836',expiresAt:Date.now()+60000,items:[{itemId:'menu-1',quantity:1,unitCents:500,totalCents:500,lines:[{label:'Drink',amountCents:500}]}],subtotalCents:500,taxCents:44,totalCents:544};
test('cache reuses semantic carts while partitioning catalog, configuration and caller scope',()=>{assert.deepEqual(quoteKey(order,store,'scope-a'),quoteKey({...order,revision:3,history:[{anything:true}],nextId:99,confirmed:true,menuItems:[{...order.menuItems[0],id:'menu-99'}]},store,'scope-a'));for(const next of [{...order,catalogVersion:'v2'},{...order,menuItems:[{...order.menuItems[0],instructions:['extra hot']}]}])assert.notDeepEqual(quoteKey(order,store,'scope-a'),quoteKey(next,store,'scope-a'));assert.notDeepEqual(quoteKey(order,store,'scope-a'),quoteKey(order,store,'scope-b'));});
test('correlation rejects stale, foreign and expired results',()=>{assert.ok(acceptQuote(order,quote,store));for(const next of [{...quote,revision:1},{...quote,items:[{...quote.items[0],itemId:'other'}]},{...quote,expiresAt:'2000-01-01'},{...quote,storeNumber:'other'}])assert.equal(acceptQuote(order,next,store),null);});
test('partial quote keeps supplied line but hides totals',()=>{const next={...order,menuItems:[...order.menuItems,{id:'menu-2',quantity:1}]};const result=acceptQuote(next,quote,store);assert.equal(result.subtotalCents,null);assert.equal(result.totalCents,null);assert.equal(result.items[0].totalCents,500);assert.equal(result.unpricedItemCount,1);});
test('unknown prices never contain sample amounts',()=>{const result=unknownQuote(order);assert.equal(result.items[0].totalCents,null);assert.equal(result.totalCents,null);});
test('request forwards cancellation and rejects unavailable pricing',async()=>{const {requestQuote}=await import('../src/ui/quote-cache.mjs');const original=globalThis.fetch;const controller=new AbortController();let calls=0;globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,'/api/quote');assert.equal(options.signal,controller.signal);assert.deepEqual(JSON.parse(options.body),{order,storeId:store.storeId,selectionToken:store.selectionToken});return {ok:false};};try{await assert.rejects(requestQuote(order,store,controller.signal),/Live pricing unavailable/);assert.equal(calls,1);}finally{globalThis.fetch=original;}});

test('explicit unknown rows preserve partial amounts and suppress totals',()=>{const next={...order,menuItems:[...order.menuItems,{id:'menu-2',quantity:1}]};const result=acceptQuote(next,{...quote,subtotalCents:null,taxCents:null,totalCents:null,items:[...quote.items,{itemId:'menu-2',quantity:1,unitCents:null,totalCents:null,lines:[]}]},store);assert.equal(result.subtotalCents,null);assert.equal(result.unpricedItemCount,1);assert.equal(result.pricedSubtotalCents,500);});
test('invalid item and aggregate arithmetic is rejected',()=>{for(const value of [{...quote,items:[{...quote.items[0],totalCents:501}]},{...quote,subtotalCents:501},{...quote,totalCents:545},{...quote,items:[{...quote.items[0],lines:[{label:'bad',amountCents:499}]}]}])assert.equal(acceptQuote(order,value,store),null);});
test('unknown counts include quantities',()=>{assert.equal(unknownQuote({...order,menuItems:[{...order.menuItems[0],quantity:5}]}).unpricedItemCount,5);});
test('failed refresh stops interval even with expired cached data',async()=>{const {quoteRefreshInterval}=await import('../src/ui/quote-cache.mjs');assert.equal(quoteRefreshInterval({status:'error',data:{expiresAt:1}},1000),false);assert.equal(quoteRefreshInterval({status:'success',data:{expiresAt:5000}},1000),4000);assert.equal(quoteRefreshInterval({status:'pending'},1000),false);});

test('store selection partitions cache and rejects previous store prices',()=>{const other={...store,storeId:'store-b',sourceStoreNumber:'different'};assert.notDeepEqual(quoteKey(order,store),quoteKey(order,other));assert.equal(acceptQuote(order,quote,other),null);assert.equal(acceptQuote(order,quote,null),null);assert.equal(acceptQuote(order,{...quote,storeId:'wrong'},store),null);});
test('expired selection prompts store confirmation while other service errors stay generic',async()=>{const {requestQuote}=await import('../src/ui/quote-cache.mjs'),original=globalThis.fetch;try{for(const [body,message] of [[{code:'store_selection_required',error:'internal detail'},'Choose your store again to refresh live prices.'],[{code:'other',error:'secret'},'Live pricing unavailable']]){globalThis.fetch=async()=>({ok:false,json:async()=>body});await assert.rejects(requestQuote(order,store,new AbortController().signal),error=>error.message===message);}}finally{globalThis.fetch=original;}});
test('fresh network quotes may rotate caller scope while explicit refresh bypasses caches',async()=>{
 const {requestQuote}=await import('../src/ui/quote-cache.mjs'),original=globalThis.fetch;let headers;
 globalThis.fetch=async(_url,options)=>{headers=options.headers;return {ok:true,json:async()=>({...quote,cacheScope:'scope-new'})};};
 try{const result=await requestQuote(order,store,new AbortController().signal,{cacheScope:'scope-old',refresh:true});assert.equal(result.cacheScope,'scope-new');assert.equal(headers['X-Price-Refresh'],'1');}finally{globalThis.fetch=original;}
});
test('scoped network requests reject a missing scope and cancellation after response decoding',async()=>{
 const {requestQuote}=await import('../src/ui/quote-cache.mjs'),original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>({ok:true,json:async()=>quote});await assert.rejects(requestQuote(order,store,new AbortController().signal,{cacheScope:'scope-a'}),/Live pricing unavailable/);
  const controller=new AbortController();globalThis.fetch=async()=>({ok:true,json:async()=>{controller.abort();return {...quote,cacheScope:'scope-a'};}});
  await assert.rejects(requestQuote(order,store,controller.signal,{cacheScope:'scope-a'}),{name:'AbortError'});
 }finally{globalThis.fetch=original;}
});
