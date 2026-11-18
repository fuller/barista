import test from 'node:test';
import assert from 'node:assert/strict';
import {handleApi} from '../src/server/api.mjs';
import {createOrder} from '../src/domain/order.mjs';
import {buildMenuIdentityGroups} from '../src/adapters/menu-decider.mjs';
import directory from '../src/catalog/data/starbucks-menu-directory.json' with {type:'json'};
const env={OPENROUTER_API_KEY:'fake-profile-server-key'};
const config=environment=>handleApi(new Request('https://barista.example/api/config'),environment);
const request=(extra={})=>new Request('https://barista.example/api/turn',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({turnId:'profile-turn',baseRevision:0,text:'one Americano',order:createOrder(),...extra})});
async function provider(run){const previous=globalThis.fetch,calls=[];const identity='406:Hot',group=buildMenuIdentityGroups(directory.products).find(g=>g.products.some(p=>p.identity===identity)).id;globalThis.fetch=async(_url,init)=>{assert.equal(init.headers.Authorization,'Bearer '+env.OPENROUTER_API_KEY);const body=JSON.parse(init.body);calls.push(body);const values={coverage:'complete',action:'add',target:'none',targetScope:'item',replacementRequested:'absent',productGroup:group,identity,sizeRequested:'absent',size:'unchanged',quantityRequested:'absent',quantity:'1'};return Response.json({answers:Object.fromEntries(Object.entries(body.questions).map(([key,q])=>{const value=values[key]??Object.keys(q.criteria)[0];assert.ok(Object.hasOwn(q.criteria,value),key);return [key,{type:'choice',choice:value,probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k===value?1:0]))}];}))});};try{return await run(calls);}finally{globalThis.fetch=previous;}}
test('safe config exposes lean-v10 default and explicit lean-v8 rollback',async()=>{
 const baseline=await (await config(env)).json();assert.equal(baseline.questionProfile,'lean-v10');assert.equal(baseline.liveAvailable,true);assert.ok(!JSON.stringify(baseline).includes(env.OPENROUTER_API_KEY));
 const selected=await (await config({...env,MENU_QUESTION_PROFILE:'lean-v8'})).json();assert.equal(selected.questionProfile,'lean-v8');assert.equal(selected.liveAvailable,true);
});
test('invalid server profile disables availability and blocks dispatch without echoing its value',async()=>{
 const previous=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;assert.fail('invalid configuration must not dispatch');};
 try{for(const value of ['secret-invalid-profile','','baseline','lean-v1','lean-v2','lean-v3','lean-v4','lean-v5','lean-v6','lean-v7',42]){const environment={...env,MENU_QUESTION_PROFILE:value};const configuration=await config(environment),body=await configuration.json();assert.equal(body.liveAvailable,false);assert.equal(body.questionProfile,null);assert.ok(!JSON.stringify(body).includes('secret-invalid-profile'));const turn=await handleApi(request(),environment);assert.equal(turn.status,503);assert.ok(!(await turn.text()).includes('secret-invalid-profile'));}assert.equal(calls,0);}finally{globalThis.fetch=previous;}
});
test('invalid ordering profile leaves full-menu browsing available',async()=>{const response=await handleApi(new Request('https://barista.example/api/menu-directory'),{...env,MENU_QUESTION_PROFILE:'bad'});assert.equal(response.status,200);assert.equal((await response.json()).products.length,313);});
test('client profile fields cannot override explicit lean-v8 server rollback',async()=>provider(async calls=>{
 const response=await handleApi(request({questionProfile:'lean-v9',MENU_QUESTION_PROFILE:'lean-v9'}),{...env,MENU_QUESTION_PROFILE:'lean-v8'});assert.equal(response.status,200);assert.equal((await response.json()).commands[0].identity,'406:Hot');assert.equal(calls.length,3);const core=calls.find(c=>c.questions.coverage);assert.equal(Object.hasOwn(core.questions,'singleAddQuantity'),false);assert.equal(Object.hasOwn(core.questions,'quantity'),false);assert.equal(Object.hasOwn(JSON.parse(core.state),'menu'),false);assert.ok(calls.some(c=>c.questions.quantity));
}));
test('default server lean-v10 skips numeric detail for a confident single beverage',async()=>provider(async calls=>{
 const response=await handleApi(request(),env);assert.equal(response.status,200);const body=await response.json();assert.equal(body.commands[0].identity,'406:Hot');assert.equal(body.commands[0].quantity,1);assert.equal(calls.length,2);const core=calls.find(c=>c.questions.coverage);assert.equal(Object.hasOwn(core.questions,'quantity'),false);assert.equal(Object.hasOwn(JSON.parse(core.state),'menu'),false);assert.ok(core.questions.singleAddQuantity);assert.equal(calls.some(c=>c.questions.quantity),false);
}));
test('explicit compact lean-v8 config is live and retired profiles are disabled',async()=>{
 const candidate=await (await config({...env,MENU_QUESTION_PROFILE:'lean-v8'})).json();assert.equal(candidate.questionProfile,'lean-v8');assert.equal(candidate.liveAvailable,true);
 const rollback=await (await config({...env,MENU_QUESTION_PROFILE:'lean-v7'})).json();assert.equal(rollback.questionProfile,null);assert.equal(rollback.liveAvailable,false);
});
test('explicit lean-v9 profile keeps v8 rollback available',async()=>{
 const c=await (await config({...env,MENU_QUESTION_PROFILE:'lean-v9'})).json();assert.equal(c.questionProfile,'lean-v9');assert.equal(c.liveAvailable,true);
 assert.equal((await (await config({...env,MENU_QUESTION_PROFILE:'lean-v8'})).json()).questionProfile,'lean-v8');
});
