import test from 'node:test';import assert from 'node:assert/strict';
import {storeServices} from '../src/server/stores-api.mjs';
import {createStarbucksStores,createStoreSelection} from '../src/adapters/starbucks-stores.mjs';
const secret='test-secret-'.repeat(4);
const raw={id:'8527800',storeNumber:'85278-313836',name:'104 Jay St',address:{lines:['104 Jay St','Brooklyn, NY 11201'],city:'Brooklyn',countrySubdivisionCode:'NY',postalCode:'11201',countryCode:'US'},coordinates:{latitude:40.70205,longitude:-73.98686}};
test('search normalizes provider stores, bounds cache and signs trusted selection',async()=>{
 let calls=0,time=1000;const selection=createStoreSelection({secret,now:()=>time,ttlMs:100});const source=createStarbucksStores({selection,now:()=>time,ttlMs:50,fetchImpl:async(url,options)=>{calls++;assert.equal(new URL(url).searchParams.get('place'),'11201');assert.equal(options.headers['X-Requested-With'],'XMLHttpRequest');return Response.json([{distance:1,store:raw}]);}});
 const stores=await source.search('11201');assert.equal(stores[0].address.region,'NY');assert.equal(stores[0].sourceStoreNumber,raw.storeNumber);assert.equal((await selection.verify(stores[0].storeId,stores[0].selectionToken)).name,raw.name);await source.search('11201');assert.equal(calls,1);time=1060;await source.search('11201');assert.equal(calls,2);time=1200;await assert.rejects(selection.verify(stores[0].storeId,stores[0].selectionToken));
});
test('selection rejects tampering, wrong store and missing selection',async()=>{const selection=createStoreSelection({secret});const token=await selection.sign({storeId:'1',source:'starbucks',sourceStoreNumber:'1-2',name:'Cafe',address:{lines:['Street'],city:'City',region:'NY',postalCode:'1',countryCode:'US'},coordinates:{latitude:1,longitude:2}});await assert.rejects(selection.verify('2',token));await assert.rejects(selection.verify('1',token+'x'));await assert.rejects(selection.verify('',''));});
test('search rejects invalid queries and upstream failures without caching',async()=>{let calls=0;const source=createStarbucksStores({selection:createStoreSelection({secret}),fetchImpl:async()=>{calls++;return new Response('private',{status:500});}});await assert.rejects(source.search(''));await assert.rejects(source.search('x'.repeat(121)));await assert.rejects(source.search('11201'));await assert.rejects(source.search('11201'));assert.equal(calls,2);});
test('search enforces response bounds and store geometry',async()=>{for(const response of [new Response('x'.repeat(1048577),{headers:{'Content-Type':'application/json'}}),Response.json([{store:{...raw,coordinates:{latitude:999,longitude:0}}}]),Response.json({stores:[]})]){const source=createStarbucksStores({selection:createStoreSelection({secret}),fetchImpl:async()=>response});await assert.rejects(source.search('11201'));}});

test('public store search services work without optional browser pricing',async()=>{for(const env of [{OPENROUTER_API_KEY:'fixture'},{STARBUCKS_BROWSER_URL:'http://127.0.0.1:4174',BARISTA_BROWSER_TOKEN:''}]){const service=storeServices(env);assert.equal(storeServices(env),service);const token=await service.selection.sign({storeId:raw.id,source:'starbucks',sourceStoreNumber:raw.storeNumber,name:raw.name,address:{lines:raw.address.lines,city:raw.address.city,region:'NY',postalCode:'11201',countryCode:'US'},coordinates:raw.coordinates});assert.equal((await service.selection.verify(raw.id,token)).storeId,raw.id);}});
test('configured HTTP loader is primary, deduplicates pending work and signs cached results',async()=>{
 let calls=0,release;const gate=new Promise(resolve=>{release=resolve;});const selection=createStoreSelection({secret});
 const source=createStarbucksStores({selection,fetchImpl:async()=>assert.fail('must not call another transport'),loadStores:async query=>{calls++;assert.equal(query,'11201');await gate;return Array.from({length:50},(_,i)=>({store:{...raw,id:String(8527800+i)}}));}});
 const first=source.search('11201'),second=source.search('11201');release();const [stores,duplicate]=await Promise.all([first,second]);
 assert.equal(stores.length,50);assert.deepEqual(duplicate,stores);assert.equal((await selection.verify(stores[0].storeId,stores[0].selectionToken)).storeId,raw.id);await source.search('11201');assert.equal(calls,1);
});
test('configured loader failures never switch transports and are not cached',async()=>{
 let calls=0;const source=createStarbucksStores({selection:createStoreSelection({secret}),fetchImpl:async()=>assert.fail('no alternate transport'),loadStores:async()=>{calls++;throw Error('private failure');}});
 await assert.rejects(source.search('11201'));await assert.rejects(source.search('11201'));assert.equal(calls,2);
});
test('configured loader respects TTL and rejects malformed responses',async()=>{
 let calls=0,time=0;const source=createStarbucksStores({selection:createStoreSelection({secret}),now:()=>time,ttlMs:50,loadStores:async()=>{calls++;return calls===3?{stores:[]}:[{store:raw}];}});
 await source.search('11201');await source.search('11201');assert.equal(calls,1);time=51;await source.search('11201');assert.equal(calls,2);time=102;await assert.rejects(source.search('11201'));assert.equal(calls,3);
});
test('configured public lookup calls only the authenticated HTTP proxy and creates no session',async()=>{
 const {handleStoresApi}=await import('../src/server/stores-api.mjs');const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,'http://127.0.0.1:4174/stores');assert.deepEqual(JSON.parse(options.body),{query:'11201'});assert.equal(options.headers.Cookie,undefined);return Response.json([{store:raw}]);};
 try{const env={STARBUCKS_BROWSER_URL:'http://127.0.0.1:4174',BARISTA_BROWSER_TOKEN:secret};const response=await handleStoresApi(new Request('https://barista.example/api/stores?q=11201'),env);assert.equal(response.status,200);assert.equal(response.headers.get('set-cookie'),null);assert.equal((await response.json()).stores.length,1);await handleStoresApi(new Request('https://barista.example/api/stores?q=11201'),env);assert.equal(calls,1);}finally{globalThis.fetch=original;}
});
test('configured HTTP proxy failures return sanitized errors without a direct retry',async()=>{
 const {handleStoresApi}=await import('../src/server/stores-api.mjs');const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return new Response('private-provider-body',{status:403});};
 try{const response=await handleStoresApi(new Request('https://barista.example/api/stores?q=11201'),{STARBUCKS_BROWSER_URL:'http://127.0.0.1:4174',BARISTA_BROWSER_TOKEN:secret});assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'Store search unavailable'});assert.equal(calls,1);}finally{globalThis.fetch=original;}
});
test('rate-limited store lookup preserves Retry-After and blocks repeated upstream calls',async()=>{
 const {handleStoresApi}=await import('../src/server/stores-api.mjs');const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return new Response(null,{status:429,headers:{'Retry-After':'120'}});};
 try{const env={STARBUCKS_BROWSER_URL:'http://127.0.0.1:4174',BARISTA_BROWSER_TOKEN:secret};for(let i=0;i<2;i++){const response=await handleStoresApi(new Request('https://barista.example/api/stores?q=11201'),env);assert.equal(response.status,429);assert.equal(response.headers.get('Retry-After'),'120');assert.equal(response.headers.get('set-cookie'),null);}assert.equal(calls,1);}finally{globalThis.fetch=original;}
});

test('coordinate searches round locations, isolate text cache and preserve zero',async()=>{
 const urls=[];const source=createStarbucksStores({selection:createStoreSelection({secret}),fetchImpl:async url=>{urls.push(new URL(url));return Response.json([{store:raw}]);}});
 await source.search({latitude:40.702051,longitude:-73.986861});await source.search({latitude:40.702059,longitude:-73.986859});
 assert.equal(urls.length,1);assert.equal(urls[0].searchParams.get('lat'),'40.7021');assert.equal(urls[0].searchParams.get('lng'),'-73.9869');assert.equal(urls[0].searchParams.has('place'),false);
 await source.search('40.7021,-73.9869');await source.search({latitude:0,longitude:0});assert.equal(urls.length,3);assert.equal(urls[2].searchParams.get('lat'),'0');
});
test('coordinate HTTP loader receives normalized coordinates and caches separately',async()=>{let calls=0;const source=createStarbucksStores({selection:createStoreSelection({secret}),fetchImpl:async()=>assert.fail('no alternate transport'),loadStores:async query=>{calls++;assert.deepEqual(query,{latitude:40.7021,longitude:-73.9869});return [{store:raw}];}});await source.search({latitude:40.702051,longitude:-73.986861});await source.search({latitude:40.702051,longitude:-73.986861});assert.equal(calls,1);});
test('public lookup rejects ambiguous, malformed and duplicate query parameters',async()=>{const {handleStoresApi}=await import('../src/server/stores-api.mjs');for(const query of ['','lat=0','lng=0','lat=&lng=0','lat=91&lng=0','lat=0&lng=181','lat=NaN&lng=0','lat=Infinity&lng=0','lat='+'0'.repeat(33)+'&lng=0','lat=0&lng=0&lat=1','q=11201&lat=0&lng=0','q=11201&q=11202','lat=0&lng=0&other=1'])assert.equal((await handleStoresApi(new Request('https://barista.example/api/stores?'+query),{})).status,400,query);});
test('public lookup accepts coordinate zero and forwards only the fixed locations URL',async()=>{const {handleStoresApi}=await import('../src/server/stores-api.mjs');const original=globalThis.fetch;globalThis.fetch=async url=>{assert.equal(new URL(url).searchParams.get('lat'),'0');assert.equal(new URL(url).searchParams.get('lng'),'0');return Response.json([{store:raw}]);};try{assert.equal((await handleStoresApi(new Request('https://barista.example/api/stores?lat=0&lng=0'),{})).status,200);}finally{globalThis.fetch=original;}});
