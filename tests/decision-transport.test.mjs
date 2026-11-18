import test from 'node:test';import assert from 'node:assert/strict';
import {createDecisionTransport} from '../src/adapters/decision-transport.mjs';
import {createDecisionCache} from '../src/adapters/decision-cache.mjs';
const choice={type:'choice',instructions:'Choose',criteria:{yes:'Yes',unclear:'Unclear'}};
const packet=(name='identity',text='transport')=>({state:{transcript:text},questions:{[name]:choice}});
const answer=(name='identity',selected='yes',probability=.99)=>({answers:{[name]:{type:'choice',choice:selected,probabilities:{yes:selected==='yes'?probability:1-probability,unclear:selected==='unclear'?probability:1-probability}}}});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const freshMetrics=()=>({totalRequests:0,extractionRequests:0,decisionRequests:0,extractionMs:0,decisionMs:0});
function fixture(overrides={}){const metrics=freshMetrics(),admissions=[];return {metrics,admissions,transport:createDecisionTransport({apiKey:'fake-transport',model:'model',questionProfile:'lean-v9',menuVersion:'v1',metrics,admissions,...overrides})};}
test('wire body preserves model/payload/state order and string state',async()=>{
 const calls=[];const {transport,metrics}=fixture({fetchImpl:async(url,options)=>{calls.push({url,...options});return {ok:true,json:async()=>answer()};}});
 await transport.post('decisions',{state:{transcript:'wire'},questions:{identity:choice}});
 assert.equal(calls[0].body,'{"model":"model","state":"{\\"transcript\\":\\"wire\\"}","questions":{"identity":{"type":"choice","instructions":"Choose","criteria":{"yes":"Yes","unclear":"Unclear"}}}}');
 await transport.post('decisions',{questions:{identity:choice},state:'already JSON'});assert.equal(calls[1].body,'{"model":"model","questions":{"identity":{"type":"choice","instructions":"Choose","criteria":{"yes":"Yes","unclear":"Unclear"}}},"state":"already JSON"}');assert.equal(metrics.totalRequests,2);assert.equal(metrics.decisionRequests,2);
});
test('pure concurrent packets share physical request while owner cancellation leaves joiner',async()=>{
 const cache=createDecisionCache(),pending=deferred(),entered=deferred();let upstream,calls=0;
 const fetchImpl=async(_url,{signal})=>{calls++;upstream=signal;entered.resolve();await pending.promise;return {ok:true,json:async()=>answer()};};
 const owner=fixture({cache,fetchImpl}),joiner=fixture({cache,fetchImpl}),controller=new AbortController();const first=owner.transport.post('decisions',packet('identity','shared'),controller.signal);const rejected=assert.rejects(first,{name:'AbortError'});await entered.promise;
 const second=joiner.transport.post('decisions',packet('identity','shared'));await new Promise(resolve=>setTimeout(resolve,10));controller.abort();await rejected;assert.equal(upstream.aborted,false);pending.resolve();assert.deepEqual(await second,answer());assert.equal(calls,1);assert.equal(owner.admissions.length,0);assert.equal(joiner.admissions.length,1);assert.equal(owner.metrics.totalRequests,1);assert.equal(joiner.metrics.totalRequests,0);assert.equal(joiner.metrics.inflightHits,1);assert.equal(joiner.metrics.cacheHits,0);assert.equal(cache.stats().entries,0);
});
test('key context isolates credential model profile menu thresholds endpoint and body',async()=>{
 const seen=[],cache={keyFor:async context=>{seen.push(context);return undefined;},get:()=>undefined};
 const {transport}=fixture({cache,fetchImpl:async()=>({ok:true,json:async()=>answer()})});await transport.post('decisions',packet());assert.deepEqual(seen[0],{credential:'fake-transport',model:'model',profile:'lean-v9',menuVersion:'v1',threshold:.85,margin:.15,endpoint:'https://openrouter.ai/api/alpha/decisions',body:JSON.stringify({model:'model',state:JSON.stringify({transcript:'transport'}),questions:{identity:choice}})});
});
test('coverage and extractions always execute live and never admit',async()=>{
 let calls=0,keys=0;const cache={keyFor:async()=>{keys++;return 'a'.repeat(64);},get:()=>answer()};const {transport,admissions,metrics}=fixture({cache,fetchImpl:async()=>{calls++;return {ok:true,json:async()=>answer('coverage')};}});
 for(let i=0;i<2;i++)await transport.post('decisions',packet('coverage'));for(let i=0;i<2;i++)await transport.post('extractions',packet('identity'));assert.equal(calls,4);assert.equal(keys,0);assert.equal(admissions.length,0);assert.equal(metrics.decisionRequests,2);assert.equal(metrics.extractionRequests,2);
});
test('normalization packets are pure and completed cache hits avoid fetch',async()=>{
 const cache=createDecisionCache();let calls=0;const f=fixture({cache,fetchImpl:async()=>{calls++;return {ok:true,json:async()=>answer('mod_milk')};}});const p=packet('mod_milk');await f.transport.post('decisions',p);assert.equal(f.admissions.length,1);cache.set(...f.admissions[0]);const result=await f.transport.post('decisions',p);assert.deepEqual(result,answer('mod_milk'));assert.equal(calls,1);assert.equal(f.metrics.cacheHits,1);assert.equal(f.metrics.totalRequests,1);
});
for(const [label,value] of [['low confidence',answer('identity','yes',.6)],['unclear',answer('identity','unclear')],['truncated',{...answer(),truncated:true}],['unchanged identity',{answers:{identity:{type:'choice',choice:'unchanged',probabilities:{unchanged:.99,yes:.01}}}}]])test(`no admission for ${label}`,async()=>{
 const p=label==='unchanged identity'?{state:{},questions:{identity:{...choice,criteria:{yes:'Yes',unchanged:'Keep'}}}}:packet();const f=fixture({cache:createDecisionCache(),fetchImpl:async()=>({ok:true,json:async()=>value})});await f.transport.post('decisions',p);assert.equal(f.admissions.length,0);
});
test('joined requests cannot bypass logical per-transport twenty request cap',async()=>{
 const cache={keyFor:async()=> 'c'.repeat(64),get:()=>undefined};const pending=deferred(),entered=deferred();const fetchImpl=async()=>{entered.resolve();await pending.promise;return {ok:true,json:async()=>answer()};};const owner=fixture({cache,fetchImpl}),joiner=fixture({cache,fetchImpl});const first=owner.transport.post('decisions',packet('identity','cap'));await entered.promise;
 const joined=Array.from({length:20},()=>joiner.transport.post('decisions',packet('identity','cap')));await assert.rejects(joiner.transport.post('decisions',packet('identity','cap')),/budget exhausted/);pending.resolve();await Promise.all([first,...joined]);assert.equal(joiner.metrics.totalRequests,0);assert.equal(joiner.metrics.inflightHits,20);
});
test('provider error and invalid JSON retain sanitized errors',async()=>{
 const bad=fixture({fetchImpl:async()=>({ok:false,status:503})});await assert.rejects(bad.transport.post('decisions',packet()),/Decision service unavailable \(503\). Your order has not changed./);
 const invalid=fixture({fetchImpl:async()=>({ok:true,json:async()=>{throw new Error('secret');}})});await assert.rejects(invalid.transport.post('decisions',packet()),{message:'Invalid decision response'});
});
test('real digest keys prevent sharing across credentials and decision contexts',async()=>{
 const cache=createDecisionCache(),pending=deferred();let calls=0;
 const fetchImpl=async()=>{calls++;await pending.promise;return {ok:true,json:async()=>answer()};};
 const contexts=[{}, {apiKey:'different-account'}, {model:'different-model'}, {questionProfile:'lean-v8'}, {menuVersion:'v2'}, {threshold:.9}, {margin:.2}];
 const fixtures=contexts.map(context=>fixture({cache,fetchImpl,...context}));
 const runs=fixtures.map(f=>f.transport.post('decisions',packet('identity','cross-account-isolation')));
 runs.push(fixture({cache,fetchImpl}).transport.post('decisions',packet('identity','different-body')));
 await new Promise(resolve=>setTimeout(resolve,20));assert.equal(calls,8);pending.resolve();await Promise.all(runs);
 for(const f of fixtures){assert.equal(f.metrics.totalRequests,1);assert.equal(f.metrics.inflightHits,0);}
});
test('caller aborted while response JSON resolves cannot admit stale cache packet',async()=>{
 const controller=new AbortController();const f=fixture({cache:createDecisionCache(),fetchImpl:async()=>({ok:true,json:async()=>{controller.abort();return answer();}})});
 await assert.rejects(f.transport.post('decisions',packet('identity','stale-json'),controller.signal),{name:'AbortError'});assert.equal(f.admissions.length,0);
});
