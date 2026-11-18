import test from 'node:test';
import assert from 'node:assert/strict';
import {main,probeGuestPricing} from '../scripts/probe-starbucks-pricing.mjs';
import fixtures from './fixtures/starbucks/price-order.json' with {type:'json'};

test('pricing probe requires an explicit live flag and never dispatches by default',async()=>{
 let calls=0;const output=[];const code=await main([],{probe:async()=>{calls++;},output:value=>output.push(value)});
 assert.equal(code,1);assert.equal(calls,0);assert.match(output.join(''),/--live/);
});
test('unexpected arguments cannot redirect or configure the upstream request',async()=>{
 let calls=0;assert.equal(await main(['--live','https://example.com'],{probe:async()=>{calls++;},output(){}}),1);assert.equal(calls,0);
});
test('live probe uses the verified configured request and returns sanitized numeric money',async()=>{
 let cleared=0;const source={quote:async(key,body)=>{
  assert.match(key,/^[a-z0-9-]+$/);assert.equal(body.variables.order.storeNumber,'85278-313836');assert.equal(body.variables.order.cart.items[0].commerce.sku,'11183225');
  const envelope=structuredClone(fixtures.standard);envelope.data.priceOrder.cart.items[0].key=body.variables.order.cart.items[0].key;envelope.data.priceOrder.orderId='private-provider-identifier';return envelope;
 },clear(){cleared++;}};
 const result=await probeGuestPricing({source});assert.equal(result.status,'available');assert.equal(result.totalCents,844);assert.equal(result.taxCents,69);assert.equal(cleared,1);assert.ok(!JSON.stringify(result).includes('private-provider-identifier'));
});
test('rate limit remains unavailable, reports safe backoff and clears its session',async()=>{
 let cleared=0;const result=await probeGuestPricing({source:{quote:async()=>{throw Object.assign(new Error('secret response'),{code:'RATE_LIMITED',status:429,retryAfterMs:60000});},clear(){cleared++;}}});
 assert.deepEqual(result,{status:'unavailable',reason:'RATE_LIMITED',httpStatus:429,retryAfterMs:60000});assert.equal(cleared,1);
});
test('unexpected provider failures never print raw messages, bodies, codes or cookies',async()=>{
 const result=await probeGuestPricing({source:{quote:async()=>{throw Object.assign(new Error('Cookie=private'),{code:'private',body:'provider secret'});},clear(){}}});
 assert.deepEqual(result,{status:'unavailable',reason:'UNAVAILABLE'});
});
test('CLI returns a non-success exit code when live access is unavailable',async()=>{
 const output=[];const status=await main(['--live'],{probe:async()=>({status:'unavailable',reason:'RATE_LIMITED',httpStatus:429}),output:value=>output.push(value)});
 assert.equal(status,2);assert.equal(JSON.parse(output[0]).status,'unavailable');
});
