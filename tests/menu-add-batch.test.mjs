import test from 'node:test';
import assert from 'node:assert/strict';
import {createDecisionTransport} from '../src/adapters/decision-transport.mjs';
import {sanitizeMetrics} from '../src/server/metrics.mjs';
import {tryMenuAddBatch} from '../src/adapters/menu-add-batch.mjs';
import {createMenuDeciderAdapter} from '../src/adapters/menu-decider.mjs';
import {createOrder,applyCommands} from '../src/domain/order.mjs';
import directory from '../src/catalog/data/starbucks-menu-directory.json' with {type:'json'};
const groups=['Beverage','Food','Coffee'].map((type,index)=>({id:'group_'+index,label:type,products:directory.products.filter(product=>product.productType===type)}));
const clauses=[{text:'one American '},{text:'and one cold brew'}];
const plans=[{coverage:'complete',action:'add',group:'group_0',identity:'406:Hot',quantity:'1',size:'unchanged'},{coverage:'complete',action:'add',group:'group_0',identity:'2121255:Iced',quantity:'1',size:'unchanged'}];
function answers(questions,selected=plans,{low,refusal}={}){
 return Object.fromEntries(Object.entries(questions).map(([key,question])=>{
  if(key===refusal)return [key,{type:'refusal'}];
  const [,index,field]=key.match(/^c(\d+)_(.+)$/),value=selected[Number(index)][field],probability=key===low?.6:.99,keys=Object.keys(question.criteria);
  assert.ok(keys.includes(value),key+':'+value);
  return [key,{type:'choice',choice:value,probabilities:Object.fromEntries(keys.map(candidate=>[candidate,candidate===value?probability:(1-probability)/(keys.length-1)]))}];
 }));
}
const run=(options={},postOptions={})=>tryMenuAddBatch({clauses,groups,post:async(route,packet)=>({answers:answers(packet.questions,plans,postOptions)}),...options});
test('two independent beverages share twelve bounded questions with exact local source notes',async()=>{
 let calls=0;
 const commands=await run({post:async(route,{questions,state})=>{calls++;assert.equal(route,'decisions');assert.equal(Object.keys(questions).length,12);for(const question of Object.values(questions))assert.ok(Object.keys(question.criteria).length<=254);assert.deepEqual(state.clauses,[{id:'c0',transcript:clauses[0].text},{id:'c1',transcript:clauses[1].text}]);return {answers:answers(questions)};}});
 assert.equal(calls,1);assert.deepEqual(commands.map(command=>[command.identity,command.quantity,command.instructions]),[['406:Hot',1,['one American ']],['2121255:Iced',1,['and one cold brew']]]);
});
test('modifier numbers do not become copies or leak across independently scoped clauses',async()=>{
 const local=[{text:'two Grande iced lattes with oat milk and one extra shot '},{text:'and a Tall Americano with whole milk'}];
 const selected=[{...plans[0],identity:'407:Iced',quantity:'2',size:'Grande'},{...plans[1],identity:'406:Hot',size:'Tall'}];
 const commands=await run({clauses:local,post:async(route,packet)=>({answers:answers(packet.questions,selected)})});
 assert.deepEqual(commands.map(command=>[command.identity,command.size,command.quantity]),[['407:Iced','Grande',2],['406:Hot','Tall',1]]);
 assert.deepEqual(commands.map(command=>command.instructions),local.map(clause=>[clause.text]));assert.doesNotMatch(commands[1].instructions[0],/oat|shot/);
});
test('unproven action/group/identity/size/count or low confidence rejects the whole batch',async()=>{
 for(const changed of [{coverage:'unproven'},{action:'other'},{group:'group_1'},{identity:'unchanged'},{identity:'407:Hot',size:'Trenta'},{size:'__source_invalid__'},{quantity:'unclear'}]){
  const selected=[plans[0],{...plans[1],...changed}];assert.equal(await run({post:async(route,packet)=>({answers:answers(packet.questions,selected)})}),null);
 }
 for(const low of ['c0_coverage','c0_action','c0_group','c0_identity','c0_quantity','c0_size'])assert.equal(await run({}, {low}),null);
 assert.equal(await run({}, {refusal:'c1_identity'}),null);
});
test('malformed or truncated answers never compile and abort does not start another batch',async()=>{
 for(const response of [{answers:{}},{answers:[]},{truncated:'yes',answers:{}}])await assert.rejects(run({post:async()=>response}),/Invalid batch/);
 assert.equal(await run({post:async()=>({truncated:true})}),null);
 assert.equal(await run({post:async(route,packet)=>({truncated:true,answers:answers(packet.questions)})}),null);
 const controller=new AbortController();controller.abort();let calls=0;await assert.rejects(run({signal:controller.signal,post:async()=>{calls++;}}),{name:'AbortError'});assert.equal(calls,0);
});
test('batch size, catalog eligibility and fallback reservation are bounded before provider work',async()=>{
 const post=()=>assert.fail('must skip speculative work');
 assert.equal(await run({clauses:[clauses[0]],post}),null);
 assert.equal(await run({clauses:Array(6).fill(clauses[0]),requests:1,post}),null);
 assert.equal(await run({groups:groups.filter(group=>group.label!=='Beverage'),post}),null);
});
test('five independent clauses use chunks of at most two and preserve repeated lines',async()=>{
 const repeated=Array(5).fill(clauses[0]);let calls=0;
 const commands=await run({clauses:repeated,requests:1,post:async(route,packet)=>{calls++;assert.ok(Object.keys(packet.questions).length<=12);return {answers:answers(packet.questions,Array(5).fill(plans[0]))};}});
 assert.equal(calls,3);assert.equal(commands.length,5);
});
test('adapter commits two drinks in two provider calls after boundary admission',async()=>{
 let calls=0;const adapter=createMenuDeciderAdapter({apiKey:'test',fetchImpl:async(url,init)=>{
  calls++;const packet=JSON.parse(init.body),questions=packet.questions;
  if(Object.keys(questions).every(key=>/^b\d+$/.test(key)))return Response.json({answers:Object.fromEntries(Object.entries(questions).map(([key,question])=>[key,{type:'choice',choice:'split',probabilities:{split:.99,continue:.005,unclear:.005}}]))});
  return Response.json({answers:answers(questions)});
 }});
 const original=createOrder(),result=await adapter.interpretTurn({text:'one American and one cold brew',order:original});
 assert.equal(result.clarification,null);assert.equal(result.metrics.totalRequests,2);assert.equal(calls,2);assert.equal(result.metrics.strategy,'batch');
 const publicMetrics=sanitizeMetrics(result.metrics);assert.equal(publicMetrics.strategy,'batch');assert.equal(publicMetrics.totalRequests,2);assert.ok(Number.isFinite(publicMetrics.totalRequests));
 const committed=applyCommands(original,result.commands);assert.equal(committed.revision,original.revision+1);assert.deepEqual(committed.menuItems.map(item=>item.identity),['406:Hot','2121255:Iced']);assert.equal(original.menuItems?.length??0,0);
});

test('pending clarification, correction context and nonempty carts skip the batch path',async()=>{
 for(const overrides of [{pending:{}},{clarificationContext:{}},{order:applyCommands(createOrder(),[{type:'add-menu',identity:'407:Hot'}])}]){
  let routed=false;
  const adapter=createMenuDeciderAdapter({apiKey:'test',fetchImpl:async(url,init)=>{
   const {questions}=JSON.parse(init.body);
   if(Object.keys(questions).every(key=>/^b\d+$/.test(key)))return Response.json({answers:Object.fromEntries(Object.keys(questions).map(key=>[key,{type:'choice',choice:'split',probabilities:{split:.99,continue:.005,unclear:.005}}]))});
   assert.ok(!Object.keys(questions).some(key=>/^c\d+_/.test(key)));routed=true;throw Error('existing fallback');
  }});
  await assert.rejects(adapter.interpretTurn({text:'one American and one cold brew',order:createOrder(),...overrides}),/existing fallback/);assert.equal(routed,true);
 }
});
test('cancellation after a batch response propagates without starting fallback or later chunks',async()=>{
 const controller=new AbortController();let calls=0;
 await assert.rejects(run({signal:controller.signal,clauses:Array(4).fill(clauses[0]),post:async(route,packet)=>{calls++;controller.abort();return {answers:answers(packet.questions,Array(4).fill(plans[0]))};}}),{name:'AbortError'});assert.equal(calls,1);
});

async function budgetFallback(mode){
 const first='a latte-flavored croissant with '+Array.from({length:18},(_,index)=>'note'+index).join(' and ');
 const text=[first,'one Americano','one Americano','one Americano','one Americano'].join('; ');
 const pastry=directory.products.find(product=>product.name==='Butter Croissant');let cached,logical=0,network=0,wrongSpeculation=0;
 const response=packet=>{
  const state=JSON.parse(packet.state),questions=packet.questions;
  const values=Object.fromEntries(Object.entries(questions).map(([key,question])=>{
   if(/^b\d+$/.test(key)){const boundary=state.boundaries.find(item=>item.id===key);return [key,text[boundary.offset]===';'?'split':'continue'];}
   if(/^c\d+_/.test(key)){const [,index,field]=key.match(/^c(\d+)_(.+)$/);return [key,index==='4'&&field==='coverage'?'unproven':plans[0][field]];}
   const identity=state.transcript.includes('croissant')?pastry.identity:'406:Hot';
   const group=groups.find(item=>item.products.some(product=>product.identity===identity)).id;
   if(key==='identity'&&!Object.hasOwn(question.criteria,identity)){wrongSpeculation++;return [key,'unchanged'];}
   return [key,({coverage:'complete',action:'add',productGroup:group,identity,target:'none',targetScope:'item',replacementRequested:'absent',sizeRequested:'absent',quantityRequested:'absent',quantity:'1',size:'unchanged',singleAddQuantity:'detail'})[key]];
  }));
  return {answers:Object.fromEntries(Object.entries(questions).map(([key,question])=>{const value=values[key],keys=Object.keys(question.criteria);assert.ok(keys.includes(value),key+':'+value);return [key,{type:'choice',choice:value,probabilities:Object.fromEntries(keys.map(candidate=>[candidate,candidate===value?.99:.01/(keys.length-1)]))}];}))};
 };
 let owner,ownerTransport,release,entered,gets=0;
 const started=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 const cache={keyFor:async context=>{
  const packet=JSON.parse(context.body);
  if(Object.keys(packet.questions).every(key=>/^b\d+$/.test(key))){
   if(Object.hasOwn(packet.questions,'b0')&&mode==='inflight'&&!owner){
    owner=true;owner=ownerTransport.post('decisions',packet);await started;
   }else if(mode!=='inflight'||!Object.hasOwn(packet.questions,'b0')||gets>0)logical++;
   if(Object.hasOwn(packet.questions,'b0')){cached=response(packet);return 'a'.repeat(64);}
  }
  return undefined;
 },get:()=>{gets++;if(mode==='inflight'){if(gets===2)queueMicrotask(release);return undefined;}return cached;},set(){}};
 ownerTransport=createDecisionTransport({apiKey:'budget-test',cache,model:'fixture',questionProfile:'lean-v10',menuVersion:'fixture',fetchImpl:async()=>{entered();await gate;return Response.json(cached);}});
 const adapter=createMenuDeciderAdapter({apiKey:'budget-test',cache,scheduling:'guarded-overlap',fetchImpl:async(url,init)=>{network++;const packet=JSON.parse(init.body);if(!Object.keys(packet.questions).every(key=>/^b\d+$/.test(key)))logical++;return Response.json(response(packet));}});
 const result=await adapter.interpretTurn({text,order:createOrder()});assert.equal(result.clarification,null);assert.equal(result.commands.length,5);assert.equal(result.commands[0].identity,pastry.identity);assert.equal(result.metrics[mode==='inflight'?'inflightHits':'cacheHits'],1);if(mode==='inflight'){await owner;assert.equal(ownerTransport.attemptsUsed,1);}else assert.equal(logical,20);assert.equal(network,19);assert.equal(result.metrics.totalRequests,19);assert.equal(wrongSpeculation,0);
}
for(const mode of ['hit','inflight'])test(`${mode} boundary attempts reserve five-clause fallback without wrong-group speculation`,()=>budgetFallback(mode));

test('batch questions separate prepared coffee from packaged coffee and copies from menu lines',async()=>{
 await run({post:async(route,packet)=>{
  for(const prefix of ['c0','c1']){
   const group=packet.questions[prefix+'_group'];
   assert.match(group.criteria.group_0,/prepared.*coffee.*espresso/i);assert.match(group.criteria.group_0,/not packaged/i);
   assert.match(group.criteria.group_2,/packaged.*beans.*grounds.*VIA/i);assert.match(group.criteria.group_2,/not prepared/i);
   const coverage=packet.questions[prefix+'_coverage'];assert.match(coverage.instructions,/one independent menu line/i);assert.match(coverage.instructions,/1–100 copies/i);assert.match(coverage.criteria.complete,/copies/i);
   const size=packet.questions[prefix+'_size'];assert.match(size.instructions,/negated/i);assert.match(size.instructions,/only.*exclusions.*__source_invalid__/i);
  }
  return {answers:answers(packet.questions)};
 }});
});

test('explicit shared-clause prefixes skip speculative batches without matching local modifier words',async()=>{
 for(const text of [', both with oat milk','and both with oat milk','all with oat milk','each with oat milk','; then all with oat milk']){
  const result=await run({clauses:[...clauses,{text}],post:()=>assert.fail('shared scope must use existing pipeline')});assert.equal(result,null);
 }
 const local=[{text:'one latte with both vanilla and caramel'},{text:'and one cold brew'}];
 const commands=await run({clauses:local});assert.equal(commands.length,2);assert.deepEqual(commands[0].instructions,[local[0].text]);
});
