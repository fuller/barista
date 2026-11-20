import test from 'node:test';
import assert from 'node:assert/strict';
import {createHeadedTransport} from '../src/browser/headed-transport.mjs';
function fake(){const contexts=[];return {contexts,launch:async()=>({newContext:async()=>{const events={};const mainFrame={};const c={closed:false,calls:0,result:{status:200,envelope:{ok:true}},response:response=>events.response(response),ready:()=>events.response({url:()=> 'https://www.starbucks.com/apiproxy/v1/account/signin/guest',status:()=>200}),close:async()=>{c.closed=true;},newPage:async()=>({on:(n,f)=>{events[n]=f;},mainFrame:()=>mainFrame,goto:async()=>{},bringToFront:async()=>{},isClosed:()=>c.closed,url:()=> 'https://www.starbucks.com/menu',evaluate:async()=>{c.calls++;return c.result;}})};c.document=status=>c.response({url:()=> 'https://www.starbucks.com/private-url',status:()=>status,request:()=>({isNavigationRequest:()=>true}),frame:()=>mainFrame,text:()=>{throw Error('must not read response text');}});contexts.push(c);return c;},close:async()=>{}})};}
test('setup diagnostics classify initial document 403 without leaking response details',async()=>{
 const f=fake();const transport=await createHeadedTransport({launch:f.launch,setup:async()=>{f.contexts[0].document(403);f.contexts[0].document(200);throw Error('private challenge text');}});
 try{await assert.rejects(transport.quote('private-session',{}),{code:'SETUP_REQUIRED'});const status=transport.status();assert.deepEqual(status.setupFailures,{access_denied:1,rate_limited:0,setup_incomplete:0});assert.deepEqual(status.setupHttpStatuses,{document:{403:1},guest:{}});assert.doesNotMatch(JSON.stringify(status),/private|starbucks\.com|challenge/);assert.equal(f.contexts[0].calls,0);}finally{await transport.close();}
});
test('successful guest setup clears diagnostics failures and ignores unrelated responses',async()=>{
 const f=fake();const transport=await createHeadedTransport({launch:f.launch,setup:async()=>{f.contexts[0].response({url:()=> 'https://www.starbucks.com/unrelated',status:()=>403});f.contexts[0].document(200);f.contexts[0].ready();}});
 try{assert.deepEqual(await transport.quote('a',{}),{ok:true});assert.deepEqual(transport.status().setupFailures,{access_denied:0,rate_limited:0,setup_incomplete:0});assert.deepEqual(transport.status().setupHttpStatuses,{document:{200:1},guest:{200:1}});}finally{await transport.close();}
});
test('caller contexts isolate readiness; clear releases capacity and next caller starts fresh',async()=>{
 const f=fake();const transport=await createHeadedTransport({launch:f.launch,setup:async()=>{},maxSessions:2});
 try{await assert.rejects(transport.quote('a',{}),{code:'SETUP_REQUIRED'});f.contexts[0].ready();assert.deepEqual(await transport.quote('a',{}),{ok:true});await assert.rejects(transport.quote('b',{}),{code:'SETUP_REQUIRED'});assert.equal(f.contexts.length,2);assert.equal(f.contexts[1].calls,0);await assert.rejects(transport.quote('c',{}));await transport.clear('a');assert.equal(f.contexts[0].closed,true);await assert.rejects(transport.quote('c',{}),{code:'SETUP_REQUIRED'});assert.equal(f.contexts.length,3);await transport.clear('c');await assert.rejects(transport.quote('c',{}),{code:'SETUP_REQUIRED'});assert.equal(f.contexts.length,4);}finally{await transport.close();}
});
test('idle expiry destroys context and requires fresh guest setup',async()=>{
 const f=fake();let now=1000;const transport=await createHeadedTransport({launch:f.launch,setup:async()=>{},now:()=>now,idleTtlMs:100});
 try{await assert.rejects(transport.quote('a',{}),{code:'SETUP_REQUIRED'});f.contexts[0].ready();now+=101;await assert.rejects(transport.quote('a',{}),{code:'SETUP_REQUIRED'});assert.equal(f.contexts[0].closed,true);assert.equal(f.contexts.length,2);}finally{await transport.close();}
});
test('429 enforces cooldown across sessions without retries',async()=>{
 const f=fake();let now=1000;const transport=await createHeadedTransport({launch:f.launch,setup:async()=>{},now:()=>now});
 try{await assert.rejects(transport.quote('a',{}));f.contexts[0].ready();f.contexts[0].result={status:429,retryAfter:'120'};await assert.rejects(transport.quote('a',{}),{code:'RATE_LIMITED'});await assert.rejects(transport.quote('b',{}),{code:'RATE_LIMITED'});assert.equal(f.contexts[0].calls,1);assert.equal(f.contexts.length,1);assert.equal(transport.status().cooldownMs,120000);}finally{await transport.close();}
});
test('closed tab never reuses ready guest state',async()=>{
 const f=fake();const transport=await createHeadedTransport({launch:f.launch,setup:async()=>{}});
 try{await assert.rejects(transport.quote('a',{}),{code:'SETUP_REQUIRED'});f.contexts[0].ready();f.contexts[0].closed=true;await assert.rejects(transport.quote('a',{}),{code:'SETUP_REQUIRED'});assert.equal(f.contexts.length,2);assert.equal(f.contexts[1].calls,0);}finally{await transport.close();}
});

test('changing stores closes old context and rejects stale setup completion',async()=>{
 const f=fake();let release;const pending=new Promise(resolve=>{release=resolve;});let count=0;
 const a={storeId:'a',source:'starbucks',sourceStoreNumber:'1-1',name:'A',address:{lines:['1 Main'],city:'Brooklyn',region:'NY',postalCode:'11201',countryCode:'US'},coordinates:{latitude:40,longitude:-73}};
 const b={...a,storeId:'b',sourceStoreNumber:'2-2',name:'B'};
 const transport=await createHeadedTransport({launch:f.launch,setup:async(page,{selectedStore})=>{count++;if(selectedStore.storeId==='a')await pending;f.contexts.find(c=>!c.closed)?.ready();}});
 try{const old=transport.quote('a',{}, {selectedStore:a});await new Promise(r=>setImmediate(r));assert.deepEqual(await transport.quote('a',{}, {selectedStore:b}),{ok:true});release();await assert.rejects(old);assert.equal(f.contexts[0].closed,true);assert.equal(f.contexts[0].calls,0);assert.equal(count,2);assert.equal(transport.status().sessions,1);}finally{release();await transport.close();}
});
test('changing stores rejects an old in-flight price response',async()=>{
 const f=fake();let release;const response=new Promise(resolve=>{release=resolve;});
 const a={sourceStoreNumber:'1-1'},b={sourceStoreNumber:'2-2'};
 const transport=await createHeadedTransport({launch:f.launch,setup:async()=>f.contexts.at(-1).ready()});
 try{await transport.quote('caller',{}, {selectedStore:a});
 const original=f.contexts[0].result;f.contexts[0].result=response;
 const old=transport.quote('caller',{}, {selectedStore:a});await new Promise(r=>setImmediate(r));
 assert.deepEqual(await transport.quote('caller',{}, {selectedStore:b}),{ok:true});release(original);await assert.rejects(old);assert.equal(f.contexts[0].closed,true);
 }finally{release?.({status:200,envelope:{ok:true}});await transport.close();}
});
test('store lookup uses temporary context, no guest setup, sanitizes and closes it',async()=>{
 let closed=0,setup=0,visited,evaluated;const raw=[{store:{id:'abc',storeNumber:'85278-313836',name:'Cafe',address:{lines:['1 Main'],city:'Brooklyn',countrySubdivisionCode:'NY',postalCode:'11201',countryCode:'US'},coordinates:{latitude:40,longitude:-73},secret:'cookie'}}];
 const transport=await createHeadedTransport({setup:async()=>setup++,launch:async()=>({newContext:async()=>({newPage:async()=>({goto:async url=>{visited=url;},evaluate:async(fn,args)=>{evaluated=args;return raw;}}),close:async()=>closed++}),close:async()=>{}})});
 try{const result=await transport.searchStores('11201');assert.equal(closed,1);assert.equal(setup,0);assert.equal(transport.status().sessions,0);assert.match(visited,/starbucks.com\/store-locator/);assert.equal(evaluated.query,'11201');assert.doesNotMatch(JSON.stringify(result),/secret|cookie/);}finally{await transport.close();}
});
test('store lookup closes temporary context on failure and bounds concurrent work',async()=>{
 let closed=0,release;const pending=new Promise(r=>{release=r;});const transport=await createHeadedTransport({launch:async()=>({newContext:async()=>({newPage:async()=>({goto:async()=>pending,evaluate:async()=>{throw Error('private');}}),close:async()=>closed++}),close:async()=>{}})});
 try{const first=transport.searchStores('11201');await new Promise(r=>setImmediate(r));await assert.rejects(transport.searchStores('11202'));release();await assert.rejects(first);assert.equal(closed,1);}finally{release();await transport.close();}
});
