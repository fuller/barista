import test from 'node:test';import assert from 'node:assert/strict';
import {buildBeverageSchedulingHint} from '../src/adapters/menu-identity.mjs';
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
  const chosen={identity,coverage:'complete',action:operation,productGroup:operation==='add'?group:'unchanged',target:operation==='add'?'none':target,replacementRequested:'absent',targetScope:'item',sizeRequested:'absent',size:'unchanged',quantityRequested:operation==='add'?'absent':'requested',quantity:'1',b0:'continue'};
  const answers=Object.fromEntries(Object.entries(body.questions).map(([key,q])=>{const selected=chosen[key]??'continue';assert.ok(Object.hasOwn(q.criteria,selected),key+': '+selected);const probability=pure&&failure==='low'?.6:.99;return [key,{type:'choice',choice:selected,probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k===selected?probability:(1-probability)/(Object.keys(q.criteria).length-1)]))}];}));
  if(pure&&failure==='refusal')answers[keys[0]]={type:'refusal'};
  if(kind==='detail'&&failure==='retry')answers.quantity={type:'choice',choice:'unclear',probabilities:Object.fromEntries(Object.keys(body.questions.quantity.criteria).map(k=>[k,k==='unclear'?.99:.01/(Object.keys(body.questions.quantity.criteria).length-1)]))};
  return Response.json({...((pure&&failure==='truncated')?{truncated:true}:{}),answers:(pure&&failure==='schema')?{}:answers});
 };return {calls,fetchImpl};
}
const adapter=(cache,p,options={})=>createMenuDeciderAdapter({apiKey:'fake-key-a',questionProfile:'lean-v8',fetchImpl:p.fetchImpl,cache,...options});

test('guarded identity and core overlap behind a barrier; selected packet bytes match sequential',async()=>{
 const baseline=provider(),input={text:'a latte',order:createOrder()};await adapter(null,baseline).interpretTurn(input);
 const p=provider(),base=p.fetchImpl;let core=false,leaf=false,release;const barrier=new Promise(resolve=>release=resolve);
 p.fetchImpl=async(url,init)=>{const body=JSON.parse(init.body);if(body.questions.coverage)core=true;if(body.questions.identity)leaf=true;if(core&&leaf)release();if(body.questions.coverage||body.questions.identity)await barrier;return base(url,init);};
 const result=await adapter(null,p,{scheduling:'guarded-overlap'}).interpretTurn(input);
 assert.equal(result.commands[0].identity,identity);assert.equal(result.metrics.totalRequests,3);assert.ok(core&&leaf);
 assert.equal(JSON.stringify(p.calls.find(b=>b.questions.identity)),JSON.stringify(baseline.calls.find(b=>b.questions.identity)));
});
test('warm overlap uses cache without extra wire requests or duplicate admissions',async()=>{
 const cache=createDecisionCache(),p=provider(),a=adapter(cache,p,{scheduling:'guarded-overlap'}),input={text:'latte',order:createOrder()};
 const cold=await a.interpretTurn(input),warm=await a.interpretTurn(input);assert.deepEqual(cold.commands,warm.commands);assert.equal(cold.metrics.totalRequests,3);assert.equal(warm.metrics.totalRequests,1);assert.equal(warm.metrics.cacheHits,2);assert.equal(cache.stats().entries,2);
});
test('unused identity rejection cannot poison core clarification or enter cache',async()=>{
 const cache=createDecisionCache(),p=provider(),base=p.fetchImpl;let release;const leafStarted=new Promise(resolve=>release=resolve);
 p.fetchImpl=async(url,init)=>{const body=JSON.parse(init.body);if(body.questions.identity){release();throw new Error('unused failure');}if(body.questions.coverage)await leafStarted;const response=await base(url,init),decoded=await response.json();if(body.questions.coverage){const q=body.questions.coverage;decoded.answers.coverage={type:'choice',choice:'unclear',probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k==='unclear'?.99:.01]))};}return Response.json(decoded);};
 const result=await adapter(cache,p,{scheduling:'guarded-overlap'}).interpretTurn({text:'latte',order:createOrder()});assert.equal(result.commands.length,0);assert.equal(result.metrics.totalRequests,2);assert.equal(cache.stats().entries,0);
});
test('selected identity failure remains original provider error with actual wire count',async()=>{
 const p=provider(),base=p.fetchImpl;p.fetchImpl=async(url,init)=>JSON.parse(init.body).questions.identity?new Response('',{status:429}):base(url,init);
 await assert.rejects(()=>adapter(null,p,{scheduling:'guarded-overlap'}).interpretTurn({text:'latte',order:createOrder()}),error=>error.message.includes('(429)')&&error.metrics.totalRequests===2);
});
test('turn abort cancels both independent core and identity requests',async()=>{
 const controller=new AbortController(),seen=[];
 const p={fetchImpl:async(_url,init)=>{seen.push(Object.keys(JSON.parse(init.body).questions)[0]);if(seen.length===2)queueMicrotask(()=>controller.abort());return new Promise((resolve,reject)=>{init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true});if(init.signal.aborted)reject(init.signal.reason);});}};
 await assert.rejects(()=>adapter(null,p,{scheduling:'guarded-overlap'}).interpretTurn({text:'latte',order:createOrder()},{signal:controller.signal}),{name:'AbortError'});assert.equal(seen.length,2);
});
test('eligibility is catalog-only scheduling with first-clause, empty-cart and strict capacity guards',()=>{
 const hint=buildBeverageSchedulingHint(directory.products,buildMenuIdentityGroups(directory.products)),base={text:'latte',clauseIndex:0,initiallyEmpty:true,draftEmpty:true,requests:1,remainingClauses:6};assert.ok(hint(base));
 for(const patch of [{clauseIndex:1},{initiallyEmpty:false},{draftEmpty:false},{requests:2},{text:'croissant'},{text:'coffee'}])assert.equal(hint({...base,...patch}),null);
});
test('scheduling must be explicitly valid',()=>assert.throws(()=>adapter(null,provider(),{scheduling:'guess'}),/Invalid decision scheduling/));
test('non-Beverage selection ignores successful speculative identity and never admits it',async()=>{
 const cache=createDecisionCache(),p=provider(),base=p.fetchImpl,food=directory.products.find(p=>p.productType==='Food'),foodGroup=buildMenuIdentityGroups(directory.products).find(g=>g.products.some(p=>p.identity===food.identity)).id;let release;const leafStarted=new Promise(resolve=>release=resolve);
 p.fetchImpl=async(url,init)=>{const packet=JSON.parse(init.body);if(packet.questions.identity&&Object.hasOwn(packet.questions.identity.criteria,identity)){release();return base(url,init);}if(packet.questions.coverage)await leafStarted;
 const selected={coverage:'complete',action:'add',productGroup:foodGroup,target:'none',replacementRequested:'absent',targetScope:'item',sizeRequested:'absent',quantityRequested:'absent',identity:food.identity,quantity:'1'};
 return Response.json({answers:Object.fromEntries(Object.entries(packet.questions).map(([key,q])=>[key,{type:'choice',choice:selected[key],probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k===selected[key]?.99:.01/(Object.keys(q.criteria).length-1)]))}]))});};
 const result=await adapter(cache,p,{scheduling:'guarded-overlap'}).interpretTurn({text:'latte pastry',order:createOrder()});assert.equal(result.commands[0].identity,food.identity);assert.equal(result.metrics.totalRequests,4);assert.equal(cache.stats().entries,2);
});
