import test from 'node:test';
import assert from 'node:assert/strict';
import {createOrder,applyCommands} from '../src/domain/order.mjs';
import {parseDemoTurn} from './support/coffee-language.mjs';
import {createDemoAdapter} from './support/demo.mjs';

const adapter=createDemoAdapter();
const cart=(productId='latte',changes={})=>applyCommands(createOrder(),[{type:'add',productId,changes}]);
async function turn(order,text){
 const result=await adapter.interpretTurn({order,text});
 assert.equal(result.clarification,null);
 return applyCommands(order,result.commands);
}

for(const text of [
 'Make it hot and iced',
 'Make it oat and almond milk',
 'Make it three shots and four shots',
 'Make it light ice and extra ice',
 'Make it half caf and decaf',
 'Make it blonde and signature espresso',
 'Make it warm and extra hot',
 'Make it light milk and extra milk',
 'Make it dry and wet',
 'Make it in a tall cup and a venti cup',
])test(`contradictory demo request clarifies atomically: ${text}`,async()=>{
 const order=cart('latte',{temperature:'iced'}),before=structuredClone(order);
 const result=await adapter.interpretTurn({order,text});
 assert.deepEqual(result.commands,[]);
 assert.ok(result.clarification);
 assert.deepEqual(order,before);
});

test('equivalent repeated modifiers remain supported',async()=>{
 const next=await turn(cart(),'Make it skim and nonfat milk');
 assert.equal(next.items[0].milk,'skim');
});

test('on-side additions preserve earlier independent selections',async()=>{
 let order=cart('latte',{temperature:'iced'});
 order=await turn(order,'Milk on the side');
 order=await turn(order,'Ice on the side');
 assert.deepEqual(order.items[0].onSide,['milk','ice']);
 order=await turn(order,'Milk on the side');
 assert.deepEqual(order.items[0].onSide,['milk','ice']);
});

test('explicit recipe-equal sauce quantity survives resize through demo',async()=>{
 let order=cart('mocha');
 order=await turn(order,'Make it four pumps mocha sauce');
 order=await turn(order,'Make it venti');
 assert.deepEqual(order.items[0].sauces,[{id:'mocha',quantity:4}]);
});

test('canonical sauce addition touches only the mentioned ingredient',async()=>{
 const order=cart('mocha');
 const result=parseDemoTurn({order,text:'Add two pumps white mocha sauce'});
 assert.deepEqual(result.commands[0].touched,['sauces:white-mocha']);
 const next=await turn(await turn(order,'Add two pumps white mocha sauce'),'Make it venti');
 assert.deepEqual(next.items[0].sauces,[{id:'mocha',quantity:5},{id:'white-mocha',quantity:2}]);
});

test('recipe-equal topping amount is explicit without touching unrelated toppings',()=>{
 const order=cart('mocha',{toppings:[{id:'whipped-cream',amount:'regular'},{id:'cinnamon',amount:'extra'}]});
 const result=parseDemoTurn({order,text:'Make it regular whipped cream and extra room'});
 assert.deepEqual(result.commands[0].touched,['toppings:whipped-cream']);
 assert.deepEqual(result.commands[0].changes.toppings,[{id:'whipped-cream',amount:'regular'},{id:'cinnamon',amount:'extra'}]);
});

test('clearing sauces touches the removed ingredients only',()=>{
 const result=parseDemoTurn({order:cart('mocha'),text:'Make it no sauce'});
 assert.deepEqual(result.commands[0].touched,['sauces:mocha']);
 assert.deepEqual(result.commands[0].changes.sauces,[]);
});

test('replacement touches both named ingredients and preserves unrelated quantities',()=>{
 const order=cart('latte',{syrups:[{id:'vanilla',quantity:2},{id:'hazelnut',quantity:1}]});
 const result=parseDemoTurn({order,text:'Replace vanilla syrup with caramel syrup'});
 assert.deepEqual(result.commands[0].touched,['syrups:vanilla','syrups:caramel']);
 assert.deepEqual(result.commands[0].changes.syrups,[{id:'hazelnut',quantity:1},{id:'caramel',quantity:2}]);
});
