import test from 'node:test';import assert from 'node:assert/strict';
import {createQuoteApi} from '../src/server/quote-api.mjs';
import {createOrder,applyCommands} from '../src/domain/order.mjs';
const order=applyCommands(createOrder(),[{type:'add-menu',identity:'407:Hot'}]);
const request=(body={order},headers={})=>new Request('https://barista.example/api/quote',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
const quote={currency:'USD',estimated:false,source:'starbucks',storeNumber:'85278-313836',expiresAt:Date.now()+300000,subtotalCents:525,taxCents:47,totalCents:572,items:[{itemId:'menu-1',quantity:1,unitCents:525,totalCents:525,lines:[{label:'Base',amountCents:525}]}],taxLabel:'Tax',provenance:'Verified Starbucks store quote'};
test('returns revision-correlated quote through private cookie session',async()=>{
 let session;const handler=createQuoteApi({resolveOrder:async()=>({items:[{itemId:'menu-1',sku:'1',quantity:1}],unpriced:[]}),service:{quote:async(key,input)=>{session=key;assert.equal(input.storeNumber,'85278-313836');return quote;}}});
 const response=await handler(request());assert.equal(response.status,200);const cookie=response.headers.get('Set-Cookie');assert.match(cookie,/HttpOnly; SameSite=Strict/);assert.match(cookie,/Secure/);assert.equal((await response.json()).revision,order.revision);assert.ok(session);
 const next=await handler(request({order},{cookie:cookie.split(';')[0]}));assert.equal(next.headers.has('Set-Cookie'),false);assert.equal(next.status,200);
});
test('unknown configurations keep cart totals unknown and preserve priced lines',async()=>{
 const two=applyCommands(order,[{type:'add-menu',identity:'406:Hot'}]);const handler=createQuoteApi({resolveOrder:async()=>({items:[{itemId:'menu-1',sku:'1',quantity:1}],unpriced:[{itemId:'menu-2',reason:'unsupported_instructions'}]}),service:{quote:async()=>quote}});
 const data=await(await handler(request({order:two}))).json();assert.equal(data.items.length,2);assert.equal(data.totalCents,null);assert.equal(data.taxCents,null);assert.equal(data.pricedSubtotalCents,525);assert.equal(data.items[1].unitCents,null);
});
test('all-unresolved orders do not call browser and remain refreshable',async()=>{
 const handler=createQuoteApi({resolveOrder:async()=>({items:[],unpriced:[{itemId:'menu-1',reason:'unsupported_instructions'}]}),service:{quote:async()=>assert.fail('must not quote')}});
 const data=await(await handler(request())).json();assert.equal(data.items[0].totalCents,null);assert.ok(data.expiresAt>Date.now());assert.equal(data.unavailable[0].itemId,'menu-1');
});
test('rejects foreign origins, malformed or oversized requests before resolving',async()=>{
 const handler=createQuoteApi({resolveOrder:async()=>assert.fail('must not resolve'),service:{}});
 assert.equal((await handler(request({order},{origin:'https://evil.example'}))).status,403);
 assert.equal((await handler(request({order:{} }))).status,400);
 assert.equal((await handler(request({order,large:'x'.repeat(70000)}))).status,413);
 assert.equal((await handler(new Request('https://barista.example/api/quote'))).status,405);
});
test('provider failures stay private and never substitute a sample quote',async()=>{
 const handler=createQuoteApi({resolveOrder:async()=>({items:[{}],unpriced:[]}),service:{quote:async()=>{throw new Error('secret browser token');}}});
 const response=await handler(request());assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/secret/);assert.equal(response.headers.get('Cache-Control'),'no-store');
 assert.match(response.headers.get('Set-Cookie')??'',/barista_quote=/);
});
test('resolution admission bounds concurrent work before product fetching',async()=>{
 let release,calls=0;const gate=new Promise(resolve=>{release=resolve;});
 const handler=createQuoteApi({resolveOrder:async()=>{calls++;await gate;return {items:[],unpriced:[{itemId:'menu-1',reason:'unsupported_instructions'}]};},service:{}});
 const pending=Array.from({length:8},()=>handler(request()));
 // Wait for all real resolver entries; no wall-clock assumption.
 while(calls<8)await new Promise(resolve=>setImmediate(resolve));
 const denied=await handler(request());assert.equal(denied.status,503);assert.equal(calls,8);
 release();const responses=await Promise.all(pending);assert.ok(responses.every(response=>response.status===200));assert.equal((await handler(request())).status,200);
});
