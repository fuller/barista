import test from 'node:test';import assert from 'node:assert/strict';
import {requestTurn} from '../src/application/turn-client.mjs';
import {createOrder} from '../src/domain/order.mjs';
const input=()=>({turnId:'voice-turn',baseRevision:0,text:'one latte',order:createOrder()});
const data=()=>({turnId:'voice-turn',baseRevision:0,commands:[{type:'add-menu',identity:'407:Hot'}],clarification:null,pending:null});
test('shared client sends normal compacted request and records physical timing',async()=>{
 const events=[];let body;
 const result=await requestTurn(input(),{fetchImpl:async(url,options)=>{assert.equal(url,'/api/turn');body=JSON.parse(options.body);return Response.json(data());},onTiming:event=>events.push(event)});
 assert.deepEqual(result,data());assert.equal(body.turnId,'voice-turn');assert.deepEqual(events,['fetchStart','fetchHeaders','responseParsed']);
});
test('wrong turn, wrong revision and invalid command envelope cannot be reused or previewed',async()=>{
 for(const patch of [{turnId:'old'},{baseRevision:1},{commands:null}])await assert.rejects(()=>requestTurn(input(),{fetchImpl:async()=>Response.json({...data(),...patch})}),/Response did not match|Invalid order response/);
});
test('HTTP error and abort during decode never become a successful prepared result',async()=>{
 await assert.rejects(()=>requestTurn(input(),{fetchImpl:async()=>Response.json({error:'Unavailable'},{status:503})}),/Unavailable/);
 const controller=new AbortController();await assert.rejects(()=>requestTurn(input(),{signal:controller.signal,fetchImpl:async()=>({ok:true,json:async()=>{controller.abort();return data();}})}),{name:'AbortError'});
});
