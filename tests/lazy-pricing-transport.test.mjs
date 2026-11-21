import test from 'node:test';
import assert from 'node:assert/strict';
import {createLazyPricingTransport} from '../src/browser/lazy-transport.mjs';
import {createBrowserPricingHandler} from '../src/browser/pricing-service.mjs';

function fake(){let starts=0,closes=0;const calls=[];const transport={status:()=>({ready:true,sessions:1}),prepare:async(...args)=>{calls.push(['prepare',...args]);return {ready:true};},quote:async(...args)=>{calls.push(['quote',...args]);return {quoted:true};},clear:async key=>{calls.push(['clear',key]);},close:async()=>{closes++;}};return {transport,calls,get starts(){return starts;},get closes(){return closes;},create:async()=>{starts++;return transport;}};}
test('health, status, clear and shutdown never start Chrome',async()=>{
 const f=fake(),lazy=createLazyPricingTransport({createTransport:f.create}),token='a'.repeat(32);
 const handler=createBrowserPricingHandler({token,transport:lazy});
 for(const path of ['/health','/status']){const response=await handler(new Request('https://service.test'+path,{headers:{Authorization:`Bearer ${token}`}}));assert.equal(response.status,200);assert.equal((await response.json()).browserStarted,false);}
 await lazy.clear('unused');await lazy.close();await lazy.close();assert.equal(f.starts,0);assert.equal(f.closes,0);
 await assert.rejects(lazy.quote('closed',{}));assert.equal(f.starts,0);
});
test('authenticated store search and health work without Chrome; pricing alone starts it',async()=>{
 const f=fake(),lazy=createLazyPricingTransport({createTransport:f.create}),token='a'.repeat(32);let searches=0;
 const handler=createBrowserPricingHandler({token,transport:lazy,stores:{search:async query=>{searches++;assert.equal(query,'11201');return [];}}});
 const response=await handler(new Request('https://service.test/stores',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:JSON.stringify({query:'11201'})}));
 assert.equal(response.status,200);assert.deepEqual(await response.json(),[]);assert.equal(searches,1);assert.equal(f.starts,0);
 const health=await handler(new Request('https://service.test/health',{headers:{Authorization:`Bearer ${token}`}}));assert.equal((await health.json()).browserStarted,false);assert.equal(f.starts,0);
 await lazy.quote('caller',{});assert.equal(f.starts,1);await lazy.close();
});
test('first prepare and quote share exactly one lazy Chrome startup',async()=>{
 const f=fake();let release;const gate=new Promise(resolve=>{release=resolve;});
 const lazy=createLazyPricingTransport({createTransport:async()=>{await gate;return f.create();}});
 const prepared=lazy.prepare('caller',{selectedStore:{}}),quoted=lazy.quote('caller',{});
 assert.equal(lazy.status().browserStarted,false);release();
 assert.deepEqual(await prepared,{ready:true});assert.deepEqual(await quoted,{quoted:true});assert.equal(f.starts,1);assert.equal(lazy.status().browserStarted,true);assert.equal(lazy.status().sessions,1);
 await lazy.quote('caller',{});assert.equal(f.starts,1);await lazy.close();assert.equal(f.closes,1);
});
test('failed startup is cached without automatic retries or leaking factory errors',async()=>{
 let starts=0;const lazy=createLazyPricingTransport({createTransport:async()=>{starts++;throw Error('private browser details');}});
 await assert.rejects(lazy.prepare('caller',{}),error=>error.message==='Browser unavailable');
 await assert.rejects(lazy.quote('caller',{}),error=>error.message==='Browser unavailable');
 assert.equal(starts,1);assert.equal(lazy.status().browserFailed,true);await lazy.close();
});
test('shutdown during startup closes the late browser and prevents pending work',async()=>{
 const f=fake();let release;const gate=new Promise(resolve=>{release=resolve;});
 const lazy=createLazyPricingTransport({createTransport:async()=>{await gate;return f.create();}});
 const prepared=lazy.prepare('caller',{});const rejected=assert.rejects(prepared);const stopped=lazy.close();release();
 await Promise.all([rejected,stopped]);assert.equal(f.starts,1);assert.equal(f.closes,1);assert.deepEqual(f.calls,[]);
 await assert.rejects(lazy.quote('caller',{}));await lazy.close();assert.equal(f.closes,1);
});
