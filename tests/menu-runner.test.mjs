import test from 'node:test';
import assert from 'node:assert/strict';
import directory from '../src/catalog/data/starbucks-menu-directory.json' with {type:'json'};
import {createOrder,applyCommands} from '../src/domain/order.mjs';
import {gradeMenuResult,runMenuEvaluation,validateMenuCases} from '../src/evals/menu-runner.mjs';
import {parseMenuArgs} from '../scripts/evaluate-menu.mjs';
const identity='406:Hot',other='407:Hot';
const sample=(extra={})=>({id:'dev-basic',split:'dev',text:'one Americano',seedCommands:[],tags:['plain'],expected:{outcome:'commit',items:[{identity,size:null,quantity:1,instructionIncludes:['one Americano']}],expectedCommandTypes:['add-menu']},...extra});
const add=(id=identity,text='one Americano')=>({type:'add-menu',identity:id,instructions:[text]});
function grade(command=add(),gold=sample().expected){const before=createOrder(),after=applyCommands(before,[command]);return gradeMenuResult({before,after,result:{commands:[command],clarification:null},expected:gold});}
function answer(q,value){return {type:'choice',choice:value,probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k===value?1:0]))};}
function mockProvider({chosen=identity,usage}={}){return async(_url,init)=>{const p=JSON.parse(init.body);const values={coverage:'complete',action:'add',replacementRequested:'absent',productGroup:Object.keys(p.questions.productGroup?.criteria??{}).find(k=>p.questions.productGroup.criteria[k]==='Beverage'),target:'none',sizeRequested:'absent',size:'unchanged',quantityRequested:'absent',quantity:'1',targetScope:'item',identity:chosen,singleAddQuantity:'single'};return Response.json({answers:Object.fromEntries(Object.entries(p.questions).map(([k,q])=>[k,answer(q,values[k])])),...(usage?{usage}:{})});};}
test('gold validation rejects unknown identities, invalid sizes and duplicate case IDs',()=>{
 assert.throws(()=>validateMenuCases([sample(),sample()]));assert.throws(()=>validateMenuCases([sample({expected:{outcome:'commit',items:[{identity:'fake',size:null,quantity:1}]}})]));assert.throws(()=>validateMenuCases([sample({expected:{outcome:'commit',items:[{identity,size:'wrong',quantity:1}]}})]));
});
test('grader rejects wrong identity, size, count, lost modifiers and scope leakage',()=>{
 assert.equal(grade().pass,true);assert.equal(grade(add(other)).pass,false);assert.equal(grade({...add(),size:'Tall'}).failures.some(f=>f.code==='wrong_size'),true);assert.equal(grade({...add(),quantity:2}).failures.some(f=>f.code==='wrong_quantity'),true);
 const gold={...sample().expected,items:[{identity,size:null,quantity:1,instructionIncludes:['oat milk'],instructionExcludes:['whole milk']}]};assert.equal(grade(add(identity,'Americano'),gold).failures.some(f=>f.code==='missing_instruction'),true);assert.equal(grade(add(identity,'oat milk and whole milk'),gold).failures.some(f=>f.code==='wrong_instruction_scope'),true);
});
test('sole source size and source default are equivalent, multi-size requests remain exact',()=>{
 const sole=directory.products.find(p=>p.sizes.length===1),size=sole.sizes[0].sizeCode;
 const gold={outcome:'commit',items:[{identity:sole.identity,size,quantity:1}]};assert.equal(grade(add(sole.identity,'source item'),gold).pass,true);
 assert.equal(grade({...add(),size:'Tall'},{outcome:'commit',items:[{identity,size:'Venti',quantity:1}]}).pass,false);assert.equal(grade(add(),{outcome:'commit',items:[{identity,size:'Grande',quantity:1}]}).pass,false);
});
test('seed instruction history must survive an otherwise correct update',()=>{
 const before=applyCommands(createOrder(),[add(identity,'original oat milk')]);const command={type:'update-menu',itemId:'menu-1',changes:{instructions:['new change']}};const after=applyCommands(before,[command]);const result=gradeMenuResult({before,after,result:{commands:[command],clarification:null},expected:{outcome:'commit',items:[{identity,size:null,quantity:1}]}});assert.equal(result.pass,false);assert.ok(result.failures.some(f=>f.code==='lost_seed_instruction'));
});
test('false clarification, mutated clarification and errors are distinct failures',()=>{
 const before=createOrder();const falseClarify=gradeMenuResult({before,after:before,result:{commands:[],clarification:'Say again'},expected:sample().expected});assert.equal(falseClarify.category,'false_clarification');
 const command=add(),after=applyCommands(before,[command]);const bad=gradeMenuResult({before,after,result:{commands:[command],clarification:'Say again'},expected:{outcome:'clarify',items:[]}});assert.equal(bad.category,'bad_clarification');assert.equal(bad.unsafeMutation,true);
 const error=gradeMenuResult({before,after:before,result:{commands:[],clarification:'Say again'},expected:{outcome:'clarify',items:[]},status:'error'});assert.equal(error.pass,false);assert.equal(error.category,'error');
});
test('actual menu adapter profiles run through metered fetch and report real provider usage',async()=>{
 for(const profile of ['lean-v8','lean-v9']){const report=await runMenuEvaluation([sample()],{apiKey:'test',profile,fetchImpl:mockProvider({usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110}})});assert.equal(report.results[0].pass,true);assert.equal(report.summary.requests,profile==='lean-v8'?3:2);assert.equal(report.summary.usage.promptTokens,profile==='lean-v8'?300:200);assert.equal(report.summary.usage.totalTokens,profile==='lean-v8'?330:220);assert.equal(report.manifest.profile,profile);assert.ok(report.summary.requestBodyBytes>0);assert.ok(report.results[0].requests.every(r=>r.requestBodyChars>0));}
});
test('wrong actual model selection cannot pass a commit gold',async()=>{
 const report=await runMenuEvaluation([sample()],{apiKey:'test',fetchImpl:mockProvider({chosen:other})});assert.equal(report.summary.passed,0);assert.equal(report.results[0].category,'wrong_mutation');assert.ok(report.results[0].failures.some(f=>f.code==='wrong_identity'));
});
test('missing token usage stays null and unavailable, even when only cost exists',async()=>{
 for(const usage of [undefined,{cost:0}]){const report=await runMenuEvaluation([sample()],{apiKey:'test',fetchImpl:mockProvider({usage})});assert.equal(report.summary.usage.available,false);assert.equal(report.summary.usage.promptTokens,null);assert.equal(report.summary.usage.completionTokens,null);assert.equal(report.summary.usage.totalTokens,null);}
});
test('global dispatch cap stops new cases, retains interrupted cases and never overshoots',async()=>{
 let calls=0;const report=await runMenuEvaluation(Array.from({length:5},(_,i)=>sample({id:'dev-'+i})),{apiKey:'test',maxRequests:1,fetchImpl:async(...args)=>{calls++;return mockProvider()(...args);}});assert.equal(calls,1);assert.equal(report.summary.requests,1);assert.equal(report.results.length,5);assert.equal(report.summary.passed,0);assert.ok(report.results.some(r=>r.status==='budget_exhausted'));assert.ok(report.results.some(r=>r.status==='not_run_budget'));
});
test('independent cases run with bounded concurrency and preserve result ordering',async()=>{
 let active=0,max=0;const report=await runMenuEvaluation(Array.from({length:5},(_,i)=>sample({id:'dev-'+i})),{apiKey:'test',concurrency:3,fetchImpl:async(...args)=>{active++;max=Math.max(max,active);await new Promise(resolve=>setTimeout(resolve,2));active--;return mockProvider()(...args);}});assert.ok(max>1&&max<=3);assert.equal(report.summary.passed,5);assert.deepEqual(report.results.map(r=>r.caseId),['dev-0','dev-1','dev-2','dev-3','dev-4']);
});
test('input mutation and missing commit cannot be reported as success',async()=>{
 const c=sample({seedCommands:[add(identity,'seed note')],expected:{outcome:'commit',items:[{identity,size:null,quantity:1}]}});const report=await runMenuEvaluation([c],{apiKey:'test',adapterFactory:()=>({interpretTurn:async({order})=>{order.menuItems[0].instructions=[];return {commands:[],clarification:null};}})});assert.equal(report.summary.passed,0);assert.equal(report.results[0].unsafeMutation,true);assert.ok(report.results[0].failures.some(f=>f.code==='input_mutated'));
});
test('provider exceptions stay errors and cannot expose credentials in reports',async()=>{
 const secret='sk-never-print-this-key';const report=await runMenuEvaluation([sample({expected:{outcome:'clarify',items:[]}})],{apiKey:secret,fetchImpl:async()=>{throw new Error('Bearer '+secret);}});assert.equal(report.summary.passed,0);assert.equal(report.results[0].status,'error');assert.ok(!JSON.stringify(report).includes(secret));
});
test('dry CLI arguments are explicit, bounded and profile selectable',()=>{
 assert.equal(parseMenuArgs([]).live,false);assert.equal(parseMenuArgs(['--live','--profile','lean-v8','--max-requests','160']).live,true);assert.throws(()=>parseMenuArgs(['--profile','unknown']));assert.throws(()=>parseMenuArgs(['--max-requests','-1']));assert.throws(()=>parseMenuArgs(['--concurrency','4']));
});
test('reordered or collapsed surviving seed history cannot pass',()=>{
 const before=applyCommands(createOrder(),[{...add(),instructions:['first note','second note']}]);for(const instructions of [['second note','first note'],['first note second note']]){const command={type:'update-menu',itemId:'menu-1',changes:{instructions}},after=applyCommands(before,[command]);const result=gradeMenuResult({before,after,result:{commands:[command],clarification:null},expected:{outcome:'commit',items:[{identity,size:null,quantity:1}]}});assert.equal(result.pass,false);assert.ok(result.failures.some(f=>f.code==='lost_seed_instruction'));}
});
test('copied lines must retain source instruction prefix even with new IDs',()=>{
 const before=applyCommands(createOrder(),[{...add(),instructions:['original oat milk']}]);const command={type:'duplicate',itemId:'menu-1',changes:{instructions:['new duplicate']}},after=applyCommands(before,[command]);const result=gradeMenuResult({before,after,result:{commands:[command],clarification:null},expected:{outcome:'commit',items:[{identity,size:null,quantity:1},{identity,size:null,quantity:1}]}});assert.equal(result.pass,false);assert.ok(result.failures.some(f=>f.code==='lost_duplicate_instruction'));
});
test('undo intentionally restores earlier instruction history',()=>{
 const original=applyCommands(createOrder(),[{...add(),instructions:['original note']}]),before=applyCommands(original,[{type:'update-menu',itemId:'menu-1',changes:{instructions:['original note','later note']}}]),command={type:'undo'},after=applyCommands(before,[command]);const result=gradeMenuResult({before,after,result:{commands:[command],clarification:null},expected:{outcome:'commit',items:[{identity,size:null,quantity:1,instructionIncludes:['original note'],instructionExcludes:['later note']}]}});assert.equal(result.pass,true);
});
test('reports retain bounded clarification text and allowlisted diagnostic traces only',async()=>{
 const secret='sk-never-print-this-key';const report=await runMenuEvaluation([sample({expected:{outcome:'clarify',items:[]}})],{apiKey:secret,adapterFactory:()=>({interpretTurn:async()=>({commands:[],clarification:'Please clarify item '+secret,diagnostics:{stage:'decision',field:'identity',reason:'decision_low_confidence',providerBody:'never-copy-provider-body',transcript:'never-copy-transcript'}})})});
 assert.equal(report.results[0].pass,true);assert.equal(report.results[0].actual.clarification,'Please clarify item [redacted]');assert.deepEqual(report.results[0].actual.diagnostics,{stage:'decision',field:'identity',reason:'decision_low_confidence'});assert.ok(!JSON.stringify(report).includes(secret));assert.ok(!JSON.stringify(report).includes('never-copy-provider-body'));
});
test('invalid diagnostics and oversized clarification payloads do not enter reports',async()=>{
 const report=await runMenuEvaluation([sample({expected:{outcome:'clarify',items:[]}})],{apiKey:'test',adapterFactory:()=>({interpretTurn:async()=>({commands:[],clarification:'x'.repeat(1001),diagnostics:{stage:'provider-raw',field:'Authorization',reason:'Bearer raw'}})})});assert.equal(report.results[0].actual.clarification,null);assert.equal(report.results[0].actual.diagnostics,undefined);assert.equal(report.results[0].actual.reason,null);
});

test('lean-v8 is explicit and preserves strict item grading',async()=>{
 assert.equal(parseMenuArgs(['--profile','lean-v8']).profile,'lean-v8');assert.equal(parseMenuArgs([]).profile,'lean-v9');let seen;const report=await runMenuEvaluation([sample()],{apiKey:'test',profile:'lean-v8',adapterFactory:options=>{seen=options.questionProfile;return {interpretTurn:async()=>({commands:[add(other)],clarification:null})};}});assert.equal(seen,'lean-v8');assert.equal(report.results[0].pass,false);assert.ok(report.results[0].failures.some(f=>f.code==='wrong_identity'));
});
test('lean-v8 is opt-in and keeps strict grading',async()=>{
 assert.equal(parseMenuArgs(['--profile','lean-v8']).profile,'lean-v8');let seen;
 const report=await runMenuEvaluation([sample()],{profile:'lean-v8',adapterFactory:options=>{seen=options.questionProfile;return {interpretTurn:async()=>({commands:[add(other)],clarification:null})};}});
 assert.equal(seen,'lean-v8');assert.equal(report.results[0].pass,false);
});
test('cached provider tokens are sanitized and unknown observations stay null',async()=>{
 for(const [usage,expected] of [[{input_tokens_details:{cached_tokens:12}},12],[{prompt_tokens_details:{cached_tokens:0}},0],[{input_tokens_details:{cached_tokens:-1}},null],[{input_tokens_details:{cached_tokens:'12'}},null],[{input_tokens_details:{cached_tokens:1.5}},null],[{},null]]){
  const report=await runMenuEvaluation([sample()],{apiKey:'test',fetchImpl:mockProvider({usage})});
  assert.equal(report.results[0].requests[0].usage.cachedTokens,expected);assert.equal(report.summary.usage.cachedTokens,expected===null?null:expected*2);
 }
 let count=0;const report=await runMenuEvaluation([sample()],{apiKey:'test',fetchImpl:async(...args)=>mockProvider({usage:++count===1?{input_tokens_details:{cached_tokens:7}}:{}})(...args)});
 assert.equal(report.summary.usage.cachedTokens,null);
});
test('lean-v9 is opt-in and keeps strict grading',async()=>{
 assert.equal(parseMenuArgs(['--profile','lean-v9']).profile,'lean-v9');let seen;
 const report=await runMenuEvaluation([sample()],{profile:'lean-v9',adapterFactory:options=>{seen=options.questionProfile;return {interpretTurn:async()=>({commands:[add(other)],clarification:null})};}});
 assert.equal(seen,'lean-v9');assert.equal(report.results[0].pass,false);
});
