import test from 'node:test';import assert from 'node:assert/strict';
import {createVoicePreparation} from '../src/application/voice-preparation.mjs';
function harness(request=async()=>({commands:[]})){
 let next=0;const timers=new Map(),calls=[],previews=[],events=[];
 const preparation=createVoicePreparation({request:args=>{calls.push(args);return request(args);},onPreview:(...args)=>previews.push(args),onEvent:(...args)=>events.push(args),setTimer:(fn,delay)=>{const id=++next;timers.set(id,{fn,delay});return id;},clearTimer:id=>timers.delete(id),makeId:()=>`turn-${next}`});
 return {preparation,timers,calls,previews,events,fire(){const [id,timer]=timers.entries().next().value??[];assert.ok(timer);timers.delete(id);timer.fn();}};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('exact final before debounce clears timer and dispatches no speculative request',()=>{
 const h=harness();h.preparation.begin({revision:2});h.preparation.update('a latte');assert.equal(h.preparation.take('a latte',2),null);assert.equal(h.timers.size,0);assert.equal(h.calls.length,0);
});
test('duplicate trimmed interim preserves original debounce timer and one dispatch',async()=>{
 const pending=deferred(),h=harness(()=>pending.promise);h.preparation.begin({revision:3});h.preparation.update('  a latte ');const original=[...h.timers.keys()][0];assert.equal(h.timers.get(original).delay,650);h.preparation.update('a latte');assert.deepEqual([...h.timers.keys()],[original]);h.fire();h.preparation.update('a latte');assert.equal(h.calls.length,1);assert.equal(h.timers.size,0);pending.resolve({commands:[]});await flush();assert.deepEqual(h.events.map(([name])=>name),['preparationStarted','preparationReady']);
});
test('begin captures immutable snapshot and request receives independent cancellation signal',async()=>{
 const snapshot={revision:4,order:{items:[{quantity:1}]},pending:{id:'old'}},h=harness();h.preparation.begin(snapshot);snapshot.order.items[0].quantity=9;snapshot.pending.id='changed';h.preparation.update('latte');h.fire();assert.equal(h.calls[0].order.items[0].quantity,1);assert.equal(h.calls[0].pending.id,'old');assert.equal(h.calls[0].revision,4);assert.equal(h.calls[0].text,'latte');assert.equal(h.calls[0].signal.aborted,false);await flush();
});
test('exact final detaches pending candidate without aborting and preserves actual response promise',async()=>{
 const pending=deferred(),h=harness(()=>pending.promise);h.preparation.begin({revision:5});h.preparation.update('latte');h.fire();const candidate=h.preparation.take('latte',5);assert.ok(candidate);assert.equal(candidate.revision,5);assert.equal(candidate.text,'latte');assert.equal(candidate.turnId,h.calls[0].turnId);h.preparation.cancel();assert.equal(candidate.controller.signal.aborted,false);pending.resolve({commands:[{type:'clear'}]});assert.deepEqual(await candidate.promise,{commands:[{type:'clear'}]});await flush();assert.deepEqual(h.events.map(([name])=>name),['preparationStarted','preparationReused']);assert.equal(h.previews.filter(([value])=>value!==null).length,0);
});
for(const [text,revision] of [['Latte',6],['latte.',6],['latte',7]])test(`mismatched final ${text}/${revision} aborts preparation`,()=>{
 const h=harness(()=>new Promise(()=>{}));h.preparation.begin({revision:6});h.preparation.update('latte');h.fire();assert.equal(h.preparation.take(text,revision),null);assert.equal(h.calls[0].signal.aborted,true);assert.equal(h.timers.size,0);
});
test('interim corrections replace timer before dispatch',()=>{
 const h=harness();h.preparation.begin({revision:1});h.preparation.update('latte');const first=[...h.timers.keys()][0];h.preparation.update('iced latte');assert.equal(h.timers.has(first),false);assert.equal(h.timers.size,1);h.fire();assert.equal(h.calls[0].text,'iced latte');
});
for(const text of ['', 'new latte', 'x'.repeat(601)])test(`changed or invalid interim after dispatch invalidates once (${text.length})`,async()=>{
 const pending=deferred(),h=harness(()=>pending.promise);h.preparation.begin({revision:1});h.preparation.update('latte');h.fire();h.preparation.update(text);assert.equal(h.calls[0].signal.aborted,true);h.preparation.update('latte');assert.equal(h.timers.size,0);assert.equal(h.preparation.take('latte',1),null);pending.resolve({commands:[]});await flush();assert.equal(h.previews.filter(([value])=>value!==null).length,0);
});
test('invalid interim never dispatches; empty interim cancels pending debounce',()=>{
 const h=harness();h.preparation.begin({revision:1});for(const text of ['  ','x'.repeat(601)])h.preparation.update(text);assert.equal(h.timers.size,0);h.preparation.update('latte');h.preparation.update('');assert.equal(h.timers.size,0);assert.equal(h.calls.length,0);
});
test('new session aborts previous candidate and ignores its late response',async()=>{
 const old=deferred(),h=harness(()=>old.promise);h.preparation.begin({revision:1});h.preparation.update('old');h.fire();h.preparation.begin({revision:2});assert.equal(h.calls[0].signal.aborted,true);old.resolve({old:true});await flush();assert.equal(h.previews.filter(([value])=>value!==null).length,0);h.preparation.update('new');h.fire();assert.equal(h.calls.length,2);
});
test('ready preview belongs to current candidate and cancel clears it',async()=>{
 const h=harness(async()=>({commands:[]}));h.preparation.begin({revision:1});h.preparation.update('latte');h.fire();await flush();const preview=h.previews.find(([value])=>value!==null);assert.deepEqual(preview[0],{commands:[]});assert.equal(preview[1].text,'latte');h.preparation.cancel();assert.equal(h.previews.at(-1)[0],null);assert.equal(preview[1].controller.signal.aborted,true);
});
for(const synchronous of [false,true])test(`failed preparation declines final adoption without another speculative request (${synchronous})`,async()=>{
 const error=new Error('failed'),h=harness(()=>{if(synchronous)throw error;return Promise.reject(error);});h.preparation.begin({revision:1});h.preparation.update('latte');h.fire();await flush();h.preparation.update('latte');assert.equal(h.timers.size,0);assert.equal(h.calls.length,1);assert.equal(h.preparation.take('latte',1),null);assert.equal(h.calls[0].signal.aborted,true);assert.equal(h.events.some(([name])=>name==='preparationReady'),false);assert.equal(h.previews.filter(([value])=>value!==null).length,0);
});
test('failure after pending adoption preserves rejection without automatic retry',async()=>{
 const pending=deferred(),h=harness(()=>pending.promise);h.preparation.begin({revision:1});h.preparation.update('latte');h.fire();const candidate=h.preparation.take('latte',1);assert.ok(candidate);pending.reject(new Error('late failure'));await assert.rejects(candidate.promise,/late failure/);await flush();assert.equal(h.calls.length,1);assert.equal(h.timers.size,0);assert.equal(candidate.controller.signal.aborted,false);
});
test('updates after cancellation do nothing',()=>{const h=harness();h.preparation.begin({revision:1});h.preparation.update('latte');h.preparation.cancel();h.preparation.update('new');assert.equal(h.timers.size,0);assert.equal(h.calls.length,0);});
test('externally aborted candidate cannot be adopted by exact final',async()=>{
 const h=harness();h.preparation.begin({revision:1});h.preparation.update('latte');h.fire();await flush();const candidate=h.previews.find(([value])=>value!==null)[1];candidate.controller.abort();assert.equal(h.preparation.take('latte',1),null);assert.equal(h.previews.at(-1)[0],null);
});
test('cancel clears preview even when session or candidate already invalidated',()=>{
 const h=harness(()=>new Promise(()=>{}));h.preparation.begin({revision:1});h.preparation.update('latte');h.fire();h.preparation.update('changed');let count=h.previews.length;h.preparation.cancel();assert.equal(h.previews.length,count+1);assert.equal(h.previews.at(-1)[0],null);count=h.previews.length;h.preparation.cancel();assert.equal(h.previews.length,count+1);
});
