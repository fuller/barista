import test from 'node:test';import assert from 'node:assert/strict';
import {locateMenuBoundaries} from '../src/adapters/menu-boundary-locator.mjs';
const response=(questions,choices={},prob=.99)=>({answers:Object.fromEntries(Object.entries(questions).map(([key,q])=>{const chosen=choices[key]??'continue',keys=Object.keys(q.criteria);return [key,{type:'choice',choice:chosen,probabilities:Object.fromEntries(keys.map(k=>[k,k===chosen?prob:(1-prob)/(keys.length-1)]))}];}))});
const run=(text,choices,extra={})=>{const calls=[];return {calls,result:locateMenuBoundaries({text,post:async(route,payload)=>{calls.push({route,payload});return response(payload.questions,choices);},...extra})};};
for(const [name,text,choices,count] of [
 ['food-local-comma','a short-rib sandwich, warmed',{},1],
 ['shared-suffix','a latte and a mocha, both with oat milk',{b0:'split',b1:'split'},3],
 ['local-milk','Add a latte with oat milk and add a mocha',{b0:'split'},2],
 ['correction','a latte, actually a mocha',{},1],
 ['negation','a latte, not hot',{},1],
 ['iced-order','an iced latte and a croissant',{b0:'split'},2],
])test('exact boundary source coverage '+name,async()=>{const f=run(text,choices),result=await f.result;assert.equal(result.clauses.length,count);assert.equal(result.clauses.map(c=>c.text).join(''),text);let end=0;for(const clause of result.clauses){assert.equal(clause.start,end);assert.equal(Array.from(text).slice(clause.start,clause.end).join(''),clause.text);end=clause.end;}assert.equal(end,Array.from(text).length);});
test('Unicode offsets count code points and clustered connectors produce one boundary',async()=>{const text='☕ latte, and then 🧋 mocha',f=run(text,{b0:'split'}),result=await f.result;assert.equal(result.clauses.length,2);assert.equal(f.calls[0].payload.state.boundaries.length,1);assert.equal(result.clauses.map(c=>c.text).join(''),text);assert.equal(result.clauses[1].end,Array.from(text).length);});
test('unclear/low confidence atomically retries, malformed evidence fails protocol',async()=>{
 for(const [choice,prob] of [['unclear',.99],['split',.6]]){const result=await locateMenuBoundaries({text:'latte and mocha',post:async(_r,p)=>response(p.questions,{b0:choice},prob)});assert.deepEqual(result.clauses,[]);assert.equal(result.failure.mode,'retry');}
 await assert.rejects(()=>locateMenuBoundaries({text:'latte and mocha',post:async()=>({answers:{b0:{type:'choice',choice:'split',probabilities:{split:1}}}})}),/Invalid decision/);
});
test('candidate and resulting clause bounds reject without partial result',async()=>{
 const many=Array.from({length:34},()=> 'item').join(',');let calls=0;const result=await locateMenuBoundaries({text:many,post:async()=>{calls++;}});assert.equal(calls,0);assert.equal(result.failure.mode,'retry');
 const seven=await locateMenuBoundaries({text:'a,b,c,d,e,f,g',post:async(_r,p)=>response(p.questions,Object.fromEntries(Object.keys(p.questions).map(k=>[k,'split'])))});assert.deepEqual(seven.clauses,[]);assert.equal(seven.failure.mode,'retry');
});
test('boundary decisions pack at most 16 questions per request',async()=>{
 const text=Array.from({length:20},()=> 'item').join(',');const f=run(text,{}),result=await f.result;assert.equal(f.calls.length,2);assert.ok(f.calls.every(c=>Object.keys(c.payload.questions).length<=16));assert.equal(result.clauses[0].text,text);
});
test('cancellation and malformed evidence cannot produce accepted boundaries',async()=>{
 const controller=new AbortController();controller.abort();await assert.rejects(()=>locateMenuBoundaries({text:'latte',signal:controller.signal,post:async()=>assert.fail('no dispatch')}),{name:'AbortError'});
 const active=new AbortController();await assert.rejects(()=>locateMenuBoundaries({text:'latte and mocha',signal:active.signal,post:async(_r,p)=>{active.abort();return response(p.questions);}}),{name:'AbortError'});
 await assert.rejects(()=>locateMenuBoundaries({text:'latte and mocha',post:async()=>({truncated:'false',answers:{}})}),/Invalid decision truncation/);
 const duplicateKeys=await locateMenuBoundaries({text:'latte and then, mocha',post:async(_r,p)=>response(p.questions,{b0:'split'})});assert.equal(duplicateKeys.clauses.map(c=>c.text).join(''),'latte and then, mocha');
});
test('preparation profile preserves plural item local trailing preparation without changing native boundaries',async()=>{
 const text='two croissants, warmed',calls=[];const result=await locateMenuBoundaries({text,boundaryProfile:'preparation-v1',post:async(_route,payload)=>{calls.push(payload);return response(payload.questions);}});assert.equal(result.clauses[0].text,text);assert.equal(result.clauses.length,1);assert.match(calls[0].questions.b0.instructions,/including plural or multiple copies/);assert.deepEqual(calls[0].questions.b0.criteria,{split:'Separate source clauses here',continue:'Keep one owning source clause',unclear:'Boundary is genuinely unclear'});
});
