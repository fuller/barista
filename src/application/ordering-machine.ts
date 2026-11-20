import {assign,fromCallback,fromPromise,setup} from 'xstate';
import type {ActorRefFrom,SnapshotFrom} from 'xstate';
import type {Command,DecisionMetrics,Order,PendingClarification,TurnRequest,TurnResponse} from '../contracts.ts';
import {applyCommands,createOrder} from '../domain/order.mjs';
import {diffOrder} from '../ui/order-diff.mjs';
import {requestTurn} from './turn-client.mjs';
import {buildTurnRequest} from './turn-request.mjs';
import {buildVoicePreview} from './voice-preview.mjs';
import {createVoicePreparation} from './voice-preparation.machine.ts';
import type {PreparedVoiceCandidate} from './voice-preparation.machine.ts';
import {createVoiceInput,createVoiceOutput} from '../adapters/voice.ts';
import {createLocalTurnTiming} from '../ui/local-turn-timing.ts';
import type {LocalTurnTiming} from '../ui/local-turn-timing.ts';

type Timing=ReturnType<typeof createLocalTurnTiming>;
type VoiceSnapshot={revision:number;order:Order;pending:PendingClarification|null};
type Preparation=ReturnType<typeof createVoicePreparation<VoiceSnapshot,TurnResponse>>;
type Candidate=PreparedVoiceCandidate<TurnResponse>;
type Submission={id:string;revision:number;order:Order;pending:PendingClarification|null;text:string;spoken:boolean;controller:AbortController;prepared:Candidate|null};
type Result={data:TurnResponse;next:Order;submission:Submission};
type Preview=ReturnType<typeof buildVoicePreview>;
export type OrderingInput={order:Order;request?:typeof requestTurn;createVoiceInput?:typeof createVoiceInput;createVoiceOutput?:typeof createVoiceOutput;timing?:Timing;makeId?:()=>string;preparationOptions?:Pick<Parameters<typeof createVoicePreparation>[0],'setTimer'|'clearTimer'|'delayMs'>};
type Runtime={voice:ReturnType<typeof createVoiceInput>|null;output:ReturnType<typeof createVoiceOutput>|null;preparation:Preparation|null;traces:Map<string,ReturnType<Timing['fork']>>};
export type OrderingContext={storeId:string|null;order:Order;change:{before:Order;after:Order;diff:ReturnType<typeof diffOrder>}|null;pending:PendingClarification|null;messages:{role:'assistant'|'user';text:string}[];error:string;metrics:DecisionMetrics|null;interim:string;preview:Preview;voiceSupported:boolean;replies:boolean;localTiming:LocalTurnTiming|null;pendingFrame:{id:string;revision:number}|null;connection:{ready:boolean;available:boolean;error:string};voiceRevision:number|null;submission:Submission|null;input:OrderingInput;timing:Timing;runtime:Runtime};
export type OrderingEvent=
 |{type:'STORE.CHANGED';storeId:string|null}
 |{type:'CONNECTION.CHANGED';ready:boolean;available:boolean;error:string}
 |{type:'ORDER.SUBMIT';text:string}|{type:'VOICE.FINAL';text:string}
 |{type:'VOICE.START'}|{type:'VOICE.FINISH'}|{type:'VOICE.INTERIM';text:string}
 |{type:'VOICE.ERROR';message:string}|{type:'VOICE.READY';supported:boolean}
 |{type:'PREPARATION.STARTED'}|{type:'PREPARATION.PREVIEW';response:TurnResponse|null;candidate?:Candidate}
 |{type:'ORDER.COMMIT';commands:Command[]}|{type:'ORDER.RESET';catalogVersion:string}
 |{type:'REQUEST.CANCEL';message?:string}|{type:'CLARIFICATION.CANCEL'}
 |{type:'REPLIES.CHANGED';enabled:boolean}|{type:'ERROR.CHANGED';message:string}
 |{type:'UI.LAYOUT_COMMITTED';turnId:string;revision:number}|{type:'UI.FRAME_PAINTED';turnId:string;revision:number};
const errorText=(error:unknown,fallback='Could not reach the order service.')=>error instanceof Error?error.message:fallback;
function preflight(context:OrderingContext,text:string){if(!text.trim())return '';if(!context.storeId)return 'Choose a store before ordering.';if(!context.connection.ready)return 'Connecting to live ordering…';if(!context.connection.available)return context.connection.error||'Live ordering is unavailable. Configure the server API key, then retry connection.';if(text.trim().length>600)return 'Keep your order to 600 characters or fewer.';return '';}
function clearResources(context:OrderingContext,preserveTiming=false){const r=context.runtime;r.preparation?.cancel();r.traces.clear();r.voice?.stop();r.output?.stop();context.submission?.controller.abort();if(!preserveTiming)context.timing.cancel();}
function acceptOrder(context:OrderingContext,next:Order){return {order:next,change:{before:context.order,after:next,diff:diffOrder(context.order,next)}};}
const cleared={interim:'',preview:null,voiceRevision:null,pendingFrame:null,localTiming:null,submission:null};

export const orderingMachine=setup({
 types:{context:{} as OrderingContext,input:{} as OrderingInput,events:{} as OrderingEvent,tags:{} as 'busy'|'listening'|'preparing'},
 actors:{
  resources:fromCallback<OrderingEvent,{context:OrderingContext}>(({input,sendBack})=>{
   const context=input.context,r=context.runtime;
   r.output=(context.input.createVoiceOutput??createVoiceOutput)();
   r.preparation=createVoicePreparation<VoiceSnapshot,TurnResponse>({
    ...context.input.preparationOptions,makeId:context.input.makeId,
    request:({turnId,text,revision,order,pending,signal})=>{
     const trace=r.traces.get(turnId);
     return (context.input.request??requestTurn)({turnId,baseRevision:revision,text,order,pending},{signal,onTiming:(name:string)=>trace?.mark(name)});
    },
    onEvent:(name,candidate)=>{if(!candidate)return;if(name==='preparationStarted'){r.traces.set(candidate.turnId,context.timing.fork());sendBack({type:'PREPARATION.STARTED'});}r.traces.get(candidate.turnId)?.mark(name);},
    onPreview:(response,candidate)=>sendBack({type:'PREPARATION.PREVIEW',response,candidate}),
   });
   r.voice=(context.input.createVoiceInput??createVoiceInput)({onTranscript:text=>sendBack({type:'VOICE.FINAL',text}),onInterimTranscript:text=>sendBack({type:'VOICE.INTERIM',text}),onError:message=>sendBack({type:'VOICE.ERROR',message}),onState:()=>{},onTiming:name=>context.timing.mark(name)});
   sendBack({type:'VOICE.READY',supported:r.voice.supported});
   return ()=>{r.preparation?.dispose();r.traces.clear();r.voice?.dispose();r.output?.stop();context.timing.cancel();};
  }),
  request:fromPromise<Result,{submission:Submission;request:typeof requestTurn;timing:Timing}>(async({input,signal})=>{
   const s=input.submission;
   const abort=()=>s.controller.abort();signal.addEventListener('abort',abort,{once:true});
   try{
    const data:TurnResponse=await(s.prepared?s.prepared.promise:input.request({turnId:s.id,baseRevision:s.revision,text:s.text,order:s.order,pending:s.pending},{signal:s.controller.signal,onTiming:(name:string)=>input.timing.mark(name,s.id)}));
    s.controller.signal.throwIfAborted();
    if(data?.turnId!==s.id||data?.baseRevision!==s.revision)throw new Error('Response did not match this order. Please try again.');
    if(!Array.isArray(data.commands))throw new Error('Invalid order response. Please try again.');
    const next=data.commands.length?applyCommands(s.order,data.commands) as Order:s.order;
    return {data,next,submission:s};
   }finally{signal.removeEventListener('abort',abort);}
  }),
 },
 guards:{
  validSubmit:({context,event})=>(event.type==='ORDER.SUBMIT'||event.type==='VOICE.FINAL')&&Boolean(event.text.trim())&&!preflight(context,event.text)&&(event.type!=='VOICE.FINAL'||context.voiceRevision===context.order.revision),
  validCommit:({context,event})=>{if(event.type!=='ORDER.COMMIT'||(!context.storeId&&event.commands.some(command=>['add','add-menu','duplicate','confirm'].includes(command.type))))return false;try{applyCommands(context.order,event.commands);return true;}catch{return false;}},
  validReset:({event})=>{if(event.type!=='ORDER.RESET')return false;try{createOrder(event.catalogVersion);return true;}catch{return false;}},
  voiceAllowed:({context})=>Boolean(context.storeId)&&context.connection.ready&&context.connection.available&&context.voiceSupported,
  frameMatches:({context,event})=>(event.type==='UI.LAYOUT_COMMITTED'||event.type==='UI.FRAME_PAINTED')&&context.pendingFrame?.id===event.turnId&&context.pendingFrame.revision===event.revision&&context.order.revision===event.revision,
 },
 actions:{
  clear:assign(({context})=>{clearResources(context);return cleared;}),
  submit:assign(({context,event})=>{
   if(event.type!=='ORDER.SUBMIT'&&event.type!=='VOICE.FINAL')return {};
   const text=event.text.trim(),spoken=event.type==='VOICE.FINAL';
   // Transfer ownership before cancel clears the listening session.
   const prepared=spoken?context.runtime.preparation?.take(text,context.order.revision)??null:null;
   const trace=prepared?context.runtime.traces.get(prepared.turnId):undefined;
   clearResources(context,spoken);
   const id=prepared?.turnId??(context.input.makeId??(()=>crypto.randomUUID()))();
   if(spoken){context.timing.bind(id,context.order.revision);trace?.adopt(id);context.timing.mark('submit',id);}
   return {...cleared,error:'',messages:[...context.messages,{role:'user' as const,text}],submission:{id,revision:context.order.revision,order:context.order,pending:context.pending?.revision===context.order.revision?context.pending:null,text,spoken,prepared,controller:prepared?.controller??new AbortController()}};
  }),
  rejectSubmit:assign(({context,event})=>event.type==='ORDER.SUBMIT'||event.type==='VOICE.FINAL'?{error:preflight(context,event.text)}:{}),
  commit:assign(({context,event})=>{if(event.type!=='ORDER.COMMIT')return {};const next=applyCommands(context.order,event.commands) as Order;clearResources(context);return {...cleared,...acceptOrder(context,next),pending:null,error:''};}),
  invalidCommit:assign(({context,event})=>{if(!context.storeId&&event.type==='ORDER.COMMIT')return {error:'Choose a store before ordering.'};try{if(event.type==='ORDER.COMMIT')applyCommands(context.order,event.commands);else if(event.type==='ORDER.RESET')createOrder(event.catalogVersion);}catch(error){return {error:errorText(error,'Could not update the order.')};}return {};}),
  reset:assign(({context,event})=>{if(event.type!=='ORDER.RESET')return {};const next=createOrder(event.catalogVersion) as Order;clearResources(context);return {...cleared,...acceptOrder(context,next),pending:null,error:'',metrics:null};}),
  startVoice:assign(({context})=>{clearResources(context);context.timing.begin(context.order.revision);context.runtime.preparation?.begin({revision:context.order.revision,order:buildTurnRequest({order:context.order}).order,pending:context.pending?.revision===context.order.revision?context.pending:null});context.runtime.voice?.start();return {...cleared,error:'',voiceRevision:context.order.revision};}),
  interim:assign(({context,event})=>{if(event.type!=='VOICE.INTERIM'||context.voiceRevision!==context.order.revision)return {};context.runtime.preparation?.update(event.text);return {interim:event.text};}),
  preview:assign(({context,event})=>event.type==='PREPARATION.PREVIEW'?{preview:event.response&&event.candidate&&context.voiceRevision===event.candidate.revision&&context.order.revision===event.candidate.revision?buildVoicePreview(context.order,event.response):null}:{}),
 },
}).createMachine({
 id:'ordering',initial:'idle',
 context:({input})=>({storeId:null,order:input.order,change:null,pending:null,messages:[{role:'assistant',text:'Pick a favorite, or tell me what sounds good.'}],error:'',metrics:null,interim:'',preview:null,voiceSupported:false,replies:true,localTiming:null,pendingFrame:null,connection:{ready:false,available:false,error:''},voiceRevision:null,submission:null,input,timing:input.timing??createLocalTurnTiming(),runtime:{voice:null,output:null,preparation:null,traces:new Map()}}),
 invoke:{id:'resources',src:'resources',input:({context})=>({context})},
 on:{
  'STORE.CHANGED':{target:'.idle',actions:['clear',assign(({event})=>({storeId:event.storeId,pending:null,error:'',metrics:null}))]},
  'VOICE.READY':{actions:assign(({event})=>({voiceSupported:event.supported}))},
  'CONNECTION.CHANGED':{actions:assign(({context,event})=>({connection:{ready:event.ready,available:event.available,error:event.error},error:context.error==='Connecting to live ordering…'&&event.ready?'':context.error}))},
  'ERROR.CHANGED':{actions:assign(({event})=>({error:event.message}))},
  'REPLIES.CHANGED':{actions:assign(({context,event})=>{if(!event.enabled)context.runtime.output?.stop();return {replies:event.enabled};})},
  'ORDER.SUBMIT':[{guard:'validSubmit',target:'.submitting',actions:'submit'},{actions:'rejectSubmit'}],
  'ORDER.COMMIT':[{guard:'validCommit',target:'.idle',actions:'commit'},{actions:'invalidCommit'}],
  'ORDER.RESET':[{guard:'validReset',target:'.idle',actions:'reset'},{actions:'invalidCommit'}],
  'VOICE.START':{guard:'voiceAllowed',target:'.listening',actions:'startVoice'},
  'REQUEST.CANCEL':{target:'.idle',actions:['clear',assign(({event})=>({error:event.message??'Request cancelled. Your cart is unchanged.'}))]},
  'CLARIFICATION.CANCEL':{target:'.idle',actions:['clear',assign(({context})=>({pending:null,error:'',messages:[...context.messages,{role:'assistant' as const,text:'Cancelled. What would you like next?'}]}))]},
  'UI.LAYOUT_COMMITTED':{guard:'frameMatches',actions:({context,event})=>context.timing.mark('layoutCommit',event.turnId)},
  'UI.FRAME_PAINTED':{guard:'frameMatches',actions:assign(({context,event})=>{context.timing.mark('nextFrame',event.turnId);return {localTiming:context.timing.complete(event.turnId,event.revision),pendingFrame:null};})},
 },
 states:{
  idle:{},clarifying:{},failed:{},
  listening:{tags:['listening'],initial:'capturing',on:{
   'VOICE.FINISH':{actions:({context})=>context.runtime.voice?.finish()},
   'VOICE.INTERIM':{actions:'interim'},
   'VOICE.FINAL':[{guard:'validSubmit',target:'#ordering.submitting',actions:'submit'},{target:'#ordering.idle',actions:['rejectSubmit','clear']}],
   'VOICE.ERROR':{target:'#ordering.failed',actions:['clear',assign(({event})=>({error:event.message}))]},
   'PREPARATION.STARTED':{target:'.preparing'},
   'PREPARATION.PREVIEW':[{guard:({event})=>Boolean(event.response),target:'.preview',actions:'preview'},{target:'.capturing',actions:'preview'}],
  },states:{capturing:{},preparing:{tags:['preparing']},preview:{}}},
  submitting:{tags:['busy'],invoke:{id:'request',src:'request',input:({context})=>({submission:context.submission!,request:context.input.request??requestTurn,timing:context.timing}),onDone:{target:'settled',actions:assign(({context,event})=>{
   const {data,next,submission}=event.output;
   if(context.submission?.id!==submission.id||context.order.revision!==submission.revision)return {};
   context.timing.mark('commandsApplied',submission.id);
   if(!data.commands.length)context.timing.cancel();
   const pending=data.pending?.revision===next.revision?data.pending:null;
   const answer=data.clarification||(next.confirmed?'Order confirmed. Your simulated receipt is ready.':data.commands.length?'Got it. Your order is updated.':'Tell me what you’d like to order.');
   if(submission.spoken&&context.replies)context.runtime.output?.speak(answer);
   return {...(data.commands.length?acceptOrder(context,next):{}),pending,metrics:data.metrics??null,submission:null,pendingFrame:data.commands.length?{id:submission.id,revision:next.revision}:null,messages:[...context.messages,{role:'assistant' as const,text:answer}]};
  })},onError:{target:'failed',actions:assign(({context,event})=>{context.timing.cancel();return {submission:null,pendingFrame:null,error:errorText(event.error)};})}}},
  settled:{always:[{guard:({context})=>Boolean(context.pending),target:'clarifying'},{target:'idle'}]},
 },
});
export type OrderingActor=ActorRefFrom<typeof orderingMachine>;
export type OrderingSnapshot=SnapshotFrom<typeof orderingMachine>;
