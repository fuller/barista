import {readDecisionChoice} from './decision-choice.mjs';
import {createInflightDecisions} from './inflight-decisions.mjs';
const inflightDecisions=createInflightDecisions();
const record=value=>value&&typeof value==='object'&&!Array.isArray(value);

export function createDecisionTransport({apiKey,model,questionProfile,cache=null,fetchImpl=fetch,threshold=.85,margin=.15,clock=()=>performance.now(),menuVersion,metrics={},admissions=[]}={}){
 let attempts=0;
 for(const key of ['totalRequests','extractionRequests','decisionRequests','extractionMs','decisionMs'])metrics[key]??=0;
 if(cache){metrics.cacheHits??=0;metrics.inflightHits??=0;}
 const cacheable=(response,questions)=>{
  if(!record(response)||response.truncated!==undefined&&response.truncated!==false||!record(response.answers)||Object.keys(response.answers).length!==Object.keys(questions).length||Object.keys(questions).some(key=>!Object.hasOwn(response.answers,key)))return false;
  try{
   for(const [key,question] of Object.entries(questions)){
    const selected=readDecisionChoice(response.answers[key],question,{threshold,margin});
    if(selected===null||['unclear','uncertain','__unsupported__','__source_invalid__','unrepresented','__unrepresented__'].includes(selected)||key==='identity'&&selected==='unchanged')return false;
   }
   return true;
  }catch{return false;}
 };
 return {async post(route,payload,requestSignal,admissionSink=admissions){
  requestSignal?.throwIfAborted();
  if(attempts>=20)throw new Error('Turn request budget exhausted');
  attempts++;
  const body=JSON.stringify({model,...payload,state:typeof payload.state==='string'?payload.state:JSON.stringify(payload.state)});
  const endpoint='https://openrouter.ai/api/alpha/'+route,keys=Object.keys(payload.questions??{});
  const pure=cache&&route==='decisions'&&keys.length>0&&!keys.includes('coverage')&&(keys.every(key=>/^b\d+$/.test(key))||keys.length===1&&['identity','size'].includes(keys[0])||keys.includes('quantity')&&keys.every(key=>['quantity','quantityRequested','quantityOperation','size'].includes(key))||keys.every(key=>/^mod_/.test(key)));
  let cacheKey;
  if(pure){
   try{cacheKey=await cache.keyFor({credential:apiKey,model,profile:questionProfile,menuVersion,threshold,margin,endpoint,body},{signal:requestSignal});}
   catch{requestSignal?.throwIfAborted();}
   requestSignal?.throwIfAborted();

   if(typeof cacheKey!=='string'||!/^[a-f0-9]{64}$/.test(cacheKey))cacheKey=undefined;
   if(cacheKey){
    let hit;try{hit=cache.get(cacheKey);}catch{                                              }
    requestSignal?.throwIfAborted();
    if(hit!==undefined){metrics.cacheHits++;return hit;}
   }
  }
  const stage=route==='extractions'?'extraction':'decision',before=clock();
  const produce=async({signal})=>{
   signal?.throwIfAborted();
   const upstreamSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(25000)]):AbortSignal.timeout(25000);
   metrics.totalRequests++;metrics[stage+'Requests']++;
   const response=await fetchImpl(endpoint,{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body,signal:upstreamSignal});
   upstreamSignal.throwIfAborted();
   if(!response.ok)throw new Error(`Decision service unavailable (${response.status}). Your order has not changed.`);
   let decoded;
   try{decoded=await response.json();}
   catch{upstreamSignal.throwIfAborted();throw new Error('Invalid decision response');}
   upstreamSignal.throwIfAborted();return decoded;
  };
  try{
   let decoded;
   if(cacheKey){
    const result=await inflightDecisions.run(cacheKey,produce,{signal:requestSignal,bytes:new TextEncoder().encode(body).byteLength});
    decoded=result.value;if(result.shared)metrics.inflightHits++;
   }else decoded=await produce({signal:requestSignal});
   requestSignal?.throwIfAborted();
   if(cacheKey&&cacheable(decoded,payload.questions))admissionSink.push([cacheKey,structuredClone(decoded)]);
   return decoded;
  }finally{metrics[stage+'Ms']+=Math.max(0,clock()-before);}
 }};
}
