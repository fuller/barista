import test from 'node:test';import assert from 'node:assert/strict';
import {createPrepareApi} from '../src/server/prepare-api.mjs';
import {getQuoteSession,quoteCacheScope} from '../src/server/pricing-session.mjs';
const store={storeId:'8527800',sourceStoreNumber:'85278-313836'};
const request=(body={storeId:store.storeId,selectionToken:'fixture'},headers={})=>new Request('https://barista.example/api/pricing/prepare',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
const verifyStore=async(id,token)=>{if(id!==store.storeId||token!=='fixture')throw Error();return store;};
test('preparation verifies signed store and shares stable private cookie scope without pricing',async()=>{
 let calls=0,session;const api=createPrepareApi({verifyStore,source:{prepare:async(key,options)=>{calls++;session=key;assert.deepEqual(options.selectedStore,store);return {ready:true};}}});
 const response=await api(request());assert.equal(response.status,200);const cookie=response.headers.get('Set-Cookie').split(';')[0],data=await response.json();assert.deepEqual(data,{ready:true,storeId:store.storeId,cacheScope:await quoteCacheScope(session)});assert.doesNotMatch(JSON.stringify(data),new RegExp(session));assert.match(response.headers.get('Set-Cookie'),/HttpOnly; SameSite=Strict; Max-Age=900; Secure/);
 const repeat=await api(request(undefined,{Cookie:cookie}));assert.equal((await repeat.json()).cacheScope,data.cacheScope);assert.equal(calls,2);
});
test('invalid, foreign, oversized and unsigned preparation cannot allocate browser work',async()=>{
 let calls=0;const api=createPrepareApi({verifyStore,source:{prepare:async()=>{calls++;return {ready:true};}}});
 assert.equal((await api(request(undefined,{Origin:'https://other.example'}))).status,403);
 assert.equal((await api(request(undefined,{'Sec-Fetch-Site':'cross-site'}))).status,403);
 assert.equal((await api(request(undefined,{'Content-Type':'text/plain'}))).status,415);
 assert.equal((await api(request({storeId:store.storeId,selectionToken:'bad'}))).status,400);
 assert.equal((await api(request({storeId:store.storeId,selectionToken:'fixture',extra:true}))).status,400);
 assert.equal((await api(request({storeId:store.storeId,selectionToken:'x'.repeat(9000)}))).status,413);
 assert.equal(calls,0);
});
test('preparation bounds pending work, honors cancellation and sanitizes rate-limit failures',async()=>{
 let release,calls=0;const gate=new Promise(resolve=>{release=resolve;});const api=createPrepareApi({verifyStore,source:{prepare:async()=>{calls++;await gate;return {ready:true};}}});
 const pending=Array.from({length:8},()=>api(request()));while(calls<8)await new Promise(r=>setImmediate(r));assert.equal((await api(request())).status,503);release();assert.ok((await Promise.all(pending)).every(r=>r.status===200));
 const limited=createPrepareApi({verifyStore,source:{prepare:async()=>{throw Object.assign(Error('private browser detail'),{code:'RATE_LIMITED',retryAfterMs:120000});}}});const response=await limited(request());assert.equal(response.status,429);assert.equal(response.headers.get('Retry-After'),'120');assert.deepEqual(await response.json(),{error:'Live pricing unavailable'});
 const controller=new AbortController();controller.abort();const aborted=new Request(request(),{signal:controller.signal});let called=false;const cancel=createPrepareApi({verifyStore,source:{prepare:async()=>{called=true;return {ready:true};}}});assert.equal((await cancel(aborted)).status,503);assert.equal(called,false);
});
test('duplicate or malformed private cookies create fresh independent cache namespaces',async()=>{const valid='12345678-1234-4234-8234-123456789abc';const req=cookie=>new Request('https://barista.example',{headers:{Cookie:cookie}});assert.equal(getQuoteSession(req('barista_quote='+valid)),valid);assert.notEqual(getQuoteSession(req('barista_quote='+valid+'; barista_quote='+valid)),valid);assert.notEqual(getQuoteSession(req('barista_quote=bad')),valid);assert.equal((await quoteCacheScope(valid)).length,64);});
test('public prepare uses signed selection, separate rate budget and configured browser source',async()=>{
 const {handleApi}=await import('../src/server/api.mjs');const {storeServices}=await import('../src/server/stores-api.mjs');
 const selectedStore={...store,source:'starbucks',name:'Cafe',address:{lines:['1 Main'],city:'Brooklyn',region:'NY',postalCode:'11201',countryCode:'US'},coordinates:{latitude:40,longitude:-73}};
 const keys=[],env={STARBUCKS_BROWSER_URL:'http://127.0.0.1:4174',BARISTA_BROWSER_TOKEN:'private-test-token-'.repeat(3),REQUIRE_TURN_RATE_LIMIT:'true',TURN_RATE_LIMITER:{limit:async({key})=>{keys.push(key);return {success:true};}}};
 const selectionToken=await storeServices(env).selection.sign(selectedStore);const previous=globalThis.fetch;let calls=0;
 globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,'http://127.0.0.1:4174/prepare');assert.deepEqual(JSON.parse(options.body).selectedStore,selectedStore);return Response.json({ready:true});};
 try{const response=await handleApi(request({storeId:store.storeId,selectionToken},{'CF-Connecting-IP':'192.0.2.1'}),env);assert.equal(response.status,200);assert.match((await response.json()).cacheScope,/^[a-f0-9]{64}$/);assert.deepEqual(keys,['prepare:192.0.2.1']);assert.equal(calls,1);
  env.TURN_RATE_LIMITER.limit=async()=>({success:false});assert.equal((await handleApi(request({storeId:store.storeId,selectionToken},{'CF-Connecting-IP':'192.0.2.1'}),env)).status,429);assert.equal(calls,1);
 }finally{globalThis.fetch=previous;}
});

test('cache namespace binds the trusted source menu version as well as private session',async()=>{
 const {default:directory}=await import('../src/catalog/data/starbucks-menu-directory.json',{with:{type:'json'}});
 const session='12345678-1234-4234-8234-123456789abc';
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('barista-price-cache-v1:'+directory.version+':'+session));
 const expected=[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
 assert.equal(await quoteCacheScope(session),expected);
});
