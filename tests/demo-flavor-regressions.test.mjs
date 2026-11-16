import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoAdapter} from './support/demo.mjs';
import {normalize,parseDemoTurn} from './support/coffee-language.mjs';
import {createOrder,applyCommands} from '../src/domain/order.mjs';
import {getDefaults} from '../src/domain/catalog.mjs';
import {defaultCatalogService} from '../src/catalog/service.mjs';

const adapter=createDemoAdapter();
const empty=()=>createOrder(defaultCatalogService.version);
const cart=(productId,changes={})=>applyCommands(empty(),[{type:'add',productId,changes}]);
async function interpret(text,order=empty()){
 const result=await adapter.interpretTurn({text,order});
 assert.equal(result.clarification,null);
 return {result,next:applyCommands(order,result.commands)};
}

test('shaken espresso selects its source product before generic espresso',async()=>{
 const defaults=getDefaults('shaken-espresso',undefined,undefined,defaultCatalogService.version);
 const {result,next}=await interpret('A shaken espresso');
 assert.equal(result.commands[0].productId,'shaken-espresso');
 assert.equal(Object.hasOwn(result.commands[0].changes,'preparation'),false);
 assert.equal(next.items[0].temperature,defaults.temperature);
 assert.equal(next.items[0].shots,defaults.shots);
 assert.deepEqual(next.items[0].syrups,defaults.syrups);
 const espresso=await interpret('An espresso');
 assert.equal(espresso.next.items[0].productId,'espresso');
});

for(const [text,quantity,size,extraShots] of [
 ['Add two shaken espresso',2,'grande',0],
 ['Add 3 tall shaken espresso with an extra shot',3,'tall',1]
])test(`explicit new-drink quantity remains attached to the shaken espresso: ${text}`,async()=>{
 const order=cart('cold-brew'),before=structuredClone(order);
 const defaults=getDefaults('shaken-espresso',size,undefined,order.catalogVersion);
 const {result,next}=await interpret(text,order);
 assert.equal(result.commands[0].productId,'shaken-espresso');
 assert.equal(result.commands[0].changes.quantity,quantity);
 assert.equal(next.items.length,2);
 assert.deepEqual(next.items[0],before.items[0]);
 assert.equal(next.items[1].quantity,quantity);
 assert.equal(next.items[1].shots,defaults.shots+extraShots);
 assert.deepEqual(next.items[1].syrups,defaults.syrups);
 assert.deepEqual(order,before);
});

test('compound additions containing shaken espresso clarify without dropping another drink',async()=>{
 const order=cart('cold-brew'),before=structuredClone(order);
 for(const text of [
  'Add a latte and a shaken espresso',
  'Add a latte and a shaken espresso with half the flavor'
 ]){
  const result=parseDemoTurn({text,order});
  assert.deepEqual(result.commands,[]);
  assert.ok(result.clarification);
  assert.deepEqual(order,before);
 }
});

test('trenti resolves to the supported Trenta size without changing transcript normalization',async()=>{
 const text='One trenti cold brew';
 const input={text,order:empty()};
 const before=structuredClone(input);
 const result=parseDemoTurn(input);
 assert.deepEqual(result.commands,[{type:'add',productId:'cold-brew',changes:{size:'trenta'}}]);
 assert.deepEqual(input,before);
 assert.equal(normalize(text),'one trenti cold brew');
 const {next}=await interpret(text);
 assert.equal(next.items[0].size,'trenta');
});

test('trenti supports size edits and equivalent spelling while conflicting sizes clarify',async()=>{
 const order=cart('cold-brew');
 const {next}=await interpret('Make it trenti',order);
 assert.equal(next.items[0].size,'trenta');
 const repeated=await interpret('A trenti trenta cold brew');
 assert.equal(repeated.next.items[0].size,'trenta');
 for(const text of ['A trenti venti cold brew','A trenti latte']){
  const result=await adapter.interpretTurn({text,order});
  assert.deepEqual(result.commands,[]);
  assert.ok(result.clarification);
 }
});

for(const size of ['tall','grande','venti'])test(`half the flavor uses the ${size} shaken espresso recipe`,async()=>{
 const defaults=getDefaults('shaken-espresso',size,undefined,defaultCatalogService.version);
 const included=defaults.syrups[0];
 const {result,next}=await interpret(`A ${size} shaken espresso with half the flavor`);
 assert.deepEqual(next.items[0].syrups,[{id:included.id,quantity:Math.round(included.quantity/2)}]);
 assert.equal(next.items[0].shots,defaults.shots);
 assert.deepEqual(result.commands[0].touched,[`syrups:${included.id}`]);
});

test('half the flavor uses the prospective size recipe and persists explicit quantity on resize',async()=>{
 const order=cart('mocha',{size:'tall'});
 const defaults=getDefaults('mocha','venti',undefined,order.catalogVersion);
 const included=defaults.sauces[0];
 const {result,next}=await interpret('Make it venti with half the flavor',order);
 assert.deepEqual(next.items[0].sauces,[{id:included.id,quantity:Math.round(included.quantity/2)}]);
 assert.deepEqual(result.commands[0].touched,[`sauces:${included.id}`]);
 const resized=await interpret('Make it grande',next);
 assert.deepEqual(resized.next.items[0].sauces,next.items[0].sauces);
 assert.deepEqual(applyCommands(next,[{type:'undo'}]).items,order.items);
});

test('half the flavor respects an explicitly changed current ingredient quantity',async()=>{
 const order=cart('mocha',{sauces:[{id:'mocha',quantity:6}]});
 const {next}=await interpret('Make it venti with half the flavor',order);
 assert.deepEqual(next.items[0].sauces,[{id:'mocha',quantity:3}]);
});

test('ambiguous or absent flavor clarifies atomically without inventing an ingredient',async()=>{
 for(const order of [
  cart('latte'),
  cart('mocha',{syrups:[{id:'vanilla',quantity:2}]}),
  cart('latte',{syrups:[{id:'vanilla',quantity:2},{id:'classic',quantity:2}]})
 ]){
  const before=structuredClone(order);
  const result=await adapter.interpretTurn({text:'Make it venti with half the flavor',order});
  assert.deepEqual(result.commands,[]);
  assert.ok(result.clarification);
  assert.deepEqual(order,before);
 }
 const add=await adapter.interpretTurn({text:'A latte with half the flavor',order:empty()});
 assert.deepEqual(add.commands,[]);
 assert.ok(add.clarification);
});

test('half the flavor plus a competing flavor instruction clarifies atomically',async()=>{
 const order=cart('shaken-espresso'),before=structuredClone(order);
 for(const text of [
  'Make it half the flavor with four pumps',
  'Make it half the flavor with two pumps vanilla syrup',
  'Make it half the flavor and no syrup'
 ]){
  const result=await adapter.interpretTurn({text,order});
  assert.deepEqual(result.commands,[]);
  assert.ok(result.clarification);
  assert.deepEqual(order,before);
 }
});
