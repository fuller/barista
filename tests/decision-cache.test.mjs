import test from 'node:test';import assert from 'node:assert/strict';
import {createDecisionCache} from '../src/adapters/decision-cache.mjs';
const context=(extra={})=>({credential:'fake-account-a',model:'model',profile:'lean-v7',menuVersion:'menu-v1',route:'decisions',body:'{"state":"exact source"}',threshold:.85,margin:.15,...extra});
test('SHA256 exact keys isolate account/model/profile/body/context without exposing them',async()=>{
 const cache=createDecisionCache(),key=await cache.keyFor(context());assert.match(key,/^[0-9a-f]{64}$/);assert.equal(await cache.keyFor(context()),key);for(const extra of [{credential:'fake-account-b'},{model:'other'},{profile:'baseline'},{menuVersion:'menu-v2'},{body:'{"state":"changed source"}'},{threshold:.9},{route:'other'}])assert.notEqual(await cache.keyFor(context(extra)),key);assert.equal(key.includes('fake-account'),false);
});
test('values clone on admission and hits, expiry never slides on reads',async()=>{
 let now=10;const cache=createDecisionCache({now:()=>now,ttlMs:50}),key=await cache.keyFor(context()),value={answers:{x:{choice:'yes'}}};assert.equal(cache.set(key,value),true);value.answers.x.choice='mutated';const hit=cache.get(key);assert.equal(hit.answers.x.choice,'yes');hit.answers.x.choice='changed';assert.equal(cache.get(key).answers.x.choice,'yes');now=59;assert.ok(cache.get(key));now=60;assert.equal(cache.get(key),undefined);assert.deepEqual(cache.stats(),{entries:0,bytes:0});
});
test('LRU entries/serialized bytes remain bounded and oversize admission is atomic',async()=>{
 const cache=createDecisionCache({maxEntries:2,maxBytes:220}),a=await cache.keyFor(context({body:'a'})),b=await cache.keyFor(context({body:'b'})),c=await cache.keyFor(context({body:'c'}));cache.set(a,{v:'a'});cache.set(b,{v:'b'});cache.get(a);cache.set(c,{v:'c'});assert.equal(cache.get(b),undefined);assert.ok(cache.get(a));assert.ok(cache.stats().bytes<=220);assert.equal(cache.set(a,{v:'x'.repeat(1000)}),false);assert.equal(cache.get(a).v,'a');cache.clear();assert.deepEqual(cache.stats(),{entries:0,bytes:0});
});
test('abort checked before and after async hashing, limits cannot exceed production bounds',async()=>{
 const controller=new AbortController();controller.abort();const cache=createDecisionCache();await assert.rejects(()=>cache.keyFor(context(),{signal:controller.signal}),{name:'AbortError'});
 const late=new AbortController(),pending=cache.keyFor(context(),{signal:late.signal});late.abort();await assert.rejects(()=>pending,{name:'AbortError'});
 for(const options of [{maxEntries:129},{maxBytes:2097153},{ttlMs:300001}])assert.throws(()=>createDecisionCache(options),/Invalid/);
});
test('byte eviction works independently from entry count and clear invalidates all entries',async()=>{
 const cache=createDecisionCache({maxEntries:8,maxBytes:160}),keys=await Promise.all(['a','b','c'].map(body=>cache.keyFor(context({body}))));for(const [i,key] of keys.entries())cache.set(key,{v:i});assert.equal(cache.stats().entries,2);assert.ok(cache.stats().bytes<=160);assert.equal(cache.get(keys[0]),undefined);assert.ok(cache.get(keys[2]));cache.clear();assert.equal(cache.get(keys[2]),undefined);
});
