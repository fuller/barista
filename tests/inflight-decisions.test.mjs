import test from 'node:test';
import assert from 'node:assert/strict';
import {createInflightDecisions} from '../src/adapters/inflight-decisions.mjs';
const key='a'.repeat(64),other='b'.repeat(64);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('identical pending work shares upstream and clones each result without caching',async()=>{
 const registry=createInflightDecisions(),pending=deferred();let calls=0;
 const producer=()=>{calls++;return pending.promise;};
 const one=registry.run(key,producer),two=registry.run(key,producer);pending.resolve({items:[1]});
 const [a,b]=await Promise.all([one,two]);assert.equal(calls,1);assert.equal(a.shared,false);assert.equal(b.shared,true);a.value.items.push(2);assert.deepEqual(b.value,{items:[1]});
 assert.deepEqual(registry.stats(),{entries:0,bytes:0});await registry.run(key,()=>{calls++;return 2;});assert.equal(calls,2);
});
for(const cancelled of [0,1])test(`subscriber ${cancelled} cancellation does not cancel remaining subscriber`,async()=>{
 const registry=createInflightDecisions(),pending=deferred(),controllers=[new AbortController(),new AbortController()];let upstream;
 const producer=({signal})=>{upstream=signal;return pending.promise;};
 const runs=controllers.map(c=>registry.run(key,producer,{signal:c.signal}));const rejected=assert.rejects(runs[cancelled],{name:'AbortError'});controllers[cancelled].abort();await rejected;assert.equal(upstream.aborted,false);pending.resolve('ok');assert.equal((await runs[1-cancelled]).value,'ok');
});
test('all cancellations abort upstream, release capacity, and late request starts fresh',async()=>{
 const registry=createInflightDecisions(),pending=deferred();let upstream;
 const a=new AbortController(),b=new AbortController();
 const first=registry.run(key,({signal})=>{upstream=signal;return pending.promise;},{signal:a.signal,bytes:50});const second=registry.run(key,()=>assert.fail(),{signal:b.signal});
 const rejects=[assert.rejects(first,{name:'AbortError'}),assert.rejects(second,{name:'AbortError'})];a.abort();b.abort();await Promise.all(rejects);assert.equal(upstream.aborted,true);assert.deepEqual(registry.stats(),{entries:0,bytes:0});assert.equal((await registry.run(key,()=>3)).value,3);pending.reject(new Error('late rejection'));await tick();
});
test('producer throws and rejected work clean up and allow retry',async()=>{
 const registry=createInflightDecisions();await assert.rejects(registry.run(key,()=>{throw new Error('sync');}),/sync/);
 const pending=deferred();const one=registry.run(key,()=>pending.promise),two=registry.run(key,()=>assert.fail());const rejections=[assert.rejects(one,/failed/),assert.rejects(two,/failed/)];pending.reject(new Error('failed'));await Promise.all(rejections);assert.deepEqual(registry.stats(),{entries:0,bytes:0});assert.equal((await registry.run(key,()=>4)).value,4);
});
test('preaborted caller never starts producer or joins entry',async()=>{
 const controller=new AbortController();controller.abort();const registry=createInflightDecisions();await assert.rejects(registry.run(key,()=>assert.fail(),{signal:controller.signal}),{name:'AbortError'});assert.equal(registry.stats().entries,0);
});
for(const limits of [{maxEntries:1},{maxBytes:70}])test(`saturated registry bypasses sharing safely ${JSON.stringify(limits)}`,async()=>{
 const registry=createInflightDecisions(limits),pending=deferred(),controller=new AbortController();const first=registry.run(key,()=>pending.promise,{bytes:6});let signal;
 const bypass=registry.run(other,({signal:s})=>{signal=s;return new Promise((_,reject)=>s.addEventListener('abort',()=>reject(s.reason)));},{signal:controller.signal,bytes:6});const rejected=assert.rejects(bypass,{name:'AbortError'});controller.abort();await rejected;assert.equal(signal.aborted,true);assert.equal(registry.stats().entries,1);pending.resolve(1);await first;assert.equal(registry.stats().bytes,0);
});
test('independent keys never share',async()=>{const registry=createInflightDecisions();const [a,b]=await Promise.all([registry.run(key,()=>1),registry.run(other,()=>2)]);assert.equal(a.value,1);assert.equal(b.value,2);assert.equal(b.shared,false);});
test('invalid keys and limits reject without revealing key',async()=>{
 const registry=createInflightDecisions();await assert.rejects(registry.run('secret-token',()=>assert.fail()),error=>!error.message.includes('secret-token'));
 for(const limits of [{maxEntries:0},{maxEntries:129},{maxBytes:0},{maxBytes:2097153}])assert.throws(()=>createInflightDecisions(limits));
 await assert.rejects(registry.run(key,()=>assert.fail(),{bytes:-1}));
});

test('shared errors preserve evaluation budget marker without sharing mutable errors',async()=>{
 const pool=createInflightDecisions(),error=Object.assign(new Error('budget'),{evalBudget:true});
 const key='f'.repeat(64);let fail;
 const pending=new Promise((_,reject)=>{fail=reject;});
 const first=pool.run(key,()=>pending),second=pool.run(key,()=>pending);
 fail(error);const results=await Promise.allSettled([first,second]);
 for(const result of results){assert.equal(result.status,'rejected');assert.equal(result.reason.evalBudget,true);assert.notEqual(result.reason,error);}
 assert.notEqual(results[0].reason,results[1].reason);
});
