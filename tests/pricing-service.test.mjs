import test from 'node:test';
import assert from 'node:assert/strict';
import {createPricingServiceHandler,validateQuoteBody} from '../src/services/pricing-api.mjs';
import {buildStarbucksQuoteRequest} from '../src/adapters/starbucks-quote-protocol.mjs';
const body=buildStarbucksQuoteRequest({storeNumber:'85278-313836',items:[{itemId:'x',sku:'11183225',quantity:1}]}).body;
const token='a'.repeat(32);
const store={storeId:'abc',source:'starbucks',sourceStoreNumber:'85278-313836',name:'Cafe',address:{lines:['1 Main'],city:'Brooklyn',region:'NY',postalCode:'11201',countryCode:'US'},coordinates:{latitude:40,longitude:-73}};
test('rejects altered protocol and unauthenticated requests before guest source',async()=>{
 let calls=0;const handler=createPricingServiceHandler({token,source:{quote:async()=>{calls++;}}});
 assert.equal((await handler(new Request('http://localhost/quote',{method:'POST',body:'{}'}))).status,401);
 assert.throws(()=>validateQuoteBody({...body,query:'arbitrary'}));assert.equal(calls,0);
});
test('validates unit keys and rejects hidden request properties',()=>{
 assert.deepEqual(validateQuoteBody(body),body);
 const wrong=structuredClone(body);wrong.variables.order.cart.items[0].quantity=2;assert.throws(()=>validateQuoteBody(wrong));
});
test('sanitizes upstream response and never returns provider errors',async()=>{
 const handler=createPricingServiceHandler({token,source:{quote:async()=>({errors:[{message:'secret'}]})}});
 const response=await handler(new Request('http://localhost/quote',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:JSON.stringify({sessionKey:'s',body,selectedStore:store})}));
 assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/secret/);
});
test('success response is allowlisted and normalized-compatible',async()=>{
 const {readFile}=await import('node:fs/promises');
 const fixture=JSON.parse(await readFile(new URL('./fixtures/starbucks/price-order.json',import.meta.url),'utf8'));
 const envelope=fixture.standard;
 const configured=structuredClone(body);configured.variables.order.cart.items[0].key=envelope.data.priceOrder.cart.items[0].key;
 envelope.data.priceOrder.orderId='secret-order';
 const handler=createPricingServiceHandler({token,source:{quote:async()=>envelope}});
 const response=await handler(new Request('http://localhost/quote',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:JSON.stringify({sessionKey:'s',body:configured,selectedStore:store})}));
 assert.equal(response.status,200);assert.doesNotMatch(await response.text(),/secret-order/);
});
test('authenticated clear delegates only valid session keys',async()=>{
 let cleared;const handler=createPricingServiceHandler({token,source:{clear:async key=>{cleared=key;}}});
 const response=await handler(new Request('http://localhost/clear',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:JSON.stringify({sessionKey:'abc'})}));
 assert.equal(response.status,200);assert.equal(cleared,'abc');
});
test('expanded protocol accepts 51 and 100 units but rejects 101',()=>{
 for(const quantity of [51,100]){const expanded=buildStarbucksQuoteRequest({storeNumber:'85278-313836',items:[{itemId:'many',sku:'11183225',quantity}]}).body;assert.deepEqual(validateQuoteBody(expanded),expanded);}
 const oversized=buildStarbucksQuoteRequest({storeNumber:'85278-313836',items:[{itemId:'many',sku:'11183225',quantity:100}]}).body;oversized.variables.order.cart.items.push({...structuredClone(oversized.variables.order.cart.items[0]),key:'extra-100'});assert.throws(()=>validateQuoteBody(oversized));
});

test('selected store is required and must match quote store before guest source',async()=>{
 let calls=0;const handler=createPricingServiceHandler({token,source:{quote:async()=>{calls++;throw Error();}}});
 const selectedStore={storeId:'abc',source:'starbucks',sourceStoreNumber:'wrong',name:'Cafe',address:{lines:['1 Main'],city:'Brooklyn',region:'NY',postalCode:'11201',countryCode:'US'},coordinates:{latitude:40,longitude:-73}};
 for(const store of [undefined,selectedStore]){const response=await handler(new Request('http://localhost/quote',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:JSON.stringify({sessionKey:'s',body,selectedStore:store})}));assert.equal(response.status,400);}
 assert.equal(calls,0);
});
test('authenticated store lookup validates query and returns only sanitized public fields',async()=>{
 let calls=0;const handler=createPricingServiceHandler({token,source:{searchStores:()=>assert.fail('guest source must not handle public store lookup')},stores:{search:async query=>{calls++;assert.equal(query,'11201');return [{store:{id:'abc',storeNumber:'85278-313836',name:'Cafe',address:{lines:['1 Main'],city:'Brooklyn',countrySubdivisionCode:'NY',postalCode:'11201',countryCode:'US'},coordinates:{latitude:40,longitude:-73},private:'secret'}}];}}});
 for(const input of [{query:''},{query:'11201',extra:true},{query:'x'.repeat(121)}]){const response=await handler(new Request('http://localhost/stores',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:JSON.stringify(input)}));assert.equal(response.status,400);}
 const response=await handler(new Request('http://localhost/stores',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:JSON.stringify({query:'11201'})}));assert.equal(response.status,200);assert.equal(calls,1);assert.doesNotMatch(await response.text(),/private|secret/);
});
test('authenticated coordinate lookup normalizes and strictly validates coordinate payload',async()=>{let calls=0;const handler=createPricingServiceHandler({token,source:{searchStores:()=>assert.fail('guest source must not handle public store lookup')},stores:{search:async query=>{calls++;assert.deepEqual(query,{latitude:0,longitude:-73.9869});return [];}}});for(const query of [{latitude:0,longitude:-73.986861},{latitude:91,longitude:0},{latitude:0,longitude:0,extra:true},{latitude:0},{latitude:'0',longitude:0}]){const response=await handler(new Request('http://localhost/stores',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:JSON.stringify({query})}));assert.equal(response.status,calls===1&&query.longitude===-73.986861?200:400);}assert.equal(calls,1);});
test('store proxy rate limits retain safe retry metadata and unauthorized traffic never searches',async()=>{
 let calls=0;const handler=createPricingServiceHandler({token,source:{searchStores:()=>assert.fail('must not use guest source')},stores:{search:async()=>{calls++;throw Object.assign(Error('private upstream detail'),{code:'RATE_LIMITED',retryAfterMs:120000});}}});
 const request=authorized=>new Request('http://localhost/stores',{method:'POST',headers:authorized?{Authorization:`Bearer ${token}`}:{},body:JSON.stringify({query:'11201'})});
 assert.equal((await handler(request(false))).status,401);assert.equal(calls,0);
 const response=await handler(request(true));assert.equal(response.status,429);assert.equal(response.headers.get('Retry-After'),'120');assert.deepEqual(await response.json(),{error:'rate_limited'});assert.equal(calls,1);
});
test('preparation route is unavailable and never initializes a guest',async()=>{
 const handler=createPricingServiceHandler({token,source:{prepare:()=>assert.fail('must not prepare')}});
 const response=await handler(new Request('http://localhost/prepare',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:'{}'}));
 assert.equal(response.status,404);
});
test('health reads HTTP guest status without creating sessions',async()=>{
 const handler=createPricingServiceHandler({token,source:{status:()=>({ready:true,sessions:0})}});
 const response=await handler(new Request('http://localhost/health',{headers:{Authorization:`Bearer ${token}`}}));
 assert.deepEqual(await response.json(),{ready:true,sessions:0});
});
