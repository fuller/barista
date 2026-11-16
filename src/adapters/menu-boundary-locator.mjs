import {readDecisionChoice} from './decision-choice.mjs';
const markers=/[,;\n]|\b(?:and|then|plus|also|but|actually|instead|both|all|each)\b/gi;
const connectiveOnly=text=>/^(?:\s|[,;]|\b(?:and|then|plus|also|but|actually|instead|both|all|each)\b)*$/i.test(text);
const retry=reason=>({clauses:[],failure:{mode:'retry',reason,message:'Please say no more than six items or changes at a time, preserving their instructions.'},diagnostics:{stage:'extraction',reason}});
export function menuBoundaryCandidates(text){
 const positions=[];
 for(const match of text.matchAll(markers)){
  if(match.index===0||!text.slice(0,match.index).trim())continue;
  const previous=positions.at(-1);
  if(previous!==undefined&&connectiveOnly(text.slice(previous,match.index)))continue;
  positions.push(match.index);
 }
 return positions;
}
export async function locateMenuBoundaries({text,post,signal,threshold=.85,margin=.15,boundaryProfile='baseline'}){
 if(typeof text!=='string'||!text.trim()||typeof post!=='function')throw new Error('Invalid boundary configuration');
 signal?.throwIfAborted();
 if(!['baseline','preparation-v1'].includes(boundaryProfile))throw new Error('Invalid boundary profile');
 const candidates=menuBoundaryCandidates(text);if(candidates.length>32)return retry('field_unrepresented');
 const cuts=[];
 for(let from=0;from<candidates.length;from+=16){
  signal?.throwIfAborted();const batch=candidates.slice(from,from+16),questions={};
  const boundaries=batch.map((offset,i)=>({id:'b'+(from+i),offset,unit:'UTF-16',left:text.slice(Math.max(0,offset-100),offset),right:text.slice(offset,Math.min(text.length,offset+140))}));
  for(const {id} of boundaries)questions[id]={type:'choice',instructions:`At native boundary ${id}, split only for a distinct independently requested menu item/action OR a shared dependent modifier clause applying to multiple items. Continue for a local modifier, negation, or explicit self-correction of its owning item. Food, packaged coffee and drinks all count as menu items. The same split choice covers independent and shared clauses; never infer product values. Unclear if the boundary cannot be decided confidently.`,criteria:{split:'Separate source clauses here',continue:'Keep one owning source clause',unclear:'Boundary is genuinely unclear'}};
  if(boundaryProfile==='preparation-v1')for(const question of Object.values(questions))question.instructions+=' Trailing preparation/serving/customization phrases stay with the preceding item, including plural or multiple copies: warming, toasting, temperature/negation and ingredient notes do not create another item/action by themselves. At a comma before only such a phrase, choose continue. Split only when the following words introduce a distinct item/action or an explicitly shared scope; punctuation alone is not evidence for split.';
  const response=await post('decisions',{state:{transcript:text,boundaries,rules:'Classify only the offered boundaries. Keep local customization/negation/correction with its item; shared scope remains a separate exact clause. No text generation.'},questions},signal);
  signal?.throwIfAborted();
  if(response?.truncated!==undefined&&typeof response.truncated!=='boolean')throw new Error('Invalid decision truncation');
  if(response?.truncated===true)return retry('input_truncated');
  if(!response?.answers||typeof response.answers!=='object'||Array.isArray(response.answers)||Object.keys(response.answers).length!==batch.length||Object.keys(questions).some(k=>!Object.hasOwn(response.answers,k)))throw new Error('Invalid decision boundary keys');
  let uncertain=false;
  for(const [i,{id}] of boundaries.entries()){
   const value=readDecisionChoice(response.answers[id],questions[id],{threshold,margin});
   if(value===null||value==='unclear')uncertain=true;
   else if(value==='split')cuts.push(batch[i]);
  }
  if(uncertain)return retry('decision_low_confidence');
 }
 const clauses=[];let pendingStart=null,previous=0;
 for(const end of [...cuts,text.length]){
  const segment=text.slice(previous,end);
  if(connectiveOnly(segment)){pendingStart??=previous;previous=end;continue;}
  const start=pendingStart??previous;clauses.push({text:text.slice(start,end),start:Array.from(text.slice(0,start)).length,end:Array.from(text.slice(0,end)).length});pendingStart=null;previous=end;
 }
 if(pendingStart!==null){if(!clauses.length)return retry('field_unrepresented');const last=clauses.at(-1);last.text+=text.slice(pendingStart);last.end=Array.from(text).length;}
 if(!clauses.length||clauses.length>6)return retry('field_unrepresented');
 signal?.throwIfAborted();
 return {clauses,diagnostics:{stage:'extraction',attempts:Math.ceil(candidates.length/16)}};
}
