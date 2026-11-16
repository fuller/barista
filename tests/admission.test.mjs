import test from 'node:test';
import assert from 'node:assert/strict';
import {handleApi} from '../src/server/api.mjs';
import {createOrder} from '../src/domain/order.mjs';
const input={turnId:'admission',baseRevision:0,text:'cancel',order:createOrder(),pending:{originalText:'latte',question:'Which size?',revision:0,answers:[],targetIds:[]}};
const request=(headers={},body=input)=>new Request('https://barista.example/api/turn',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
const env={OPENROUTER_API_KEY:'fake-server-key',REQUIRE_TURN_RATE_LIMIT:'true'};
test('required admission binding disables live configuration and fails closed',async()=>{
 const config=await(await handleApi(new Request('https://barista.example/api/config'),env)).json();
 assert.equal(config.liveAvailable,false);
 const response=await handleApi(request({'CF-Connecting-IP':'192.0.2.1'}),env);
 assert.equal(response.status,503);
});
test('required admission rejects missing platform address without consuming quota',async()=>{
 let calls=0;const response=await handleApi(request(),{...env,TURN_RATE_LIMITER:{limit:async()=>{calls++;return {success:true};}}});
 assert.equal(response.status,503);assert.equal(calls,0);
});
test('denied admission returns retry guidance without any inference',async()=>{
 let key,fetches=0;const prior=globalThis.fetch;globalThis.fetch=async()=>{fetches++;throw Error('must not fetch');};
 try{
  const response=await handleApi(request({'CF-Connecting-IP':'192.0.2.1'}),{...env,TURN_RATE_LIMITER:{limit:async input=>{key=input.key;return {success:false};}}});
  assert.equal(response.status,429);assert.equal(response.headers.get('Retry-After'),'60');assert.equal(key,'turn:192.0.2.1');assert.equal(fetches,0);
 }finally{globalThis.fetch=prior;}
});
test('limiter outage fails closed without exposing binding errors',async()=>{
 const response=await handleApi(request({'CF-Connecting-IP':'192.0.2.1'}),{...env,TURN_RATE_LIMITER:{limit:async()=>{throw Error('private binding detail');}}});
 assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/private binding detail/);
});
test('allowed admission permits valid turn and preserves local use without bindings',async()=>{
 for(const configured of [{...env,TURN_RATE_LIMITER:{limit:async()=>({success:true})}},{OPENROUTER_API_KEY:'fake-server-key'}]){
  const response=await handleApi(request({'CF-Connecting-IP':'192.0.2.1'}),configured);assert.equal(response.status,200);
 }
});
test('malformed turns are rejected before admission quota is consumed',async()=>{
 let calls=0;const response=await handleApi(request({'CF-Connecting-IP':'192.0.2.1'},{...input,text:''}),{...env,TURN_RATE_LIMITER:{limit:async()=>{calls++;return {success:true};}}});
 assert.equal(response.status,400);assert.equal(calls,0);
});
