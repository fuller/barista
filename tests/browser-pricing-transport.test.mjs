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
