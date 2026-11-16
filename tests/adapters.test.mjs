import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDemoAdapter} from './support/demo.mjs';
import {createMenuDeciderAdapter} from '../src/adapters/menu-decider.mjs';
import {createRegistry} from '../src/adapters/registry.mjs';
import {createOrder,applyCommands} from '../src/domain/order.mjs';
const empty=createOrder();
const order=applyCommands(empty,[{type:'add',productId:'latte',changes:{temperature:'iced',milk:'oat',syrups:[{id:'vanilla',quantity:4}]}}]);
const demo=createDemoAdapter();
for (const [text,expected] of [['a grande iced latte with oat milk',{type:'add',productId:'latte',changes:{size:'grande',temperature:'iced',milk:'oat'}}],['make that venti',{type:'update',itemId:'drink-1',changes:{size:'venti'}}],['make the first one decaf',{type:'update',itemId:'drink-1',changes:{decaf:true}}],['add another but hot',{type:'duplicate',itemId:'drink-1',changes:{temperature:'hot'}}],['remove the first drink',{type:'remove',itemId:'drink-1'}],['undo',{type:'undo'}],['that is all',{type:'confirm'}]]) {
 test('demo command: '+text,async()=>{const r=await demo.interpretTurn({text,order});assert.deepEqual(r.commands,[expected]);assert.equal(r.source,'demo');});
}
for(const text of ['half sweet','latte with dragonfruit','a hot cold brew','two lattes one hot one iced','make it purple']) test('demo clarifies '+text,async()=>{const r=await demo.interpretTurn({text,order});assert.equal(r.commands.length,0);assert.ok(r.clarification);});
test('demo does not edit an empty cart',async()=>{assert.ok((await demo.interpretTurn({text:'make that hot',order:empty})).clarification);});
test('registry swaps adapters without order or UI changes',async()=>{const registry=createRegistry({alternate:()=>({interpretTurn:async()=>({commands:[{type:'undo'}],clarification:null,source:'alternate'})})});const a=registry.resolve('alternate',{});assert.equal((await a.interpretTurn({text:'x',order})).source,'alternate');assert.throws(()=>registry.resolve('missing',{}));});
test('live adapter requires key and never silently uses demo',()=>{assert.throws(()=>createMenuDeciderAdapter({apiKey:''}),/configured/i);});
test('live adapter rejects unknown choices',async()=>{const a=createMenuDeciderAdapter({apiKey:'test-key',fetchImpl:async()=>Response.json({answers:{action:{type:'choice',choice:'purchase',probabilities:{purchase:1}}}})});await assert.rejects(()=>a.interpretTurn({text:'latte',order:empty}),/answer|choice|decision|extract/i);});
test('provider failure never leaks its response or secret',async()=>{const a=createMenuDeciderAdapter({apiKey:'secret-value',fetchImpl:async()=>new Response('secret-value private upstream failure',{status:429})});await assert.rejects(()=>a.interpretTurn({text:'latte',order:empty}),e=>!e.message.includes('secret-value')&&e.message.includes('429'));});
test('live adapter honors abort',async()=>{const c=new AbortController();c.abort();const a=createMenuDeciderAdapter({apiKey:'x',fetchImpl:async()=>{throw new Error('must not fetch');}});await assert.rejects(()=>a.interpretTurn({text:'latte',order:empty},{signal:c.signal}),e=>e.name==='AbortError');});
test('another shot adds espresso and never duplicates the drink',async()=>{const r=await demo.interpretTurn({text:'add another shot',order});assert.deepEqual(r.commands,[{type:'update',itemId:'drink-1',changes:{shots:3}}]);});
test('add a shot increments current espresso',async()=>{const r=await demo.interpretTurn({text:'add a shot',order});assert.equal(r.commands[0].changes.shots,3);});
