import test from 'node:test';
import assert from 'node:assert/strict';
import {createOrder,applyCommands} from '../src/domain/order.mjs';
import {diffOrder} from '../src/ui/order-diff.mjs';

const add=()=>applyCommands(createOrder(),[{type:'add',productId:'latte'},{type:'add',productId:'mocha'}]);
test('diff isolates changed fields and ingredients from untouched drinks',()=>{
 const before=add();
 const after=applyCommands(before,[{type:'update',itemId:'drink-1',changes:{shots:3,syrups:[{id:'vanilla',quantity:2}]}}]);
 assert.deepEqual(diffOrder(before,after),{added:[],removed:[],updated:[{id:'drink-1',fields:['shots'],ingredients:['syrups:vanilla']}]});
});
test('diff reports stable add and remove identities',()=>{
 const before=add();
 const after=applyCommands(before,[{type:'remove',itemId:'drink-1'},{type:'add',productId:'americano'}]);
 assert.deepEqual(diffOrder(before,after),{added:['drink-3'],removed:['drink-1'],updated:[]});
});
test('no-op metadata and reordered ingredients do not animate',()=>{
 const before=applyCommands(createOrder(),[{type:'add',productId:'latte',changes:{syrups:[{id:'vanilla',quantity:2},{id:'caramel',quantity:1}]}}]);
 const after=structuredClone(before);after.revision++;after.items[0].explicit.push('shots');after.items[0].syrups.reverse();
 assert.deepEqual(diffOrder(before,after),{added:[],removed:[],updated:[]});
});
test('undo reports restored quantity rather than stale forward changes',()=>{
 const before=add();
 const changed=applyCommands(before,[{type:'update',itemId:'drink-1',changes:{quantity:2}}]);
 const undone=applyCommands(changed,[{type:'undo'}]);
 assert.deepEqual(diffOrder(changed,undone),{added:[],removed:[],updated:[{id:'drink-1',fields:['quantity'],ingredients:[]}]});
});
test('rapid edits diff each committed state independently',()=>{
 const before=add();
 const first=applyCommands(before,[{type:'update',itemId:'drink-1',changes:{shots:3}}]);
 const last=applyCommands(first,[{type:'update',itemId:'drink-1',changes:{shots:4}}]);
 assert.deepEqual(diffOrder(first,last).updated,[{id:'drink-1',fields:['shots'],ingredients:[]}]);
 assert.deepEqual(last.items.map(i=>i.shots),[4,2]);
});
