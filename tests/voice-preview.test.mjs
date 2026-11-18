import test from 'node:test';import assert from 'node:assert/strict';
import {buildVoicePreview} from '../src/application/voice-preview.mjs';
import {createOrder,applyCommands} from '../src/domain/order.mjs';
test('model command preview projects a complete hypothetical cart without changing committed state',()=>{
 const order=applyCommands(createOrder(),[{type:'add-menu',identity:'406:Hot'}]),before=structuredClone(order);
 const draft=buildVoicePreview(order,{commands:[{type:'add-menu',identity:'407:Iced',size:'Grande',instructions:['oat milk']}],clarification:null});
 assert.deepEqual(draft.items.map(x=>x.name),['Caffè Americano','Iced Caffè Latte']);assert.equal(draft.items[1].quantity,1);assert.deepEqual(draft.items[1].instructions,['oat milk']);assert.deepEqual(order,before);
});
test('clarifications, invalid plans and empty results never pretend to be a cart preview',()=>{
 const order=createOrder();for(const response of [{commands:[],clarification:'Which?'},{commands:[{type:'add-menu',identity:'unknown'}]},{commands:[{type:'add-menu',identity:'407:Hot'}],clarification:'Which?'},{commands:null},null])assert.equal(buildVoicePreview(order,response),null);
});
test('clear and confirm are previewed without changing real state or history',()=>{
 const order=applyCommands(createOrder(),[{type:'add-menu',identity:'407:Hot'}]),before=structuredClone(order);
 assert.deepEqual(buildVoicePreview(order,{commands:[{type:'clear'}]}).items,[]);
 assert.equal(buildVoicePreview(order,{commands:[{type:'confirm'}]}).confirmed,true);assert.deepEqual(order,before);
});
