import {readDecisionChoice} from './decision-choice.mjs';
import {buildMenuIdentityPacket} from './menu-identity.mjs';
const choice=(instructions,criteria)=>({type:'choice',instructions,criteria});
const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
export async function tryMenuAddBatch({clauses,groups,post,signal,threshold=.85,margin=.15,requests=0}){
 if(!Array.isArray(clauses)||clauses.length<2||clauses.length>6||requests+Math.ceil(clauses.length/2)+3*clauses.length>20)return null;
 if(clauses.some(clause=>/^[\s,;]*(?:(?:and|then|plus|also|but)\b[\s,;]*)*(?:both|all|each)\b/i.test(clause.text)))return null;
 const candidates=groups.filter(group=>group.products.length&&group.products.every(product=>product.productType==='Beverage'));
 if(candidates.length!==1||candidates[0].products.length>253)return null;
 const group=candidates[0],products=new Map(group.products.map(product=>[product.identity,product]));
 const sizes=[...new Set(group.products.flatMap(product=>product.sizes.map(size=>size.sizeCode)))];
 if(sizes.length>252||groups.length>253)return null;
 const groupChoices={unchanged:'No unique offered menu group',...Object.fromEntries(groups.map(item=>[item.id,item.products.every(product=>product.productType==='Beverage')?'Prepared coffee, espresso, cold brew, tea and other drinks; not packaged beans or grounds':item.products.every(product=>product.productType==='Coffee')?'Packaged coffee beans, grounds and VIA; not prepared drinks or cups of coffee':item.products.every(product=>product.productType==='Food')?'Food, bakery and snacks; not prepared drinks or packaged coffee':item.label]))};
 const commands=[];
 for(let offset=0;offset<clauses.length;offset+=2){
  signal?.throwIfAborted();
  const batch=clauses.slice(offset,offset+2),questions={},state={clauses:batch.map((clause,index)=>({id:'c'+(offset+index),transcript:clause.text})),rules:'Each cN owns only its exact transcript. Other clauses cannot supply its product, count, size or customization. Preserve every source word; shared dependent edits and references are not independent additions.'};
  for(const [index,clause] of batch.entries()){
   const id='c'+(offset+index),scope=`For ${id} ONLY, ignoring every other clause: `;
   questions[id+'_coverage']=choice(scope+'does this entire source express ONE independent menu line/base product with 1–100 copies and all customizations local to that line? Two identical drinks are two copies of ONE line, not multiple independent products. Unspecified count/size/form permit ordinary defaults. Ingredient numbers are not item copies. Shared modifiers, ordinal/pronoun targets, references to other items, missing base products, unresolved conflicting requests or multiple distinct base products or independently customized lines are unproven.',{complete:'One independent menu line with one or more copies; no dependency on another clause or cart line',unproven:'Not one proven independent menu line'});
   questions[id+'_action']=choice(scope+'is this a NEW menu line? Noun-only orders and another named product mean add one new line. Duplicate/copy/repeat an existing line, edits, removal, global actions and unresolved relative counts are other.',{add:'Add a new independently named item',other:'Any other or unresolved cart operation'});
   questions[id+'_group']=choice(scope+'choose the final base product menu group independently of the speculative identity options. Preparation, milk, shots and syrup are customization, not a different product type.',groupChoices);
   questions[id+'_identity']={...buildMenuIdentityPacket({group,text:clause.text}).questions.identity,instructions:scope+buildMenuIdentityPacket({group,text:clause.text}).questions.identity.instructions};
   questions[id+'_quantity']=choice(scope+'choose the final number of NEW LINE COPIES, 1–100. Omitted count, a/an or another named product mean one new copy. Exclude shots, pumps, ounces, ordinal positions and package contents. Never take numbers from another clause. Relative or conflicting unresolved counts, one of each, and shared copy instructions are unclear.',{unclear:'No unique absolute independent copy count',...Object.fromEntries(Array.from({length:100},(_,index)=>[String(index+1),String(index+1)]))});
   questions[id+'_size']=choice(scope+'choose the LAST explicitly requested serving size ONLY; unchanged when size is not stated. Ordinary defaults do not count as explicit size. Trenti means Trenta. Ingredient amounts and item counts are not sizes. __source_invalid__ for an unrepresented or conflicting explicit size. Exclude explicitly negated size mentions; use the final affirmative size after a correction. When only size exclusions remain with no unique requested size, choose __source_invalid__, never an excluded size. Selected identity must support the size.',{unchanged:'No explicit size; use ordinary default',__source_invalid__:'Explicit size unavailable or unresolved',...Object.fromEntries(sizes.map(size=>[size,size]))});
  }
  const response=await post('decisions',{state,questions},signal);signal?.throwIfAborted();
  if(!record(response)||response.truncated!==undefined&&typeof response.truncated!=='boolean')throw Error('Invalid batch decision response');
  if(response.truncated)return null;
  if(!record(response.answers)||Object.keys(response.answers).length!==Object.keys(questions).length||Object.keys(questions).some(key=>!Object.hasOwn(response.answers,key)))throw Error('Invalid batch decision response');
  const values=Object.fromEntries(Object.entries(questions).map(([key,question])=>[key,readDecisionChoice(response.answers[key],question,{threshold,margin})]));
  for(const [index,clause] of batch.entries()){
   const id='c'+(offset+index),value=field=>values[id+'_'+field],product=products.get(value('identity'));
   if(value('coverage')!=='complete'||value('action')!=='add'||value('group')!==group.id||!product||value('size')===null||value('size')==='__source_invalid__'||value('quantity')===null||!/^([1-9]\d?|100)$/.test(value('quantity')))return null;
   const size=value('size');if(size!=='unchanged'&&!product.sizes.some(item=>item.sizeCode===size))return null;
   commands.push({type:'add-menu',identity:product.identity,quantity:Number(value('quantity')),...(size==='unchanged'?{}:{size}),instructions:[clause.text]});
  }
 }
 return commands;
}
