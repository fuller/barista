import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretInput} from '../src/application/turns.mjs';
import {createLiveFixtureHandler} from './live-fixture.mjs';
import {createOrder,applyCommands} from '../src/domain/order.mjs';
const pendingFor=(order,originalText='make the first latte half sweet')=>({originalText,question:'Should I use half sweet or an exact pump count?',revision:order.revision,answers:[],targetIds:order.items.map(i=>i.id)});
test('cancel clears stale pending before replay validation',async()=>{
 const order=createOrder();const pending={...pendingFor(order),revision:99,targetIds:['removed-drink']};
 const result=await interpretInput({text:'cancel',order,pending},{interpretTurn:async()=>assert.fail('cancel must not dispatch')});
 assert.equal(result.pending,null);assert.equal(result.clarificationMode,'retry');
});
test('pump slot correction retains original target and typed correction context',async()=>{
 const order=createOrder();const pending=pendingFor(order);let seen;
 await interpretInput({text:'two pumps',order,pending},{interpretTurn:async input=>{seen=input;return {commands:[],clarification:null,source:'test'};}});
 assert.ok(seen.text.includes(pending.originalText));assert.match(seen.text,/Correction.*two pumps/);
 assert.deepEqual(seen.clarificationContext,{supersededField:'pumps',originalText:pending.originalText,question:pending.question,answers:['two pumps']});
});
test('unrelated pending answer does not manufacture pump supersession',async()=>{
 const order=createOrder();let seen;await interpretInput({text:'more pumps',order,pending:pendingFor(order)},{interpretTurn:async input=>{seen=input;return {commands:[],clarification:null,source:'test'};}});
 assert.equal(seen.clarificationContext,undefined);
});
test('HTTP boundary preserves raw transcript and ignores client correction context',async()=>{
 const text='  make it purple  ';const body={turnId:'raw',baseRevision:0,text,order:createOrder(),clarificationContext:{supersededField:'pumps',originalText:'attacker',question:'',answers:['two pumps']}};
 const response=await createLiveFixtureHandler()(new Request('https://barista.example/api/turn',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));
 assert.equal(response.status,200);const result=await response.json();assert.equal(result.pending.originalText,text);assert.equal(result.clarificationContext,undefined);
});
test('demo pump correction preserves original first-drink target',async()=>{
 const {createDemoAdapter}=await import('./support/demo.mjs');
 const order=applyCommands(createOrder(),[{type:'add',productId:'latte',changes:{syrup:'vanilla'}},{type:'add',productId:'mocha'}]);
 const result=await interpretInput({text:'two pumps',order,activeItemId:order.items[1].id,pending:pendingFor(order)},createDemoAdapter());
 assert.equal(result.clarification,null);assert.equal(result.commands[0].itemId,order.items[0].id);assert.equal(result.commands[0].changes.pumps,2);
});
test('demo same-utterance half and exact pumps still clarifies',async()=>{
 const {createDemoAdapter}=await import('./support/demo.mjs');
 const order=applyCommands(createOrder(),[{type:'add',productId:'latte',changes:{syrup:'vanilla'}}]);
 const result=await interpretInput({text:'make the first latte half sweet with two pumps',order},createDemoAdapter());
 assert.ok(result.clarification);assert.deepEqual(result.commands,[]);
});

test('raw whitespace does not block explicit restart or cancellation',async()=>{
 const order=createOrder();const pending=pendingFor(order);let seen;
 await interpretInput({text:'  add a latte  ',order,pending},{interpretTurn:async input=>{seen=input;return {commands:[],clarification:null,source:'test'};}});
 assert.equal(seen.text,'  add a latte  ');assert.equal(seen.clarificationContext,undefined);
 const result=await interpretInput({text:'  cancel  ',order,pending},{interpretTurn:async()=>assert.fail('cancel must not dispatch')});assert.equal(result.pending,null);
});
