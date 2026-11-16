import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoAdapter} from './support/demo.mjs';
import {createOrder,applyCommands} from '../src/domain/order.mjs';
import {defaultCatalogService} from '../src/catalog/service.mjs';
import {quoteOrder} from '../src/domain/pricing.mjs';
const adapter=createDemoAdapter();
const empty=()=>createOrder(defaultCatalogService.version);
for(const [text,products] of [
 ['one cold brew and one americano',['cold-brew','americano']],
 ['one American and one cold brew',['americano','cold-brew']],
 ['one Americana and one cold brew',['americano','cold-brew']],
 ['a latte and a mocha',['latte','mocha']]
])test('independent noun additions: '+text,async()=>{
 const order=empty(),before=structuredClone(order);const result=await adapter.interpretTurn({text,order});
 assert.equal(result.clarification,null);assert.deepEqual(result.commands.map(c=>c.type),['add','add']);assert.deepEqual(result.commands.map(c=>c.productId),products);
 const next=applyCommands(order,result.commands);assert.equal(next.revision,order.revision+1);assert.equal(next.history.length,1);assert.deepEqual(order,before);
 if(products.includes('cold-brew'))assert.equal(quoteOrder(next).subtotalCents,870);
});
test('local milk scopes stay with their own noun order',async()=>{
 const result=await adapter.interpretTurn({text:'one latte with oat milk and one mocha with almond milk',order:empty()});assert.equal(result.clarification,null);
 const next=applyCommands(empty(),result.commands);assert.equal(next.items[0].milk,'oat');assert.equal(next.items[1].milk,'almond');
});
test('ingredient conjunction stays inside its drink before the next noun order',async()=>{
 const result=await adapter.interpretTurn({text:'one latte with vanilla syrup and caramel syrup and one americano',order:empty()});assert.equal(result.clarification,null);
 const next=applyCommands(empty(),result.commands);assert.deepEqual(next.items.map(d=>d.productId),['latte','americano']);assert.deepEqual(next.items[0].syrups.map(i=>i.id),['vanilla','caramel']);assert.deepEqual(next.items[1].syrups,[]);
});
test('single-drink ingredient conjunction remains one addition',async()=>{
 const result=await adapter.interpretTurn({text:'one latte with vanilla syrup and caramel syrup',order:empty()});assert.equal(result.clarification,null);assert.equal(result.commands.length,1);assert.equal(result.commands[0].productId,'latte');
});
for(const text of ['one cold brew and one americano both iced','one cold brew and one americano with shared oat milk','one cold brew and remove the first','one American style and one cold brew','one Americana with purple milk and one cold brew','one Americanized and one cold brew','one cold brew and one americano or one mocha','one cold brew and another americano'])test('ambiguous or unsupported compound rejects atomically: '+text,async()=>{
 const order=empty(),before=structuredClone(order);const result=await adapter.interpretTurn({text,order});assert.deepEqual(result.commands,[]);assert.ok(result.clarification);assert.deepEqual(order,before);
});
test('unsupported later format returns no earlier addition',async()=>{
 const order=empty(),before=structuredClone(order);const result=await adapter.interpretTurn({text:'one cold brew and one blended americano',order});assert.deepEqual(result.commands,[]);assert.ok(result.clarification);assert.deepEqual(order,before);
});
test('six additions accepted; seven rejected without mutation',async()=>{
 for(const count of [6,7]){const order=empty();const result=await adapter.interpretTurn({text:Array(count).fill('one latte').join(' and '),order});if(count===6){assert.equal(result.clarification,null);assert.equal(result.commands.length,6);}else{assert.deepEqual(result.commands,[]);assert.ok(result.clarification);}assert.equal(order.items.length,0);}
});
test('introduced ingredient count is not a second drink',async()=>{
 const result=await adapter.interpretTurn({text:'one latte with one pump vanilla syrup and one mocha sauce',order:empty()});assert.equal(result.clarification,null);assert.equal(result.commands.length,1);const next=applyCommands(empty(),result.commands);assert.equal(next.items[0].productId,'latte');assert.deepEqual(next.items[0].sauces,[{id:'mocha',quantity:1}]);
});
for(const text of ['one latte with oat milk for the drinks and one mocha','one latte with oat milk for the order and one mocha'])test('relational compound scope rejects atomically: '+text,async()=>{
 const order=empty(),before=structuredClone(order);const result=await adapter.interpretTurn({text,order});assert.deepEqual(result.commands,[]);assert.ok(result.clarification);assert.deepEqual(order,before);
});
