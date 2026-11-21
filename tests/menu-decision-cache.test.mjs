import test from 'node:test';import assert from 'node:assert/strict';
import {createDecisionCache} from '../src/adapters/decision-cache.mjs';
import {createMenuDeciderAdapter,buildMenuIdentityGroups} from '../src/adapters/menu-decider.mjs';
import {createOrder,applyCommands} from '../src/domain/order.mjs';
import directory from '../src/catalog/data/starbucks-menu-directory.json' with {type:'json'};
const identity='407:Hot',group=buildMenuIdentityGroups(directory.products).find(g=>g.products.some(p=>p.identity===identity)).id;
function provider({failure,operation='add'}={}){
 const calls=[];const fetchImpl=async(_url,init)=>{
  const body=JSON.parse(init.body),keys=Object.keys(body.questions);calls.push(body);const pure=!keys.includes('coverage'),kind=keys.includes('identity')?'identity':keys.includes('quantity')?'detail':keys[0].startsWith('b')?'boundary':'core';
  if(pure&&failure==='http')return new Response('private upstream',{status:429});
  if(pure&&failure==='json')return {ok:true,json:async()=>{throw new Error('private upstream');}};
  const state=JSON.parse(body.state),target=state.cart?.[0]?.id;
  const chosen={identity,coverage:'complete',action:operation,productGroup:operation==='add'?group:'unchanged',target:operation==='add'?'none':target,replacementRequested:'absent',targetScope:'item',sizeRequested:'absent',size:'unchanged',quantityRequested:operation==='add'?'absent':'requested',quantity:'1',singleAddQuantity:'detail',b0:'continue'};
  const answers=Object.fromEntries(Object.entries(body.questions).map(([key,q])=>{const selected=chosen[key]??'continue';assert.ok(Object.hasOwn(q.criteria,selected),key+': '+selected);const probability=pure&&failure==='low'?.6:.99;return [key,{type:'choice',choice:selected,probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k===selected?probability:(1-probability)/(Object.keys(q.criteria).length-1)]))}];}));
  if(pure&&failure==='refusal')answers[keys[0]]={type:'refusal'};
  if(kind==='detail'&&failure==='retry')answers.quantity={type:'choice',choice:'unclear',probabilities:Object.fromEntries(Object.keys(body.questions.quantity.criteria).map(k=>[k,k==='unclear'?.99:.01/(Object.keys(body.questions.quantity.criteria).length-1)]))};
  return Response.json({...((pure&&failure==='truncated')?{truncated:true}:{}),answers:(pure&&failure==='schema')?{}:answers});
 };return {calls,fetchImpl};
}
const adapter=(cache,p,options={})=>createMenuDeciderAdapter({apiKey:'fake-key-a',questionProfile:'lean-v8',fetchImpl:p.fetchImpl,cache,...options});
test('cold/warm cache saves only pure actual fetches; main routing always dispatches',async()=>{
 const cache=createDecisionCache(),p=provider(),a=adapter(cache,p),input={text:'a latte',order:createOrder()};const cold=await a.interpretTurn(input),warm=await a.interpretTurn(input);assert.deepEqual(warm.commands,cold.commands);assert.equal(cold.metrics.totalRequests,3);assert.equal(cold.metrics.cacheHits,0);assert.equal(warm.metrics.totalRequests,1);assert.equal(warm.metrics.decisionRequests,1);assert.equal(warm.metrics.cacheHits,2);assert.equal(p.calls.length,4);assert.equal(Object.hasOwn(p.calls.at(-1).questions,'coverage'),true);assert.equal(cache.stats().entries,2);
});
test('native boundary hits retain exact source and never skip whole-cart validation',async()=>{
 const cache=createDecisionCache(),p=provider(),a=adapter(cache,p),input={text:'a latte, warmed',order:createOrder()};const cold=await a.interpretTurn(input),warm=await a.interpretTurn(input);assert.equal(warm.metrics.cacheHits,3);assert.equal(warm.metrics.totalRequests,1);assert.deepEqual(warm.commands,cold.commands);assert.equal(applyCommands(input.order,warm.commands).menuItems[0].identity,identity);
});
for(const failure of ['low','refusal','truncated','schema','http','json','retry'])test('cache admission excludes '+failure+' results and failed turns',async()=>{
 const cache=createDecisionCache(),p=provider({failure}),a=adapter(cache,p);try{await a.interpretTurn({text:'a latte',order:createOrder()});}catch{                                                      }assert.equal(cache.stats().entries,0);
});
test('model/profile/account changes miss exact cache and direct adapters remain cold',async()=>{
 const cache=createDecisionCache(),p=provider(),input={text:'a latte',order:createOrder()};await adapter(cache,p).interpretTurn(input);
 for(const options of [{apiKey:'fake-key-b'},{model:'other/model'},{questionProfile:'lean-v9'}]){const before=p.calls.length;const result=await adapter(cache,p,options).interpretTurn(input);assert.equal(result.metrics.cacheHits,0);assert.equal(p.calls.length-before,3);}
 const cold=await adapter(null,p).interpretTurn(input);assert.equal(cold.metrics.cacheHits,undefined);assert.equal(cold.metrics.totalRequests,3);
});
test('TTL expiration and returned-command mutation cannot change later valid answers',async()=>{
 let now=0;const cache=createDecisionCache({clock:()=>now,ttlMs:10}),p=provider(),a=adapter(cache,p),input={text:'a latte',order:createOrder()};const first=await a.interpretTurn(input);first.commands[0].identity='mutated';const warm=await a.interpretTurn(input);assert.equal(warm.commands[0].identity,identity);now=10;const expired=await a.interpretTurn(input);assert.equal(expired.metrics.cacheHits,0);assert.equal(expired.metrics.totalRequests,3);
});
test('hits are revalidated by the existing strict decision path',async()=>{
 const real=createDecisionCache(),p=provider(),a=adapter(real,p),input={text:'a latte',order:createOrder()};await a.interpretTurn(input);const bad={keyFor:real.keyFor,set:real.set,get:key=>{const value=real.get(key);if(value?.answers?.identity)value.answers.identity.probabilities={};return value;}};await assert.rejects(()=>adapter(bad,p).interpretTurn(input),/Invalid decision probabilities/);
});
test('cancellation after async cache key prevents hit or provider dispatch',async()=>{
 const controller=new AbortController(),real=createDecisionCache(),p=provider(),cache={keyFor:async(...args)=>{const key=await real.keyFor(...args);controller.abort();return key;},get:()=>assert.fail('must not read hit'),set:real.set};await assert.rejects(()=>adapter(cache,p).interpretTurn({text:'a latte',order:createOrder()},{signal:controller.signal}),{name:'AbortError'});assert.equal(p.calls.length,1);
});
test('detail target quantity/source context changes cannot reuse earlier validated answers',async()=>{
 const cache=createDecisionCache(),p=provider({operation:'update'}),a=adapter(cache,p),makeOrder=quantity=>applyCommands(createOrder(),[{type:'add-menu',identity,quantity}]);const text='make the first item one copy',first={text,order:makeOrder(3)};const cold=await a.interpretTurn(first),warm=await a.interpretTurn(first),changed=await a.interpretTurn({text,order:makeOrder(4)});assert.equal(cold.metrics.cacheHits,0);assert.equal(warm.metrics.cacheHits,1);assert.equal(warm.metrics.totalRequests,1);assert.equal(changed.metrics.cacheHits,0);assert.equal(changed.metrics.totalRequests,2);assert.equal(changed.commands[0].changes.quantity,1);
});
test('concurrent cold misses share pure identity work, keep routing live, and isolate cancellation',async()=>{
 const real=createDecisionCache(),p=provider(),base=p.fetchImpl,controller=new AbortController();
 let enterIdentity,releaseIdentity,joinIdentity,identitySignal,identityKeys=0;
 const entered=new Promise(resolve=>{enterIdentity=resolve;}),blocked=new Promise(resolve=>{releaseIdentity=resolve;}),joined=new Promise(resolve=>{joinIdentity=resolve;});
 const cache={get:real.get,set:real.set,keyFor:async(context,options)=>{const key=await real.keyFor(context,options);if(JSON.parse(context.body).questions.identity&&++identityKeys===2)joinIdentity();return key;}};
 p.fetchImpl=async(url,init)=>{const response=await base(url,init);if(JSON.parse(init.body).questions.identity){identitySignal=init.signal;enterIdentity();await blocked;}return response;};
 const a=adapter(cache,p),input={text:'a latte',order:createOrder()};
 const owner=a.interpretTurn(input,{signal:controller.signal}),cancelled=assert.rejects(owner,{name:'AbortError'});await entered;
 const survivor=a.interpretTurn(input);await joined;await new Promise(resolve=>setImmediate(resolve));
 controller.abort();await cancelled;assert.equal(identitySignal.aborted,false);releaseIdentity();
 const result=await survivor;
 assert.equal(result.commands[0].identity,identity);assert.equal(result.metrics.totalRequests,2);assert.equal(result.metrics.inflightHits,1);assert.equal(result.metrics.cacheHits,0);
 assert.equal(p.calls.filter(call=>Object.hasOwn(call.questions,'coverage')).length,2);
 assert.equal(p.calls.filter(call=>Object.hasOwn(call.questions,'identity')).length,1);
 assert.equal(p.calls.filter(call=>Object.hasOwn(call.questions,'quantity')).length,1);
 assert.equal(p.calls.length,4);assert.equal(real.stats().entries,2);
});
test('an already-aborted turn cannot dispatch even a main routing request',async()=>{
 const controller=new AbortController();controller.abort();const p=provider(),a=adapter(createDecisionCache(),p);await assert.rejects(()=>a.interpretTurn({text:'a latte',order:createOrder()},{signal:controller.signal}),{name:'AbortError'});assert.equal(p.calls.length,0);
});
