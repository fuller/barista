import test from 'node:test';
import assert from 'node:assert/strict';
import {createHeadedTransport} from '../src/browser/headed-transport.mjs';
function fake(){const contexts=[];return {contexts,launch:async()=>({newContext:async()=>{const events={};const c={closed:false,calls:0,result:{status:200,envelope:{ok:true}},ready:()=>events.response({url:()=> 'https://www.starbucks.com/apiproxy/v1/account/signin/guest',status:()=>200}),close:async()=>{c.closed=true;},newPage:async()=>({on:(n,f)=>{events[n]=f;},goto:async()=>{},bringToFront:async()=>{},isClosed:()=>c.closed,url:()=> 'https://www.starbucks.com/menu',evaluate:async()=>{c.calls++;return c.result;}})};contexts.push(c);return c;},close:async()=>{}})};}
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
