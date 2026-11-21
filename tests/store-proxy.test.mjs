import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicStoreProxy} from '../src/services/store-proxy.mjs';
const raw=[{store:{id:'8527800',storeNumber:'85278-313836',name:'104 Jay St',address:{lines:['104 Jay St'],city:'Brooklyn',countrySubdivisionCode:'NY',postalCode:'11201',countryCode:'US'},coordinates:{latitude:40.70205,longitude:-73.98686},private:'never-return'}}];
test('store proxy uses fixed HTTP API, strips private fields and caches cloned results until expiry',async()=>{
 let calls=0,time=0;const proxy=createPublicStoreProxy({now:()=>time,ttlMs:100,fetchImpl:async(url,init)=>{calls++;assert.equal(url,'https://www.starbucks.com/apiproxy/v1/locations?place=11201');assert.deepEqual(init.headers,{Accept:'application/json','X-Requested-With':'XMLHttpRequest'});assert.equal(init.credentials,'omit');assert.equal(init.redirect,'manual');return Response.json(raw);}});
 const first=await proxy.search(' 11201 ');assert.doesNotMatch(JSON.stringify(first),/private|never-return/);first[0].store.name='Changed';assert.equal((await proxy.search('11201'))[0].store.name,'104 Jay St');assert.equal(calls,1);time=101;await proxy.search('11201');assert.equal(calls,2);
});
test('same lookup shares one pending HTTP request; coordinate keys round and remain distinct from text',async()=>{
 let calls=0,release;const gate=new Promise(resolve=>{release=resolve;});const urls=[];
 const proxy=createPublicStoreProxy({fetchImpl:async url=>{calls++;urls.push(url);await gate;return Response.json(raw);}});
 const a=proxy.search({latitude:40.702051,longitude:-73.98686}),b=proxy.search({latitude:40.702052,longitude:-73.986861});release();await Promise.all([a,b]);assert.equal(calls,1);assert.equal(urls[0],'https://www.starbucks.com/apiproxy/v1/locations?lat=40.7021&lng=-73.9869');await proxy.search('40.7021,-73.9869');assert.equal(calls,2);
});
test('expired least-recently-used entries are bounded and not extended by a read',async()=>{
 let calls=0,time=0;const proxy=createPublicStoreProxy({maxEntries:1,ttlMs:100,now:()=>time,fetchImpl:async()=>{calls++;return Response.json(raw);}});
 await proxy.search('11201');time=90;await proxy.search('11201');time=101;await proxy.search('11201');await proxy.search('11202');await proxy.search('11201');assert.equal(calls,4);
});
test('rate limit blocks fresh upstream lookups across queries but permits still-fresh cached data',async()=>{
 let calls=0,time=0;const proxy=createPublicStoreProxy({now:()=>time,fetchImpl:async()=>{calls++;return calls===1?Response.json(raw):new Response('private',{status:429,headers:{'Retry-After':'2','Set-Cookie':'secret=x'}});}});
 await proxy.search('cached');await assert.rejects(proxy.search('limited'),e=>e.code==='RATE_LIMITED'&&e.retryAfterMs===2000);await assert.rejects(proxy.search('another'),e=>e.code==='RATE_LIMITED');assert.equal(calls,2);assert.equal((await proxy.search('cached')).length,1);assert.equal(calls,2);time=2001;await assert.rejects(proxy.search('another'));assert.equal(calls,3);
});
test('network failures, redirects and malformed/oversized responses never cache or expose upstream details',async()=>{
 for(const response of [()=>new Response('secret',{status:302,headers:{Location:'https://evil.test'}}),()=>new Response('secret',{status:500}),()=>new Response('<html/>'),()=>new Response('{',{headers:{'Content-Type':'application/json'}}),()=>Response.json({stores:raw}),()=>Response.json([{store:{...raw[0].store,coordinates:{latitude:1000,longitude:0}}}]),()=>new Response('x'.repeat(1048577),{headers:{'Content-Type':'application/json'}})]){
  let calls=0;const proxy=createPublicStoreProxy({fetchImpl:async()=>{calls++;return response();}});await assert.rejects(proxy.search('11201'),e=>e.code==='UNAVAILABLE'&&!e.message.includes('secret'));await assert.rejects(proxy.search('11201'));assert.equal(calls,2);
 }
});
test('invalid queries do not fetch and pending cardinality is bounded',async()=>{
 let calls=0,release;const gate=new Promise(resolve=>{release=resolve;});const proxy=createPublicStoreProxy({maxPending:1,fetchImpl:async()=>{calls++;await gate;return Response.json(raw);}});
 for(const query of ['', 'x'.repeat(121),{latitude:91,longitude:0},{latitude:0,longitude:0,extra:true}])await assert.rejects(proxy.search(query));assert.equal(calls,0);const pending=proxy.search('a');await assert.rejects(proxy.search('b'));release();await pending;assert.equal(calls,1);
});
