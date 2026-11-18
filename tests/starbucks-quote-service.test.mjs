import test from 'node:test';
import assert from 'node:assert/strict';
import {createStarbucksQuoteService} from '../src/application/starbucks-quote-service.mjs';
import {StarbucksGuestError} from '../src/adapters/starbucks-guest-session.mjs';

const input=()=>({storeNumber:'85278-313836',items:[{itemId:'drink-1',sku:'11183225',quantity:1,modifiers:[]}]});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function response(body,expiresIn=300){
 const items=body.variables.order.cart.items.map(item=>{
  const extra=item.childItems.length?0.5:0;
  return {key:item.key,sku:item.commerce.sku,quantity:1,availability:'PURCHASABLE',isAvailable:true,price:7.75+extra,lineItems:[{key:`${item.commerce.sku}@1`,sku:item.commerce.sku,label:'Grande 16 fl oz',quantity:1,price:7.75},...(extra?[{key:'55@3',sku:'55',label:'3 Shots',quantity:3,price:extra}]:[])]};
 });
 const subtotal=items.reduce((sum,item)=>sum+Math.round(item.price*100),0),tax=Math.round(subtotal*0.08875);
 return {data:{priceOrder:{__typename:'PricedOrderV2',currency:'USD',expiresIn,cart:{items},summary:{price:(subtotal+tax)/100,lineItems:[{key:'subtotal',price:subtotal/100},{key:'tax',price:tax/100}]}}}};
}
function setup(options={}){
 let calls=0,clock=1000000;const cleared=[];
 const service=createStarbucksQuoteService({source:{quote:async(_session,body)=>{calls++;return response(body);},clear:key=>cleared.push(key)},now:()=>clock,...options});
 return {service,calls:()=>calls,cleared,tick:ms=>{clock+=ms;}};
}
test('a session reuses a verified unexpired quote and callers cannot mutate cached money',async()=>{
 const s=setup();const a=await s.service.quote('session-a',input());assert.equal(a.totalCents,844);a.items[0].unitCents=1;
 const b=await s.service.quote('session-a',input());assert.equal(b.items[0].unitCents,775);assert.equal(s.calls(),1);
});
test('cache is isolated by caller session, store, modifier configuration and fulfillment',async()=>{
 const s=setup();await s.service.quote('session-a',input());await s.service.quote('session-b',input());
 await s.service.quote('session-a',{...input(),storeNumber:'11809-106577'});
 const modified=input();modified.items[0].modifiers=[{sku:'55',quantity:3}];assert.equal((await s.service.quote('session-a',modified)).totalCents,898);
 await s.service.quote('session-a',{...input(),fulfillment:{consumptionType:'CONSUME_IN_STORE',collectionType:'IN_STORE'}});
 assert.equal(s.calls(),5);
});
test('quote expires at the upstream lifetime and a new quote is fetched',async()=>{
 const s=setup();await s.service.quote('session-a',input());s.tick(299999);await s.service.quote('session-a',input());assert.equal(s.calls(),1);
 s.tick(1);await s.service.quote('session-a',input());assert.equal(s.calls(),2);
});
test('cache eviction is bounded and uses recent successful reads',async()=>{
 const s=setup({maxEntries:2});await s.service.quote('a',input());await s.service.quote('b',input());await s.service.quote('a',input());await s.service.quote('c',input());await s.service.quote('b',input());assert.equal(s.calls(),4);
});
test('concurrent identical session quotes share one source request',async()=>{
 const gate=deferred();let calls=0,body;const service=createStarbucksQuoteService({source:{quote:(_session,b)=>{calls++;body=b;return gate.promise;},clear(){} }});
 const a=service.quote('a',input()),b=service.quote('a',input());await Promise.resolve();assert.equal(calls,1);gate.resolve(response(body));
 const values=await Promise.all([a,b]);assert.equal(values[0].totalCents,844);assert.equal(values[1].totalCents,844);assert.notEqual(values[0],values[1]);
});
test('one cancelled waiter cannot cancel another caller sharing its session quote',async()=>{
 const gate=deferred(),controller=new AbortController();let body;
 const service=createStarbucksQuoteService({source:{quote:(_session,b)=>{body=b;return gate.promise;},clear(){} }});
 const a=service.quote('a',input(),{signal:controller.signal}),b=service.quote('a',input());controller.abort();await assert.rejects(a,{name:'AbortError'});
 await Promise.resolve();gate.resolve(response(body));assert.equal((await b).totalCents,844);
});
test('already cancelled requests never reach source or consume a pending slot',async()=>{
 const s=setup(),controller=new AbortController();controller.abort();await assert.rejects(s.service.quote('a',input(),{signal:controller.signal}),{name:'AbortError'});assert.equal(s.calls(),0);
});
test('source errors do not cache a result or leak provider error content',async()=>{
 let calls=0;const service=createStarbucksQuoteService({source:{quote:async(_key,body)=>{calls++;if(calls===1)throw new Error('provider secret cookie=private');return response(body);},clear(){} }});
 await assert.rejects(service.quote('a',input()),error=>error.code==='unavailable'&&!error.message.includes('private'));
 assert.equal((await service.quote('a',input())).totalCents,844);assert.equal(calls,2);
});
test('clear invalidates cached quotes and the matching upstream session',async()=>{
 const s=setup();await s.service.quote('a',input());s.service.clear('a');assert.deepEqual(s.cleared,['a']);await s.service.quote('a',input());assert.equal(s.calls(),2);
});
test('cleared pending work cannot populate a new session cache',async()=>{
 const gate=deferred();let calls=0,body;
 const service=createStarbucksQuoteService({source:{quote:async(_key,b)=>{calls++;body=b;if(calls===1)return gate.promise;return response(b);},clear(){} }});
 const old=service.quote('a',input());const rejected=assert.rejects(old,error=>error.code==='unavailable');await Promise.resolve();service.clear('a');await service.quote('a',input());gate.resolve(response(body));await rejected;
 await service.quote('a',input());assert.equal(calls,2);
});
test('the pending limit rejects excess distinct work without contacting upstream',async()=>{
 const gate=deferred();let body,calls=0;
 const service=createStarbucksQuoteService({maxPending:1,source:{quote:(_key,b)=>{calls++;body=b;return gate.promise;},clear(){} }});
 const a=service.quote('a',input());await assert.rejects(service.quote('b',input()),error=>error.code==='busy');await Promise.resolve();gate.resolve(response(body));await a;assert.equal(calls,1);
});
test('invalid caller keys and configurations never reach the source',async()=>{
 const s=setup();await assert.rejects(s.service.quote('',input()),error=>error.code==='invalid_request');await assert.rejects(s.service.quote('a',{...input(),items:[]}),error=>error.code==='invalid_request');assert.equal(s.calls(),0);
});
test('immediate clear prevents deferred source dispatch and cannot bypass the pending limit',async()=>{
 let calls=0;const service=createStarbucksQuoteService({maxPending:1,source:{quote:async(_key,b)=>{calls++;return response(b);},clear(){}}});
 const abandoned=[];for(let i=0;i<3;i++){abandoned.push(service.quote('a',input()).catch(error=>error));service.clear('a');}
 await Promise.all(abandoned);assert.equal(calls,0);
});
test('quote lifetime starts before dispatch and an already expired result is never returned',async()=>{
 let clock=1000000;const service=createStarbucksQuoteService({now:()=>clock,source:{quote:async(_key,b)=>{clock+=2000;return response(b,1);},clear(){}}});
 await assert.rejects(service.quote('a',input()),error=>error.code==='unavailable');
});
test('known upstream rate limits preserve only safe retry metadata',async()=>{
 const service=createStarbucksQuoteService({source:{quote:async()=>{throw new StarbucksGuestError('RATE_LIMITED',429,60000);},clear(){}}});
 await assert.rejects(service.quote('a',input()),error=>error.code==='rate_limited'&&error.status===429&&error.retryAfterMs===60000);
});
