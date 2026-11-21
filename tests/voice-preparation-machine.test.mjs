import test from 'node:test';
import assert from 'node:assert/strict';
import {createVoicePreparation} from '../src/application/voice-preparation.mjs';
test('machine exposes debounce, pending, ready, and ownership transfer states',async()=>{
 let fire;let resolve;
 const pending=new Promise(yes=>{resolve=yes;});
 const p=createVoicePreparation({request:()=>pending,setTimer:fn=>{fire=fn;return 1;},clearTimer:()=>{},makeId:()=> 'prepared'});
 assert.equal(p.getSnapshot().value,'idle');p.begin({revision:1});assert.equal(p.getSnapshot().value,'waiting');
 p.update('latte');assert.equal(p.getSnapshot().value,'debouncing');fire();assert.equal(p.getSnapshot().value,'pending');
 resolve({commands:[]});await new Promise(setImmediate);assert.equal(p.getSnapshot().value,'ready');
 const candidate=p.take('latte',1);assert.ok(candidate);assert.equal(p.getSnapshot().value,'idle');p.cancel();assert.equal(candidate.controller.signal.aborted,false);
});
test('two attempts bound corrections and reset on a new microphone session',()=>{
 const timers=new Map(),calls=[];let next=0;
 const p=createVoicePreparation({request:input=>{calls.push(input);return new Promise(()=>{});},setTimer:fn=>{timers.set(++next,fn);return next;},clearTimer:id=>timers.delete(id)});
 const fire=()=>{const [id,fn]=timers.entries().next().value;timers.delete(id);fn();};
 p.begin({revision:1});p.update('latte');fire();p.update('iced latte');assert.equal(calls[0].signal.aborted,true);assert.equal(p.getSnapshot().value,'debouncing');fire();assert.equal(calls.length,2);assert.equal(calls[1].signal.aborted,false);
 p.update('iced latte with oat milk');assert.equal(calls[1].signal.aborted,true);assert.equal(p.getSnapshot().value,'invalidated');p.update('latte');assert.equal(timers.size,0);assert.equal(calls.length,2);assert.equal(p.take('latte',1),null);
 p.begin({revision:2});p.update('cold brew');fire();assert.equal(calls.length,3);p.dispose();
});
test('withdrawn first attempt waits for new text and stale results cannot replace second preview',async()=>{
 const timers=new Map(),pending=[],previews=[];let next=0;
 const p=createVoicePreparation({request:input=>new Promise(resolve=>pending.push({input,resolve})),onPreview:value=>previews.push(value),setTimer:fn=>{timers.set(++next,fn);return next;},clearTimer:id=>timers.delete(id)});
 const fire=()=>{const [id,fn]=timers.entries().next().value;timers.delete(id);fn();};
 p.begin({revision:1});p.update('latte');fire();p.update('');assert.equal(p.getSnapshot().value,'waiting');assert.equal(timers.size,0);p.update('cold brew');fire();pending[0].resolve({old:true});await new Promise(setImmediate);assert.equal(previews.filter(Boolean).length,0);pending[1].resolve({current:true});await new Promise(setImmediate);assert.deepEqual(previews.filter(Boolean),[{current:true}]);assert.ok(p.take('cold brew',1));p.dispose();
});
test('dispose cancels debounce and active work but preserves detached work',()=>{
 const timers=new Map();let next=0;
 const options={request:()=>new Promise(()=>{}),setTimer:fn=>{timers.set(++next,fn);return next;},clearTimer:id=>timers.delete(id)};
 const p=createVoicePreparation(options);p.begin({revision:1});p.update('latte');p.dispose();assert.equal(timers.size,0);assert.equal(p.getSnapshot().status,'stopped');
 const q=createVoicePreparation(options);q.begin({revision:1});q.update('latte');timers.get(next)();const active=q.getSnapshot().context.candidate;q.dispose();assert.equal(active.controller.signal.aborted,true);
 const r=createVoicePreparation(options);r.begin({revision:1});r.update('latte');timers.get(next)();const detached=r.take('latte',1);r.dispose();assert.equal(detached.controller.signal.aborted,false);
});
test('ready callback cancellation cannot publish a stale preview',async()=>{
 let fire;const previews=[];let p;
 p=createVoicePreparation({request:async()=>({commands:[]}),setTimer:fn=>{fire=fn;return 1;},clearTimer:()=>{},onEvent:event=>{if(event==='preparationReady')p.cancel();},onPreview:value=>previews.push(value)});
 p.begin({revision:1});p.update('latte');fire();await new Promise(setImmediate);assert.equal(previews.filter(Boolean).length,0);assert.equal(p.getSnapshot().value,'idle');
});
test('started callback cancellation passes an aborted request signal and leaves no candidate',()=>{
 let fire;const signals=[];let p;
 p=createVoicePreparation({request:input=>{signals.push(input.signal.aborted);return new Promise(()=>{});},setTimer:fn=>{fire=fn;return 1;},clearTimer:()=>{},onEvent:event=>{if(event==='preparationStarted')p.cancel();}});
 p.begin({revision:1});p.update('latte');fire();assert.equal(signals.length,1);assert.equal(signals[0],true);assert.equal(p.getSnapshot().value,'idle');
});
test('ready hook adoption suppresses preview and keeps transferred work live',async()=>{
 let fire;let p;let adopted;const previews=[];
 p=createVoicePreparation({request:async()=>({commands:[]}),setTimer:fn=>{fire=fn;return 1;},clearTimer:()=>{},onEvent:event=>{if(event==='preparationReady')adopted=p.take('latte',1);},onPreview:value=>previews.push(value)});
 p.begin({revision:1});p.update('latte');fire();await new Promise(setImmediate);assert.ok(adopted);assert.equal(previews.filter(Boolean).length,0);assert.equal(adopted.controller.signal.aborted,false);assert.equal(p.getSnapshot().value,'idle');p.dispose();
});
test('injected clock functions receive no method receiver',()=>{
 let next=0;const timers=new Map();
 const p=createVoicePreparation({request:()=>new Promise(()=>{}),setTimer:function(callback){assert.equal(this,undefined);timers.set(++next,callback);return next;},clearTimer:function(timer){assert.equal(this,undefined);timers.delete(timer);}});
 p.begin({revision:1});p.update('latte');assert.equal(timers.size,1);p.cancel();assert.equal(timers.size,0);p.dispose();
});
