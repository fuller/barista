import {validateOrder,applyCommands} from '../domain/order.mjs';
import {createRegistry} from '../adapters/registry.mjs';
import {DEFAULT_MODEL,DEFAULT_MENU_PROFILE} from '../adapters/config.mjs';
import {interpretInput} from '../application/turns.mjs';
import {sanitizeMetrics,sanitizeDiagnostics} from './metrics.mjs';
import {catalogResponse} from './catalog-api.mjs';
import previousSnapshot from '../catalog/data/previous.snapshot.json' with {type:'json'};
import {registerCatalogSnapshot} from '../catalog/service.mjs';
import {createDecisionCache} from '../adapters/decision-cache.mjs';
import {createMenuDeciderAdapter} from '../adapters/menu-decider.mjs';
import menuDirectory from '../catalog/data/starbucks-menu-directory.json' with {type:'json'};
import {handleQuoteApi} from './quote-api.mjs';
import {readExistingQuoteSession,quoteCacheScope} from './pricing-session.mjs';
import {handleStoresApi} from './stores-api.mjs';
import {pricingServiceConfigured} from '../adapters/starbucks-pricing-source.mjs';
registerCatalogSnapshot(previousSnapshot);
const decisionCache=createDecisionCache();
const registry=createRegistry({decider:createMenuDeciderAdapter});
const menuQuestionProfiles=new Set(['lean-v8','lean-v9','lean-v10']);
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const admissionConfigured=env=>env.REQUIRE_TURN_RATE_LIMIT!=='true'||typeof env.TURN_RATE_LIMITER?.limit==='function';
async function admitTurn(request,env,kind='turn'){
 const limiter=env.TURN_RATE_LIMITER;
 if(!admissionConfigured(env))return json({error:'Ordering is temporarily unavailable.'},503);
 if(!limiter)return null;

 const address=request.headers.get('CF-Connecting-IP');
 if(!address)return json({error:'Ordering is temporarily unavailable.'},503);
 try{
  const result=await limiter.limit({key:`${kind}:${address}`});
  if(result.success===true)return null;
  const response=json({error:'Too many ordering requests. Please wait a minute and try again.'},429);
  response.headers.set('Retry-After','60');return response;
 }catch{return json({error:'Ordering is temporarily unavailable.'},503);}
}
async function limitedJson(request){
 const reader=request.body?.getReader();if(!reader)throw new Error('Missing request body');let length=0;const chunks=[];
 while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>65536){await reader.cancel();throw Object.assign(new Error('Request is too large'),{status:413});}chunks.push(value);}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 return JSON.parse(new TextDecoder().decode(bytes));
}
export function validateTurnInput(body){
 if(!body||typeof body!=='object'||typeof body.turnId!=='string'||!body.turnId||body.turnId.length>100||typeof body.text!=='string'||!body.text.trim()||body.text.length>600||(body.mode!==undefined&&body.mode!=='live'))throw new Error('Invalid ordering request');
 validateOrder(body.order);
 if(body.order.history.length>120||body.baseRevision!==body.order.revision)throw new Error('Invalid order revision or history');
 if(body.activeItemId!==undefined&&(typeof body.activeItemId!=='string'||![...body.order.items,...(body.order.menuItems??[])].some(i=>i.id===body.activeItemId)))throw new Error('Invalid selected drink');
 const p=body.pending;
 if(p!==null&&p!==undefined){if(typeof p.originalText!=='string'||p.originalText.length>600||typeof p.question!=='string'||p.question.length>1000||!Number.isSafeInteger(p.revision)||!Array.isArray(p.answers)||p.answers.length>8||p.answers.some(a=>typeof a!=='string'||a.length>600)||!Array.isArray(p.targetIds)||p.targetIds.length>100||p.targetIds.some(id=>typeof id!=='string'))throw new Error('Invalid clarification');}
 return {turnId:body.turnId,baseRevision:body.baseRevision,text:body.text,order:body.order,pending:p??null,mode:body.mode,activeItemId:body.activeItemId};
}
export async function handleApi(request,env={}){
 const path=new URL(request.url).pathname;if(!path.startsWith('/api/'))return null;
 const provider=env.DECISION_PROVIDER||'decider';const model=env.DECISION_MODEL||DEFAULT_MODEL;
 const scheduling=env.DECISION_SCHEDULING??'guarded-overlap';
 const schedulingValid=['sequential','guarded-overlap'].includes(scheduling);
 const requestedProfile=env.MENU_QUESTION_PROFILE===undefined?DEFAULT_MENU_PROFILE:env.MENU_QUESTION_PROFILE;
 const questionProfile=menuQuestionProfiles.has(requestedProfile)?requestedProfile:null;
 if(path==='/api/menu-directory'){
  if(request.method!=='GET')return json({error:'Method not allowed'},405);
  const etag='\"'+menuDirectory.version+'\"',headers={'Cache-Control':'public, max-age=300','ETag':etag,'X-Content-Type-Options':'nosniff'};
  if(request.headers.get('If-None-Match')===etag)return new Response(null,{status:304,headers});
  return Response.json(menuDirectory,{headers});
 }
 if(path==='/api/catalog'){
  if(request.method!=='GET')return json({error:'Method not allowed'},405);
  const result=catalogResponse(request);return new Response(result.body===null?null:JSON.stringify(result.body),{status:result.status,headers:result.headers});
 }
 if(path==='/api/config'&&request.method==='GET'){
  const available=pricingServiceConfigured(env),session=available?readExistingQuoteSession(request):null;
  const cacheScope=session?await quoteCacheScope(session):null;
  const response=json({provider,model,questionProfile,scheduling:schedulingValid?scheduling:null,liveAvailable:admissionConfigured(env)&&schedulingValid&&questionProfile!==null&&registry.has(provider)&&Boolean(env.OPENROUTER_API_KEY),pricing:{estimated:false,taxCalculated:true,available,cacheScope}});
  return response;
 }
 if(path==='/api/stores'){const denied=await admitTurn(request,env,'stores');if(denied)return denied;return handleStoresApi(request,env);}
 if(path==='/api/quote'){
  if(request.method!=='POST')return json({error:'Method not allowed'},405);
  const origin=request.headers.get('Origin');if(origin&&origin!==new URL(request.url).origin||request.headers.get('Sec-Fetch-Site')==='cross-site')return json({error:'Origin not allowed'},403);
  const denied=await admitTurn(request,env,'quote');if(denied)return denied;
  return handleQuoteApi(request,env);
 }
 if(path!=='/api/turn')return json({error:'Not found'},404);
 if(request.method!=='POST')return json({error:'Method not allowed'},405);
 const origin=request.headers.get('Origin');if(origin&&origin!==new URL(request.url).origin)return json({error:'Origin not allowed'},403);
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'Use application/json'},415);
 const denied=await admitTurn(request,env);if(denied)return denied;
 try{
  const input=validateTurnInput(await limitedJson(request));
  if(!schedulingValid)return json({error:'The server decision scheduling is not configured correctly.'},503);
  if(questionProfile===null)return json({error:'The server menu question profile is not configured correctly.'},503);
  if(!env.OPENROUTER_API_KEY||!registry.has(provider))return json({error:'Live decision provider is not configured. Configure a supported provider and the server-only OPENROUTER_API_KEY.'},503);
  const adapter=registry.resolve(provider,{apiKey:env.OPENROUTER_API_KEY,model,questionProfile,scheduling,cache:decisionCache});

  const result=await interpretInput(input,{interpretTurn:(turn,context)=>adapter.interpretTurn({...turn,text:input.text,clarificationContext:undefined},context)},{signal:request.signal});
  if(result.commands.length)applyCommands(input.order,result.commands);
  return json({turnId:input.turnId,baseRevision:input.baseRevision,...result,diagnostics:sanitizeDiagnostics(result.diagnostics),metrics:sanitizeMetrics(result.metrics)});
 }catch(e){
  const status=e.status??(e.message?.startsWith('Catalog version unavailable')?409:e.name==='AbortError'||e.name==='TimeoutError'?504:400);

  return json({error:status===409?e.message:status===413?'Request is too large':status===504?'The decision service took too long. Your order has not changed.':e.message?.includes('Decision service unavailable')?e.message:'Could not interpret that request. Your order has not changed; try a simpler request or edit a drink.',diagnostics:sanitizeDiagnostics(e.diagnostics),metrics:sanitizeMetrics(e.metrics)},status);
 }
}
