import test from 'node:test';
import assert from 'node:assert/strict';
import directory from '../src/catalog/data/starbucks-menu-directory.json' with {type:'json'};
import catalog from '../src/catalog/data/starbucks.snapshot.json' with {type:'json'};
import detail from './fixtures/starbucks/latte.json' with {type:'json'};
import {createOrder,applyCommands} from '../src/domain/order.mjs';
import {resolveOrderQuote} from '../src/application/resolve-order-quote.mjs';
const product=directory.products.find(p=>p.identity==='407:Hot');
const menu=(instructions=[],size='Grande',quantity=1)=>applyCommands(createOrder(),[{type:'add-menu',identity:product.identity,size,quantity,instructions}]);
const options={directory,catalog,resolveProduct:async()=>detail};
test('selected menu size resolves exact detail SKU',async()=>assert.deepEqual((await resolveOrderQuote(menu([],'Tall'),options)).items,[{itemId:'menu-1',sku:'41',quantity:1,modifiers:[]}]));
test('default menu size uses trusted directory SKU without detail',async()=>{const q=await resolveOrderQuote(menu([],null),{...options,resolveProduct:()=>{throw Error('not called')}});assert.equal(q.items[0].sku,product.defaultSize.sku)});
test('plain exact name and limited wrapper grammar resolve',async()=>{for(const text of ['Grande Caffè Latte','Can I get a grande hot latte please?','I would like one grande latte.'])assert.equal((await resolveOrderQuote(menu([text]),options)).items.length,1,text)});
test('explicit quantity matches exactly',async()=>{assert.equal((await resolveOrderQuote(menu(['two grande lattes'],'Grande',2),options)).items[0].quantity,2);assert.equal((await resolveOrderQuote(menu(['two grande lattes']),options)).items.length,0)});
test('never ignore customizations, unknown history, other products or sizes',async()=>{for(const text of ['grande latte with oat milk','grande latte no foam','grande latte extra hot','grande latte and a cookie','venti latte','grande mocha','make it regular','grande latte 2 shots']){const q=await resolveOrderQuote(menu([text]),options);assert.equal(q.items.length,0,text);assert.equal(q.unpriced[0].reason,'unsupported_instructions')}});
test('all instructions must independently match configuration',async()=>assert.equal((await resolveOrderQuote(menu(['grande latte','with vanilla']),options)).items.length,0));
test('detail identity and size must match and SKU valid',async()=>{for(const raw of [{products:[{...detail.products[0],formCode:'Iced'}]},{products:[{...detail.products[0],sizes:[]}]},{products:[{...detail.products[0],sizes:[{sizeCode:'Grande',sku:'bad'}]}]}])assert.equal((await resolveOrderQuote(menu([],'Tall'),{...options,resolveProduct:async()=>raw})).items.length,0)});
test('detail failures mark line unavailable',async()=>assert.equal((await resolveOrderQuote(menu([],'Tall'),{...options,resolveProduct:async()=>{throw Error('secret')}})).unpriced[0].reason,'product_unavailable'));
test('legacy defaults resolve catalog SKU but modifications remain unavailable',async()=>{for(const changes of [{},{shots:3}]){const o=applyCommands(createOrder(catalog.version),[{type:'add',productId:'latte',changes}]);const q=await resolveOrderQuote(o,options);assert.equal(q.items.length,Object.keys(changes).length?0:1)}});
test('invalid order or catalog rejected',async()=>{await assert.rejects(resolveOrderQuote({},options));await assert.rejects(resolveOrderQuote(menu(),{...options,catalog:{}}));});
test('empty order resolves without upstream',async()=>assert.deepEqual(await resolveOrderQuote(createOrder(),options),{items:[],unpriced:[]}));
test('abort before resolution rejects without fetching',async()=>{const controller=new AbortController();controller.abort();let calls=0;await assert.rejects(resolveOrderQuote(menu(),{...options,signal:controller.signal,resolveProduct:async()=>{calls++;return detail}}),{name:'AbortError'});assert.equal(calls,0)});
test('signal forwarded and abort during detail rejects instead of unpriced',async()=>{const controller=new AbortController();await assert.rejects(resolveOrderQuote(menu([],'Tall'),{...options,signal:controller.signal,resolveProduct:async(identity,{signal})=>{assert.equal(signal,controller.signal);controller.abort();return detail}}),{name:'AbortError'})});
test('upstream AbortError propagates instead of becoming unavailable',async()=>await assert.rejects(resolveOrderQuote(menu([],'Tall'),{...options,resolveProduct:async()=>{throw new DOMException('cancelled','AbortError')}}),{name:'AbortError'}));
test('oversized unit count marks entire cart unpriced before detail requests',async()=>{let o=menu([],null,100);o=applyCommands(o,[{type:'add-menu',identity:product.identity,size:'Grande'}]);let calls=0;const q=await resolveOrderQuote(o,{...options,resolveProduct:async()=>{calls++;return detail}});assert.equal(calls,0);assert.equal(q.items.length,0);assert.deepEqual(q.unpriced,[{itemId:'menu-1',reason:'pricing_limit_exceeded'},{itemId:'menu-2',reason:'pricing_limit_exceeded'}]);assert.equal(o.menuItems[0].quantity,100)});
test('over 50 lines marks entire cart unpriced before fetching',async()=>{const o=applyCommands(createOrder(),Array.from({length:51},()=>({type:'add-menu',identity:product.identity,size:'Grande'})));let calls=0;const q=await resolveOrderQuote(o,{...options,resolveProduct:async()=>{calls++;return detail}});assert.equal(calls,0);assert.equal(q.unpriced.length,51);assert.equal(q.items.length,0);assert.ok(q.unpriced.every(i=>i.reason==='pricing_limit_exceeded'))});
test('exact pricing limits remain orderable and resolvable',async()=>{const o=applyCommands(createOrder(),Array.from({length:50},()=>({type:'add-menu',identity:product.identity,size:null,quantity:2})));const q=await resolveOrderQuote(o,options);assert.equal(q.items.length,50);assert.equal(q.items.reduce((n,i)=>n+i.quantity,0),100)});

test('explicit source default size resolves trusted SKU without upstream details',async()=>{
 for(const identity of ['407:Hot','28516:Iced']){
  const entry=directory.products.find(p=>p.identity===identity);let calls=0;
  const order=applyCommands(createOrder(),[{type:'add-menu',identity,size:entry.defaultSize.displayName}]);
  const result=await resolveOrderQuote(order,{...options,resolveProduct:()=>{calls++;throw Error('upstream blocked');}});
  assert.equal(calls,0);assert.deepEqual(result,{items:[{itemId:'menu-1',sku:entry.defaultSize.sku,quantity:1,modifiers:[]}],unpriced:[]});
 }
});
test('nondefault size still requires its exact upstream SKU',async()=>{
 let calls=0;
 const result=await resolveOrderQuote(menu([],'Tall'),{...options,resolveProduct:async(identity)=>{calls++;assert.equal(identity,product.identity);return detail;}});
 assert.equal(calls,1);assert.equal(result.items[0].sku,'41');assert.notEqual(result.items[0].sku,product.defaultSize.sku);
});
