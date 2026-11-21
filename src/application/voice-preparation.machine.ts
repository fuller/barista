import {assign,createActor,setup} from 'xstate';

type Snapshot={revision:number};
export type PreparedVoiceCandidate<Response=unknown>={turnId:string;revision:number;text:string;controller:AbortController;promise:Promise<Response>};
type RequestInput<Input extends Snapshot>=Input&{text:string;turnId:string;signal:AbortSignal};
type Options<Input extends Snapshot,Response>={request:(input:RequestInput<Input>)=>Response|PromiseLike<Response>;onPreview?:(response:Response|null,candidate?:PreparedVoiceCandidate<Response>)=>void;onEvent?:(event:string,candidate?:PreparedVoiceCandidate<Response>)=>void;setTimer?:(callback:()=>void,delay:number)=>unknown;clearTimer?:(timer:unknown)=>void;makeId?:()=>string;delayMs?:number};
type Event<Input extends Snapshot,Response>={type:'begin';snapshot:Input}|{type:'update';text:string}|{type:'take'}|{type:'cancel'}|{type:'resolved';candidate:PreparedVoiceCandidate<Response>;response:Response}|{type:'rejected';candidate:PreparedVoiceCandidate<Response>};
type Context<Input extends Snapshot,Response>={snapshot:Input|null;text:string;candidate:PreparedVoiceCandidate<Response>|null};
const normalize=(text:unknown)=>typeof text==='string'?text.trim():'';
const interim=(text:unknown)=>{const value=normalize(text);return value.length<=600?value:'';};

export function createVoicePreparation<Input extends Snapshot=Snapshot,Response=unknown>({request,onPreview=()=>{},onEvent=()=>{},setTimer=setTimeout,clearTimer=(timer)=>clearTimeout(timer as ReturnType<typeof setTimeout>),makeId=()=>crypto.randomUUID(),delayMs=650}:Options<Input,Response>){

 let generation=0;
 const machine=setup({
  types:{context:{} as Context<Input,Response>,events:{} as Event<Input,Response>},
  delays:{debounce:delayMs},
  guards:{
   changed:({context,event})=>event.type==='update'&&interim(event.text)!==context.text,
   changedNonempty:({context,event})=>event.type==='update'&&Boolean(interim(event.text))&&interim(event.text)!==context.text,
   nonempty:({event})=>event.type==='update'&&Boolean(interim(event.text)),
   current:({context,event})=>(event.type==='resolved'||event.type==='rejected')&&context.candidate===event.candidate&&!event.candidate.controller.signal.aborted,
  },
  actions:{
   reset:assign(({event})=>event.type==='begin'?{snapshot:structuredClone(event.snapshot),text:'',candidate:null}:{snapshot:null,text:'',candidate:null}),
   updateText:assign(({event})=>event.type==='update'?{text:interim(event.text)}:{}),
   cancel:({context})=>{context.candidate?.controller.abort();onPreview(null,context.candidate??undefined);},
   detach:({context})=>{if(context.candidate){onPreview(null,context.candidate);onEvent('preparationReused',context.candidate);}},
   clear:assign({candidate:null}),
   dispatch:assign(({context,self})=>{
    const owner=generation;
    let resolve!:(response:Response|PromiseLike<Response>)=>void,reject!:(error:unknown)=>void;
    const promise=new Promise<Response>((yes,no)=>{resolve=yes;reject=no;});
    const candidate={turnId:makeId(),revision:context.snapshot!.revision,text:context.text,controller:new AbortController(),promise};
    promise.then(response=>self.send({type:'resolved',candidate,response}),()=>self.send({type:'rejected',candidate})).catch(()=>{});
    onEvent('preparationStarted',candidate);
    if(owner!==generation)candidate.controller.abort();
    try{resolve(request({...context.snapshot!,text:candidate.text,turnId:candidate.turnId,signal:candidate.controller.signal}));}catch(error){reject(error);}
    return {candidate};
   }),
   ready:({context,event})=>{if(event.type==='resolved'){const owner=generation;onEvent('preparationReady',event.candidate);if(owner===generation&&!context.candidate?.controller.signal.aborted)onPreview(event.response,event.candidate);}},
   failed:({context})=>onPreview(null,context.candidate??undefined),
  },
 }).createMachine({
  id:'voicePreparation',initial:'idle',context:{snapshot:null,text:'',candidate:null},
  on:{begin:{target:'.waiting',actions:['cancel','reset']},cancel:{target:'.idle',actions:['cancel','reset']},take:{target:'.idle',actions:['detach','reset']}},
  states:{
   idle:{},
   waiting:{on:{update:[{guard:'nonempty',target:'debouncing',actions:'updateText'}]}},
   debouncing:{after:{debounce:{target:'pending',actions:'dispatch'}},on:{update:[{guard:'changedNonempty',target:'debouncing',reenter:true,actions:'updateText'},{guard:'changed',target:'waiting',actions:'updateText'}]}},
   pending:{on:{update:{guard:'changed',target:'invalidated',actions:['cancel','clear','updateText']},resolved:{guard:'current',target:'ready',actions:'ready'},rejected:{guard:'current',target:'failed',actions:'failed'}}},
   ready:{on:{update:{guard:'changed',target:'invalidated',actions:['cancel','clear','updateText']}}},
   failed:{on:{update:{guard:'changed',target:'invalidated',actions:['cancel','clear','updateText']}}},
   invalidated:{},
  },
 });
 const actor=createActor(machine,{clock:{setTimeout:(callback,delay)=>setTimer(callback,delay),clearTimeout:timer=>clearTimer(timer)}}).start();
 return {
  begin(snapshot:Input){generation++;actor.send({type:'begin',snapshot});},
  update(text:unknown){actor.send({type:'update',text:interim(text)});},
  take(text:unknown,revision:number){const state=actor.getSnapshot(),candidate=state.context.candidate;if(!(state.matches('pending')||state.matches('ready'))||!candidate||candidate.controller.signal.aborted||candidate.text!==normalize(text)||candidate.revision!==revision){generation++;actor.send({type:'cancel'});return null;}generation++;actor.send({type:'take'});return candidate;},
  cancel(){generation++;actor.send({type:'cancel'});},
  dispose(){generation++;actor.send({type:'cancel'});actor.stop();},
  getSnapshot:()=>actor.getSnapshot(),
 };
}
