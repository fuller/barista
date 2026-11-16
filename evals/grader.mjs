import {isDeepStrictEqual} from 'node:util';
import {quoteOrder} from '../src/domain/pricing.mjs';

const ingredientGroups=['syrups','sauces','sweeteners','inclusions','toppings'];
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const compareText=(a,b)=>a<b?-1:a>b?1:0;

/** Ignore generated item bookkeeping; retain every business field and drink position. */
export function normalizeItems(items){
 if(!Array.isArray(items))throw new TypeError('Items must be an array');
 return items.map(item=>{
  if(!record(item))throw new TypeError('Each item must be an object');
  const {id,explicit,...business}=structuredClone(item);
  for(const group of ingredientGroups)if(Array.isArray(business[group]))business[group].sort((a,b)=>compareText(String(a?.id),String(b?.id)));
  if(Array.isArray(business.onSide))business.onSide.sort(compareText);
  return business;
 });
}

function actualOutcome(result){
 if(result?.unavailable===true||result?.status==='unavailable')return 'unavailable';
 if(result?.error||result!=null&&!record(result))return 'invalid';
 if(result?.refusal||result?.status==='refused')return 'refused';
 const commands=result?.commands,clarification=result?.clarification;
 if(commands!==undefined&&!Array.isArray(commands)||clarification!=null&&typeof clarification!=='string')return 'invalid';
 const hasClarification=typeof clarification==='string'&&clarification.trim().length>0;
 if(commands?.length&&hasClarification)return 'invalid';
 if(hasClarification)return 'clarified';
 return commands?.length?'applied':'empty';
}

/** Compare full post-turn business state against a separately authored oracle. */
export function gradeTurn({before,after,result,expected,metrics,maxRequests}={}){
 const failures=[];
 const fail=(code,path,wanted,actual)=>failures.push({code,path,expected:wanted,actual});
 const compare=(wanted,actual,path)=>{
  if(isDeepStrictEqual(wanted,actual))return;
  if(Array.isArray(wanted)&&Array.isArray(actual)){
   if(wanted.length!==actual.length)fail(path==='items'?'item_count_mismatch':'field_mismatch',path+'.length',wanted.length,actual.length);
   for(let index=0;index<Math.max(wanted.length,actual.length);index++)compare(wanted[index],actual[index],`${path}[${index}]`);
  }else if(record(wanted)&&record(actual)){
   for(const key of [...new Set([...Object.keys(wanted),...Object.keys(actual)])].sort()){
    const child=path?`${path}.${key}`:key;
    if(!Object.hasOwn(wanted,key)||!Object.hasOwn(actual,key))fail('field_mismatch',child,wanted[key],actual[key]);
    else compare(wanted[key],actual[key],child);
   }
  }else fail('field_mismatch',path,wanted,actual);
 };

 const validExpected=record(expected)&&['applied','clarified'].includes(expected.outcome)&&Array.isArray(expected.items)&&typeof expected.confirmed==='boolean'&&Number.isSafeInteger(expected.subtotalCents)&&expected.subtotalCents>=0;
 if(!validExpected)fail('invalid_expected','expected','outcome, full items, confirmed and integer subtotalCents',expected);
 const outcome=actualOutcome(result);
 if(outcome==='unavailable')fail('unavailable','result','available','unavailable');
 if(outcome==='invalid')fail('invalid_result','result','valid adapter response','invalid');
 if(outcome!==expected?.outcome)fail('outcome_mismatch','outcome',expected?.outcome,outcome);

 const forbiddenMutation=(outcome!=='applied'||expected?.outcome==='clarified')&&!isDeepStrictEqual(before,after);
 if(forbiddenMutation)fail('unsafe_mutation','order','unchanged','changed');
 const unnecessaryClarification=outcome==='clarified'&&expected?.outcome==='applied';

 if(expected?.outcome==='applied'){
  if(!Array.isArray(result?.commands)||result.commands.length===0)fail('missing_commands','result.commands','nonempty command array',result?.commands);
  if(Number.isSafeInteger(before?.revision)&&Number.isSafeInteger(after?.revision)&&after.revision!==before.revision+1)fail('revision_not_atomic','revision',before.revision+1,after.revision);
  if(!Number.isSafeInteger(before?.revision)||!Number.isSafeInteger(after?.revision)||after.revision<=before.revision)fail('revision_not_advanced','revision',`greater than ${before?.revision}`,after?.revision);
 }
 if(Array.isArray(expected?.items)){
  try{compare(normalizeItems(expected.items),normalizeItems(after?.items),'items');}
  catch{fail('invalid_items','items','item arrays',after?.items);}
 }
 if(typeof expected?.confirmed==='boolean'&&after?.confirmed!==expected.confirmed)fail('confirmed_mismatch','confirmed',expected.confirmed,after?.confirmed);
 try{
  const subtotalCents=quoteOrder(after).subtotalCents;
  if(subtotalCents!==expected?.subtotalCents)fail('subtotal_mismatch','subtotalCents',expected?.subtotalCents,subtotalCents);
 }catch{fail('pricing_error','subtotalCents',expected?.subtotalCents,null);}
 const incorrectAppliedMutation=outcome==='applied'&&expected?.outcome==='applied'&&failures.some(({code})=>['field_mismatch','item_count_mismatch','invalid_items','confirmed_mismatch','subtotal_mismatch','pricing_error'].includes(code));
 const unsafeMutation=forbiddenMutation||incorrectAppliedMutation;

 const validBudget=Number.isSafeInteger(maxRequests)&&maxRequests>=0;
 if(!validBudget)fail('invalid_budget','maxRequests','nonnegative integer',maxRequests);
 const requestMetrics=metrics??result?.metrics;
 const validMetrics=Number.isSafeInteger(requestMetrics?.totalRequests)&&requestMetrics.totalRequests>=0;
 if(!requestMetrics||!Object.hasOwn(requestMetrics,'totalRequests'))fail('missing_metrics','metrics.totalRequests','nonnegative integer',requestMetrics?.totalRequests);
 else if(!validMetrics)fail('invalid_metrics','metrics.totalRequests','nonnegative integer',requestMetrics.totalRequests);
 const budgetExceeded=validBudget&&validMetrics&&requestMetrics.totalRequests>maxRequests;
 if(budgetExceeded)fail('budget_exceeded','metrics.totalRequests',`<= ${maxRequests}`,requestMetrics.totalRequests);

 return {pass:failures.length===0,failures,outcome,unsafeMutation,incorrectAppliedMutation,unnecessaryClarification,budgetExceeded};
}
