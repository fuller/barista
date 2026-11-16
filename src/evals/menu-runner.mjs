import {createHash} from 'node:crypto';
import directory from '../catalog/data/starbucks-menu-directory.json' with {type:'json'};
import {createMenuDeciderAdapter} from '../adapters/menu-decider.mjs';
import {DEFAULT_MODEL} from '../adapters/config.mjs';
import {createOrder,applyCommands} from '../domain/order.mjs';
import {quoteOrder} from '../domain/pricing.mjs';
import {CLARIFICATION_STAGES,CLARIFICATION_REASONS} from '../adapters/clarification.mjs';
const products=new Map(directory.products.map(p=>[p.identity,p]));
const commandTypes=new Set(['add-menu','update-menu','duplicate','remove','undo','clear','confirm']);
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const note=text=>text.toLowerCase().replace(/\s+/gu,' ').trim();
const effectiveSize=item=>item.size??(products.get(item.identity)?.sizes.length===1?products.get(item.identity).sizes[0].sizeCode:null);
const notePrefix=(actual,required)=>actual.length>=required.length&&required.every((text,index)=>note(text)===note(actual[index]));
export const menuHash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export function validateMenuCases(input){
 const cases=Array.isArray(input)?input:input?.cases;
 if(!Array.isArray(cases)||!cases.length||!Array.isArray(input)&&input.schemaVersion!==1)throw new Error('Invalid menu corpus');
 if(!Array.isArray(input)&&input.menuVersion!==directory.version)throw new Error('Menu corpus source version mismatch');
 const ids=new Set();
 for(const c of cases){
  if(typeof c.id!=='string'||!/^[a-zA-Z0-9._-]{1,100}$/.test(c.id)||ids.has(c.id)||!['dev','holdout'].includes(c.split)||typeof c.text!=='string'||!c.text.trim()||c.text.length>600||!Array.isArray(c.seedCommands)||!Array.isArray(c.tags)||c.tags.some(t=>typeof t!=='string'||t.length>100)||!['commit','clarify'].includes(c.expected?.outcome)||!Array.isArray(c.expected.items))throw new Error('Invalid menu corpus');
  ids.add(c.id);let seed=createOrder();if(c.seedCommands.length)seed=applyCommands(seed,c.seedCommands);if(seed.items.length)throw new Error('Menu corpus seeds require directory lines');
  if(c.activeItemId!==undefined&&!seed.menuItems?.some(item=>item.id===c.activeItemId))throw new Error('Invalid menu corpus target');
  for(const item of c.expected.items){const product=products.get(item.identity);if(!product||!Object.hasOwn(item,'size')||item.size!==null&&!product.sizes.some(s=>s.sizeCode===item.size)||!Number.isSafeInteger(item.quantity)||item.quantity<1||item.quantity>100)throw new Error('Invalid menu corpus gold');for(const key of ['instructionIncludes','instructionExcludes'])if(item[key]!==undefined&&(!Array.isArray(item[key])||item[key].some(s=>typeof s!=='string'||!s.trim()||s.length>600)))throw new Error('Invalid menu corpus notes');}
  if(c.expected.expectedCommandTypes!==undefined&&(!Array.isArray(c.expected.expectedCommandTypes)||c.expected.expectedCommandTypes.some(type=>!commandTypes.has(type))))throw new Error('Invalid menu corpus commands');
  if(c.expected.confirmed!==undefined&&typeof c.expected.confirmed!=='boolean')throw new Error('Invalid menu corpus confirmation');
 }
 return {cases,caseCount:cases.length,corpusSHA:menuHash(input),menuVersion:directory.version};
}
export function gradeMenuResult({before,after,result,expected,status='completed',inputMutated=false}){
 const failures=[];const fail=(code,index)=>failures.push({code,...(index===undefined?{}:{itemIndex:index})});
 const commands=Array.isArray(result?.commands)?result.commands:[];
 const clarified=typeof result?.clarification==='string'&&result.clarification.length>0;
 if(status!=='completed')fail(status==='not_run_budget'||status==='budget_exhausted'?'request_budget':status==='error'?'adapter_error':status);
 if(inputMutated)fail('input_mutated');
 if(!Array.isArray(result?.commands))fail('invalid_commands');
 if(expected.outcome==='clarify'){
  if(!clarified)fail('missing_clarification');if(commands.length||!equal(before,after))fail('clarification_mutation');
 }else{
  if(clarified)fail('false_clarification');if(!commands.length)fail('missing_commit');if(commands.length&&after.revision!==before.revision+1)fail('non_atomic_revision');
 }
 if(expected.expectedCommandTypes&&!equal(commands.map(c=>c.type),expected.expectedCommandTypes))fail('wrong_command_types');
 const actual=after.menuItems??[];
 if(actual.length!==expected.items.length)fail('wrong_item_count');
 for(let i=0;i<Math.max(actual.length,expected.items.length);i++){
  const item=actual[i],gold=expected.items[i];if(!item||!gold)continue;
  if(item.identity!==gold.identity)fail('wrong_identity',i);if(effectiveSize(item)!==effectiveSize(gold))fail('wrong_size',i);if(item.quantity!==gold.quantity)fail('wrong_quantity',i);
  const notes=note(item.instructions.join(' '));for(const snippet of gold.instructionIncludes??[])if(!notes.includes(note(snippet)))fail('missing_instruction',i);for(const snippet of gold.instructionExcludes??[])if(notes.includes(note(snippet)))fail('wrong_instruction_scope',i);
 }
 if(!commands.some(c=>c.type==='undo'))for(const prior of before.menuItems??[]){const current=actual.find(item=>item.id===prior.id);if(current&&!notePrefix(current.instructions,prior.instructions))fail('lost_seed_instruction');}
 const lineage=new Map((before.menuItems??[]).map(item=>[item.id,item.instructions]));let nextId=before.nextId;const copiedPrefixes=[];
 for(const command of commands){
  if(command.type==='add-menu')lineage.set(`menu-${nextId++}`,command.instructions??[]);
  else if(command.type==='add')nextId++;
  else if(command.type==='update-menu'&&lineage.has(command.itemId))lineage.set(command.itemId,command.changes?.instructions??lineage.get(command.itemId));
  else if(command.type==='duplicate'){const id=`${command.itemId.startsWith('menu-')?'menu':'drink'}-${nextId++}`,prior=lineage.get(command.itemId);if(prior){copiedPrefixes.push({id,prior});lineage.set(id,command.changes?.instructions??prior);}}
  else if(command.type==='remove')lineage.delete(command.itemId);
  else if(command.type==='clear')lineage.clear();
 }
 for(const {id,prior} of copiedPrefixes){const current=actual.find(item=>item.id===id);if(current&&!notePrefix(current.instructions,prior))fail('lost_duplicate_instruction');}
 if(!equal(before.items,after.items))fail('unexpected_legacy_mutation');
 if(after.confirmed!==(expected.confirmed??(expected.outcome==='clarify'?before.confirmed:false)))fail('wrong_confirmation');
 if(actual.length){const quote=quoteOrder(after);if(quote.totalCents!==null||quote.subtotalCents!==null||quote.unpricedItemCount!==actual.reduce((n,p)=>n+p.quantity,0))fail('unknown_price_misrepresented');}
 const unsafe=inputMutated||failures.some(f=>['clarification_mutation','non_atomic_revision','unexpected_legacy_mutation'].includes(f.code));
 const category=failures.length===0?'pass':status!=='completed'?'error':unsafe?(expected.outcome==='clarify'?'bad_clarification':'wrong_mutation'):failures.some(f=>f.code==='false_clarification')?'false_clarification':expected.outcome==='clarify'?'bad_clarification':'wrong_mutation';
 return {pass:failures.length===0,category,failures,unsafeMutation:unsafe};
}
const emptyUsage=()=>({available:false,promptTokens:null,completionTokens:null,totalTokens:null,cachedTokens:null,costUSD:null});
function usageOf(payload){const usage=payload?.usage;if(!usage||typeof usage!=='object')return emptyUsage();const number=(...keys)=>{for(const key of keys)if(Number.isSafeInteger(usage[key])&&usage[key]>=0)return usage[key];return null;};const result={promptTokens:number('prompt_tokens','input_tokens'),completionTokens:number('completion_tokens','output_tokens'),totalTokens:number('total_tokens'),cachedTokens:[usage.input_tokens_details?.cached_tokens,usage.prompt_tokens_details?.cached_tokens].find(value=>Number.isSafeInteger(value)&&value>=0)??null,costUSD:Number.isFinite(usage.cost)&&usage.cost>=0?usage.cost:null};return {available:['promptTokens','completionTokens','totalTokens'].some(key=>result[key]!==null),...result};}
function usageSummary(requests){const result={available:requests.length>0&&requests.every(r=>r.usage.available)};for(const key of ['promptTokens','completionTokens','totalTokens','cachedTokens','costUSD'])result[key]=requests.length>0&&requests.every(r=>r.usage[key]!==null)?requests.reduce((sum,r)=>sum+r.usage[key],0):null;return result;}
const traceFields=new Set(['coverage','action','identity','productGroup','target','replacementRequested','sizeRequested','size','quantityRequested','quantity']);
function safeDiagnostics(value){if(!value||typeof value!=='object')return undefined;const result={};if(CLARIFICATION_STAGES.includes(value.stage))result.stage=value.stage;if(traceFields.has(value.field))result.field=value.field;if(CLARIFICATION_REASONS.includes(value.reason))result.reason=value.reason;return Object.keys(result).length?result:undefined;}
const safeClarification=value=>typeof value==='string'&&value.length>0&&value.length<=1000&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)?value:null;
function safeError(error){return {code:error?.evalBudget?'request_budget_exhausted':['AbortError','TimeoutError'].includes(error?.name)?'aborted':/^Invalid decision|^Invalid extraction/.test(error?.message??'')?'invalid_provider_response':error instanceof TypeError||/Decision service unavailable|fetch failed/i.test(error?.message??'')?'transport_error':'adapter_error'};}
function redact(value,secret){if(typeof value==='string')return secret?value.replaceAll(secret,'[redacted]'):value;if(Array.isArray(value))return value.map(item=>redact(item,secret));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,redact(item,secret)]));return value;}
export async function runMenuEvaluation(input,{apiKey,model=DEFAULT_MODEL,profile='lean-v9',repeats=1,maxRequests=160,concurrency=3,fetchImpl=fetch,adapterFactory,corpusSHA,clock=()=>performance.now()}={}){
 const validation=validateMenuCases(input),cases=validation.cases;
 if(!['lean-v8','lean-v9'].includes(profile)||!Number.isInteger(repeats)||repeats<1||repeats>20||!Number.isInteger(maxRequests)||maxRequests<0||maxRequests>5000||!Number.isInteger(concurrency)||concurrency<1||concurrency>3||typeof model!=='string'||!/^[\w./:-]{1,160}$/.test(model))throw new Error('Invalid menu evaluation bounds');
 const startedAt=new Date().toISOString(),tasks=Array.from({length:repeats},(_,repeat)=>cases.map(c=>({c,repeat}))).flat(),results=Array(tasks.length);let next=0,dispatches=0;
 async function execute({c,repeat}){
  let before=createOrder();if(c.seedCommands.length)before=applyCommands(before,c.seedCommands);const original=structuredClone(before),requests=[],started=clock();let result={commands:[],clarification:null},after=before,status='completed',error;
  const meteredFetch=async(url,init)=>{
   if(dispatches>=maxRequests)throw Object.assign(new Error('Menu eval request budget exhausted'),{evalBudget:true});
   dispatches++;const body=typeof init?.body==='string'?init.body:'';const request={route:String(url).endsWith('/extractions')?'extractions':String(url).endsWith('/decisions')?'decisions':'other',requestBodyBytes:new TextEncoder().encode(body).length,requestBodyChars:Array.from(body).length,status:null,latencyMs:0,usage:emptyUsage()};requests.push(request);const began=clock();
   try{const response=await fetchImpl(url,init);request.status=response.status;try{request.usage=usageOf(await response.clone().json());}catch{}return response;}finally{request.latencyMs=Math.max(0,clock()-began);}
  };
  try{const adapter=adapterFactory?adapterFactory({apiKey,model,questionProfile:profile,fetchImpl:meteredFetch}):createMenuDeciderAdapter({apiKey,model,questionProfile:profile,fetchImpl:meteredFetch});result=await adapter.interpretTurn({text:c.text,order:before,...(c.activeItemId?{activeItemId:c.activeItemId}:{})});if(result.commands?.length)after=applyCommands(before,result.commands);}
  catch(caught){error=safeError(caught);status=caught?.evalBudget?'budget_exhausted':'error';result={commands:[],clarification:null};}
  const inputMutated=!equal(before,original);let grade;
  try{grade=gradeMenuResult({before:original,after,result,expected:c.expected,status,inputMutated});}catch{grade={pass:false,category:'error',failures:[{code:'invalid_final_order'}],unsafeMutation:inputMutated};}
  return {caseId:c.id,split:c.split,tags:c.tags,repeat,expectedOutcome:c.expected.outcome,status,...grade,latencyMs:Math.max(0,clock()-started),requestCount:requests.length,requestBodyBytes:requests.reduce((n,r)=>n+r.requestBodyBytes,0),requestBodyChars:requests.reduce((n,r)=>n+r.requestBodyChars,0),usage:usageSummary(requests),requests,...(error?{error}:{}),actual:{commandTypes:result.commands?.map(c=>c.type)??[],clarified:!!result.clarification,clarification:safeClarification(result.clarification),diagnostics:safeDiagnostics(result.diagnostics),items:(after.menuItems??[]).map(({id,identity,name,size,quantity,instructions})=>({id,identity,name,size,quantity,instructions})),confirmed:after.confirmed,reason:safeDiagnostics(result.diagnostics)?.reason??null}};
 }
 async function worker(){for(;;){if(next>=tasks.length||dispatches>=maxRequests)return;const index=next++;results[index]=await execute(tasks[index]);}}
 await Promise.all(Array.from({length:Math.min(concurrency,tasks.length)},()=>worker()));
 for(let i=0;i<tasks.length;i++)if(!results[i]){const {c,repeat}=tasks[i];results[i]={caseId:c.id,split:c.split,tags:c.tags,repeat,expectedOutcome:c.expected.outcome,status:'not_run_budget',pass:false,category:'error',failures:[{code:'request_budget'}],unsafeMutation:false,latencyMs:0,requestCount:0,requestBodyBytes:0,requestBodyChars:0,usage:emptyUsage(),requests:[]};}
 const allRequests=results.flatMap(r=>r.requests),latencies=results.filter(r=>r.status!=='not_run_budget').map(r=>r.latencyMs).sort((a,b)=>a-b);
 const summary={cases:results.length,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,requests:dispatches,requestBodyBytes:allRequests.reduce((n,r)=>n+r.requestBodyBytes,0),requestBodyChars:allRequests.reduce((n,r)=>n+r.requestBodyChars,0),usage:usageSummary(allRequests),categories:Object.fromEntries(['pass','wrong_mutation','false_clarification','bad_clarification','error'].map(key=>[key,results.filter(r=>r.category===key).length])),unsafeMutations:results.filter(r=>r.unsafeMutation).length,notRun:results.filter(r=>r.status==='not_run_budget').length,latency:{medianMs:latencies.length?latencies[Math.floor((latencies.length-1)/2)]:null,p95Ms:latencies.length?latencies[Math.ceil(latencies.length*.95)-1]:null}};
 return redact({schemaVersion:1,manifest:{startedAt,finishedAt:new Date().toISOString(),model,profile,corpusSHA:corpusSHA??validation.corpusSHA,menuVersion:directory.version,repeats,maxRequests,concurrency,caseIds:cases.map(c=>c.id)},summary,results},apiKey);
}
