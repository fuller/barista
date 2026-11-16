import test from 'node:test';
import assert from 'node:assert/strict';
import directory from '../src/catalog/data/starbucks-menu-directory.json' with {type:'json'};
import {createOrder,applyCommands,validateOrder} from '../src/domain/order.mjs';
import {quoteOrder} from '../src/domain/pricing.mjs';
const product=directory.products[0];
const add=(p=product,extra={})=>({type:'add-menu',identity:p.identity,...extra});
test('every directory identity adds as a generic menu line without a fabricated recipe',()=>{
 for(const p of directory.products){const order=applyCommands(createOrder(),[add(p)]);assert.equal(order.items.length,0);assert.deepEqual(order.menuItems,[{id:'menu-1',identity:p.identity,name:p.name,size:null,quantity:1,instructions:[]}]);assert.equal(validateOrder(order),order);}
});
test('all product forms retain exact source size codes',()=>{
 for(const form of new Set(directory.products.map(p=>p.formCode))){const p=directory.products.find(p=>p.formCode===form),size=p.sizes[0].sizeCode;const order=applyCommands(createOrder(),[add(p,{size})]);assert.equal(order.menuItems[0].size,size);}
});
test('food, packaged coffee and beverage lines share monotonic IDs with recipe drinks',()=>{
 const food=directory.products.find(p=>p.productType==='Food'),coffee=directory.products.find(p=>p.productType==='Coffee');const order=applyCommands(createOrder(),[{type:'add',productId:'latte'},add(food),add(coffee)]);assert.equal(order.items[0].id,'drink-1');assert.deepEqual(order.menuItems.map(p=>p.id),['menu-2','menu-3']);assert.equal(order.nextId,4);assert.equal(order.revision,1);assert.equal(order.history.length,1);
});
test('generic quantities and opaque instructions preserve verbatim values',()=>{
 const instructions=['  Please warm it  ','No lid ☕'];const order=applyCommands(createOrder(),[add(product,{quantity:100,instructions})]);assert.deepEqual(order.menuItems[0].instructions,instructions);assert.equal(order.menuItems[0].quantity,100);instructions[0]='mutated';assert.equal(order.menuItems[0].instructions[0],'  Please warm it  ');
});
for(const command of [add(product,{identity:'not-real:Single'}),add(product,{size:'not-a-source-size'}),add(product,{quantity:0}),add(product,{quantity:101}),add(product,{instructions:['   ']}),add(product,{instructions:['x'.repeat(601)]}),add(product,{name:'Spoofed'}),add(product,{instructions:'warm'})])test('invalid menu command fails atomically',()=>{const order=createOrder(),before=structuredClone(order);assert.throws(()=>applyCommands(order,[{type:'add',productId:'latte'},command]));assert.deepEqual(order,before);});
test('menu update, duplicate and removal use the same line target IDs',()=>{
 let order=applyCommands(createOrder(),[add()]);order=applyCommands(order,[{type:'update-menu',itemId:'menu-1',changes:{size:product.sizes[0].sizeCode,quantity:2,instructions:['No lid']}}]);order=applyCommands(order,[{type:'duplicate',itemId:'menu-1',changes:{quantity:3}}]);assert.equal(order.menuItems[1].id,'menu-2');assert.equal(order.menuItems[1].quantity,3);assert.deepEqual(order.menuItems[1].instructions,['No lid']);order=applyCommands(order,[{type:'remove',itemId:'menu-1'}]);assert.deepEqual(order.menuItems.map(p=>p.id),['menu-2']);
});
test('mixed cart clear and undo preserve both arrays in one history entry',()=>{
 const initial=createOrder();const mixed=applyCommands(initial,[{type:'add',productId:'latte'},add()]);const cleared=applyCommands(mixed,[{type:'clear'}]);assert.deepEqual(cleared.items,[]);assert.deepEqual(cleared.menuItems,[]);const restored=applyCommands(cleared,[{type:'undo'}]);assert.deepEqual(restored.items,mixed.items);assert.deepEqual(restored.menuItems,mixed.menuItems);const original=applyCommands(restored,[{type:'undo'}]);assert.deepEqual(original.items,[]);assert.equal(Object.hasOwn(original,'menuItems'),false);assert.equal(original.nextId,3);
});
test('generic-only confirmation works and later changes clear confirmation',()=>{
 const order=applyCommands(createOrder(),[add(),{type:'confirm'}]);assert.equal(order.confirmed,true);const changed=applyCommands(order,[{type:'update-menu',itemId:'menu-1',changes:{quantity:2}}]);assert.equal(changed.confirmed,false);assert.throws(()=>applyCommands(createOrder(),[{type:'confirm'}]));
});
test('combined cart limit is 100 lines and failure returns no partial changes',()=>{
 const order=applyCommands(createOrder(),Array.from({length:100},()=>add()));assert.equal(order.menuItems.length,100);assert.throws(()=>applyCommands(order,[{type:'add',productId:'latte'}]));assert.equal(order.items.length,0);assert.equal(order.menuItems.length,100);
});
test('generic line validation rejects name spoofing, source size spoofing and ID collisions',()=>{
 const mixed=applyCommands(createOrder(),[{type:'add',productId:'latte'},add()]);
 for(const mutate of [o=>{o.menuItems[0].name='Spoofed';},o=>{o.menuItems[0].size='fake';},o=>{o.menuItems[0].identity='unknown';},o=>{o.menuItems[0].id='menu-1';},o=>{o.menuItems[0].instructions=[''];},o=>{o.history[0].menuItems=[{...o.menuItems[0],name:'Spoofed'}];}]){const changed=structuredClone(mixed);mutate(changed);assert.throws(()=>validateOrder(changed));}
});
test('unknown menu prices stay null, count quantities and preserve priced legacy subtotal separately',()=>{
 const order=applyCommands(createOrder(),[{type:'add',productId:'latte'},add(product,{quantity:3})]);const quote=quoteOrder(order);assert.equal(quote.subtotalCents,null);assert.equal(quote.totalCents,null);assert.equal(quote.unpricedItemCount,3);assert.equal(quote.pricedSubtotalCents,525);assert.deepEqual(quote.items.find(i=>i.itemId==='menu-2'),{itemId:'menu-2',quantity:3,unitCents:null,totalCents:null,lines:[]});
 const only=quoteOrder(applyCommands(createOrder(),[add()]));assert.equal(only.subtotalCents,null);assert.equal(only.totalCents,null);assert.equal(only.pricedSubtotalCents,0);
});
test('legacy-only cart and quote retain their existing exact shapes',()=>{
 const order=applyCommands(createOrder(),[{type:'add',productId:'latte'}]);assert.equal(Object.hasOwn(order,'menuItems'),false);assert.equal(Object.hasOwn(order.history[0],'menuItems'),false);const quote=quoteOrder(order);assert.equal(quote.totalCents,525);assert.equal(Object.hasOwn(quote,'unpricedItemCount'),false);assert.equal(Object.hasOwn(quote,'pricedSubtotalCents'),false);
});
test('duplicated menu instructions do not share mutable arrays with their source',()=>{
 const initial=applyCommands(createOrder(),[add(product,{instructions:['No lid']})]);const copied=applyCommands(initial,[{type:'duplicate',itemId:'menu-1'}]);assert.notEqual(copied.menuItems[0].instructions,copied.menuItems[1].instructions);copied.menuItems[1].instructions.push('Warm');assert.deepEqual(copied.menuItems[0].instructions,['No lid']);assert.deepEqual(initial.menuItems[0].instructions,['No lid']);
});
test('menu identity replacement resolves trusted name and preserves instructions/quantity',()=>{
 const first=directory.products.find(p=>p.identity==='406:Hot'),replacement=directory.products.find(p=>p.identity==='407:Hot');
 const before=applyCommands(createOrder(),[add(first,{size:'Grande',quantity:2,instructions:['No lid']})]);const after=applyCommands(before,[{type:'update-menu',itemId:'menu-1',changes:{identity:replacement.identity}}]);
 assert.equal(after.menuItems[0].identity,replacement.identity);assert.equal(after.menuItems[0].name,replacement.name);assert.equal(after.menuItems[0].size,'Grande');assert.equal(after.menuItems[0].quantity,2);assert.deepEqual(after.menuItems[0].instructions,['No lid']);assert.deepEqual(applyCommands(after,[{type:'undo'}]).menuItems,before.menuItems);
});
test('replacement resets an incompatible prior size to source default selection',()=>{
 const drink=directory.products.find(p=>p.identity==='407:Hot'),food=directory.products.find(p=>p.productType==='Food');const before=applyCommands(createOrder(),[add(drink,{size:'Grande'})]);
 const after=applyCommands(before,[{type:'update-menu',itemId:'menu-1',changes:{identity:food.identity}}]);assert.equal(after.menuItems[0].size,null);assert.equal(after.menuItems[0].name,food.name);
});
test('replacement with explicit unsupported size rejects the whole change',()=>{
 const drink=directory.products.find(p=>p.identity==='407:Hot'),food=directory.products.find(p=>p.productType==='Food');const before=applyCommands(createOrder(),[add(drink,{size:'Grande'})]),copy=structuredClone(before);
 assert.throws(()=>applyCommands(before,[{type:'update-menu',itemId:'menu-1',changes:{identity:food.identity,size:'Grande'}}]));assert.deepEqual(before,copy);assert.throws(()=>applyCommands(before,[{type:'update-menu',itemId:'menu-1',changes:{identity:'unknown:Hot'}}]));assert.throws(()=>applyCommands(before,[{type:'update-menu',itemId:'menu-1',changes:{identity:food.identity,name:'Spoof'}}]));
});
test('duplicate can select a new source identity with trusted name and safe size reset',()=>{
 const drink=directory.products.find(p=>p.identity==='407:Hot'),food=directory.products.find(p=>p.productType==='Food');const before=applyCommands(createOrder(),[add(drink,{size:'Grande',instructions:['Warm']})]);const after=applyCommands(before,[{type:'duplicate',itemId:'menu-1',changes:{identity:food.identity,quantity:3}}]);assert.equal(after.menuItems[0].identity,drink.identity);assert.equal(after.menuItems[1].identity,food.identity);assert.equal(after.menuItems[1].name,food.name);assert.equal(after.menuItems[1].size,null);assert.equal(after.menuItems[1].quantity,3);assert.deepEqual(after.menuItems[1].instructions,['Warm']);
});
