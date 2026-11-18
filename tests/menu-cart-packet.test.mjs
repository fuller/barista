import test from 'node:test';
import assert from 'node:assert/strict';
import {compactMenuCart} from '../src/adapters/menu-cart-packet.mjs';
const columns=['id','name','identity','size','quantity','instructions'];
test('columnar cart round trips every field, ordinal and literal note',()=>{
 const cart=Array.from({length:20},(_,i)=>({id:`menu-${i+1}`,name:'Caffè Latte ☕',identity:'407:Hot',size:i%2?'Grande':null,quantity:i+1,instructions:['oat milk','then whole milk','oat milk']}));
 const before=structuredClone(cart),packet=compactMenuCart(cart);
 assert.deepEqual(packet.columns,columns);
 assert.deepEqual(packet.rows.map(row=>Object.fromEntries(columns.map((key,i)=>[key,row[i]]))),cart);
 assert.ok(JSON.stringify(packet).length<JSON.stringify(cart).length);
 packet.rows[0][5].push('extra');assert.deepEqual(cart,before);
});
test('small carts retain smaller ordinary JSON shape',()=>{
 for(const cart of [[],[{id:'menu-1',name:'Latte',identity:'407:Hot',size:null,quantity:1,instructions:[]}]]){
  assert.deepEqual(compactMenuCart(cart),cart);
  assert.notEqual(compactMenuCart(cart),cart);
 }
});
