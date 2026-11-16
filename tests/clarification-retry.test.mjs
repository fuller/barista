import {test} from 'node:test';
import assert from 'node:assert/strict';
import {interpretInput} from '../src/application/turns.mjs';
import {createOrder} from '../src/domain/order.mjs';
import {createMenuDeciderAdapter} from '../src/adapters/menu-decider.mjs';
test('a rephrase clarification does not trap the next plain order in the failed transcript',async()=>{
 const order=createOrder();const seen=[];
 const adapter={interpretTurn:async({text})=>{seen.push(text);return seen.length===1?{commands:[],clarification:'Please say one drink at a time.',clarificationMode:'retry',source:'test'}:{commands:[{type:'add',productId:'latte'}],clarification:null,source:'test'};}};
 const first=await interpretInput({text:'an unsupported drink and another',order},adapter);
 assert.equal(first.pending,null);
 const second=await interpretInput({text:'a latte',order,pending:first.pending},adapter);
 assert.deepEqual(seen,['an unsupported drink and another','a latte']);assert.equal(second.commands[0].productId,'latte');
});
test('an actual slot question retains its original request for the answer',async()=>{
 const order=createOrder();let seen;
 const pending={originalText:'a latte',question:'Which size?',revision:0,answers:[],targetIds:[]};
 await interpretInput({text:'grande',order,pending},{interpretTurn:async input=>{seen=input.text;return {commands:[],clarification:null,source:'test'};}});
 assert.equal(seen,'a latte  grande');
});
test('a low confidence coverage answer requests a fresh utterance rather than sticky replay',async()=>{
 const adapter=createMenuDeciderAdapter({apiKey:'test',fetchImpl:async(_url,init)=>{const q=JSON.parse(init.body).questions;return Response.json({answers:Object.fromEntries(Object.entries(q).map(([key,spec])=>{const keys=Object.keys(spec.criteria);const selected=key==='supported'?'unsupported':key==='action'?'add':keys[0];return [key,{type:'choice',choice:selected,probabilities:Object.fromEntries(keys.map(k=>[k,k===selected?1:0]))}];}))});}});
 const result=await interpretInput({text:'a latte',order:createOrder()},adapter);assert.ok(result.clarification);assert.equal(result.pending,null);
});
test('cancelled slot reply clears pending without calling adapter',async()=>{
 const order=createOrder();const pending={originalText:'a latte',question:'Which size?',revision:0,answers:[],targetIds:[]};
 const result=await interpretInput({text:'cancel',order,pending},{interpretTurn:async()=>assert.fail('cancel must not dispatch')});
 assert.equal(result.pending,null);assert.equal(result.clarificationMode,'retry');assert.equal(result.diagnostics.stage,'conversation');
});
test('stale slot reply cannot dispatch or commit',async()=>{
 const order=createOrder();const pending={originalText:'a latte',question:'Which size?',revision:1,answers:[],targetIds:[]};
 await assert.rejects(()=>interpretInput({text:'grande',order,pending},{interpretTurn:async()=>assert.fail('stale reply must not dispatch')}),error=>error.status===409);
 assert.equal(order.items.length,0);
});
