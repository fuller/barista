import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserPricingHandler,validateQuoteBody} from '../src/browser/pricing-service.mjs';
import {buildStarbucksQuoteRequest} from '../src/adapters/starbucks-quote-protocol.mjs';
const body=buildStarbucksQuoteRequest({storeNumber:'85278-313836',items:[{itemId:'x',sku:'11183225',quantity:1}]}).body;
const token='a'.repeat(32);
test('rejects altered protocol and unauthenticated requests before transport',async()=>{
 let calls=0;const handler=createBrowserPricingHandler({token,transport:{quote:async()=>{calls++;}}});
 assert.equal((await handler(new Request('http://localhost/quote',{method:'POST',body:'{}'}))).status,401);
 assert.throws(()=>validateQuoteBody({...body,query:'arbitrary'}));assert.equal(calls,0);
});
test('validates unit keys and rejects hidden request properties',()=>{
 assert.deepEqual(validateQuoteBody(body),body);
 const wrong=structuredClone(body);wrong.variables.order.cart.items[0].quantity=2;assert.throws(()=>validateQuoteBody(wrong));
});
test('sanitizes upstream response and never returns provider errors',async()=>{
 const handler=createBrowserPricingHandler({token,transport:{quote:async()=>({errors:[{message:'secret'}]})}});
 const response=await handler(new Request('http://localhost/quote',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:JSON.stringify({sessionKey:'s',body})}));
 assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/secret/);
});
test('success response is allowlisted and normalized-compatible',async()=>{
 const {readFile}=await import('node:fs/promises');
 const fixture=JSON.parse(await readFile(new URL('./fixtures/starbucks/price-order.json',import.meta.url),'utf8'));
 const envelope=fixture.standard;
 const configured=structuredClone(body);configured.variables.order.cart.items[0].key=envelope.data.priceOrder.cart.items[0].key;
 envelope.data.priceOrder.orderId='secret-order';
 const handler=createBrowserPricingHandler({token,transport:{quote:async()=>envelope}});
 const response=await handler(new Request('http://localhost/quote',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:JSON.stringify({sessionKey:'s',body:configured})}));
 assert.equal(response.status,200);assert.doesNotMatch(await response.text(),/secret-order/);
});
test('authenticated clear delegates only valid session keys',async()=>{
 let cleared;const handler=createBrowserPricingHandler({token,transport:{clear:async key=>{cleared=key;}}});
 const response=await handler(new Request('http://localhost/clear',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:JSON.stringify({sessionKey:'abc'})}));
 assert.equal(response.status,200);assert.equal(cleared,'abc');
});
test('expanded protocol accepts 51 and 100 units but rejects 101',()=>{
 for(const quantity of [51,100]){const expanded=buildStarbucksQuoteRequest({storeNumber:'85278-313836',items:[{itemId:'many',sku:'11183225',quantity}]}).body;assert.deepEqual(validateQuoteBody(expanded),expanded);}
 const oversized=buildStarbucksQuoteRequest({storeNumber:'85278-313836',items:[{itemId:'many',sku:'11183225',quantity:100}]}).body;oversized.variables.order.cart.items.push({...structuredClone(oversized.variables.order.cart.items[0]),key:'extra-100'});assert.throws(()=>validateQuoteBody(oversized));
});
