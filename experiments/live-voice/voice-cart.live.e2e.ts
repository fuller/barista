import {expect,test} from 'e2e';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Order} from '../../src/contracts';

type Expected={identity:string;size:string|null;quantity:number;instructions:string[]};
type SafeTurn={status:number;totalRequests:number|null;extractionRequests:number|null;decisionRequests:number|null;cacheHits:number|null;finalToResponseMs?:number};
type Harness={turns:SafeTurn[];active:number;sent:number;dispatches:Array<{text:string;turnId:string;at:number}>;finalAt:number|null;prematureCart?:boolean;emit?:(text:string,final:boolean)=>void;stopped:boolean};
type Result={caseId:string;phase:string;pass:boolean;httpTurns:number;preFinalHttpTurns?:number;postFinalHttpTurns?:number;providerRequests:number|null;providerBefore?:number;providerAfter?:number;turns:SafeTurn[];milestones:Record<string,number>;micToNextFrameMs?:number;actualCart?:Array<{identity:string;size:string|null;quantity:number;instructions:string[]}>;finalToCommandsMs:number|null;finalToNextFrameMs:number|null;failure?:string;clarification?:string;diagnostics?:{reason?:string;field?:string}};
const latte=(size:string|null=null,instructions:string[]=['one latte']):Expected=>({identity:'407:Hot',size,quantity:1,instructions});
const allCases=[
 {id:'final-cold-latte',phase:'cold-requires-fresh-server',text:'one latte',expected:[latte()]},
 {id:'final-warm-latte',phase:'warm-same-phrase-cached',text:'one latte',expected:[latte()]},
 {id:'ambiguity-seed',phase:'existing-typed-cart-add',text:'another tall latte',preserve:true,expected:[latte(),latte('Tall',['another tall latte'])]},
 {id:'ambiguous-target',phase:'manual-two-latte-seed-clarification',text:'make one of the two lattes iced',seed:'two-lattes',clarify:true,expected:[latte('Tall',[]),latte('Grande',[])]},
 {id:'asr-american-multiple',phase:'new-phrase',text:'one American and one cold brew',expected:[{identity:'406:Hot',size:null,quantity:1,instructions:['one American ']},{identity:'2121255:Iced',size:null,quantity:1,instructions:['and one cold brew']}]},
 {id:'iced-oat-extra-shot',phase:'new-phrase',text:'one grande iced latte with oat milk and one extra shot',expected:[{identity:'407:Iced',size:'Grande',quantity:1,instructions:['one grande iced latte with oat milk and one extra shot']}]},
 {id:'followup-size-decaf',phase:'manual-iced-modifier-seed-followup',text:'make it venti and decaf',seed:'iced-modified',expected:[{identity:'407:Iced',size:'Venti',quantity:1,instructions:['oat milk','one extra shot','make it venti and decaf']}]},
 {id:'trenti-half-syrup-ownership',phase:'new-phrase',text:'one trenti cold brew, a shaken espresso with half the syrup',expected:[{identity:'2121255:Iced',size:'Trenta',quantity:1,instructions:['one trenti cold brew']},{identity:'2123425:Iced',size:null,quantity:1,instructions:[', a shaken espresso with half the syrup']}]},
 {id:'prepared-stable',phase:'prepared-new-phrase',text:'one tall latte',prepared:['one tall latte'],expected:[latte('Tall',['one tall latte'])]},
 {id:'prepared-revised',phase:'prepared-new-phrases',text:'one venti latte',prepared:['one short latte','one venti latte'],expected:[latte('Venti',['one venti latte'])]},
];
const selectedIds=process.env.LIVE_VOICE_CASES?.split(',').map(id=>id.trim()).filter(Boolean);
if(selectedIds?.some(id=>!allCases.some(c=>c.id===id)))throw Error('Unknown live voice case ID');
const cases=selectedIds?allCases.filter(c=>selectedIds.includes(c.id)):allCases;
const normalizedInstruction=(text:string)=>text.trim().replace(/\s+/g,' ');

const metric=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;

test('real OpenRouter accuracy and latency with synthetic recognition, cold warm and preparation',async({app,screen,browser})=>{
 const rows:Result[]=[];let model='',provider='',fatal=false;
 const output=path.resolve('work/live-voice-smoke',`real-${Date.now()}-${randomUUID()}.json`);
 let providerStart=0;
 const budget=async()=>await browser.evaluate(async()=>{const response=await fetch('/_benchmark/status');if(!response.ok)throw Error('Benchmark budget guard unavailable');const value=await response.json();return {requestCount:value.requestCount,serverRequests:value.serverRequests,maxRequests:value.maxRequests,budgetExceeded:value.budgetExceeded};}) as {requestCount:number;serverRequests?:number;maxRequests:number;budgetExceeded:boolean};
 await browser.addInitScript(()=>{
  const scope=window as unknown as {liveVoice:Harness;SpeechRecognition:unknown};
  scope.liveVoice={turns:[],active:0,sent:0,dispatches:[],finalAt:null,stopped:false};
  class Recognition{
   onresult:((event:unknown)=>void)|null=null;onaudiostart:(()=>void)|null=null;onspeechend:(()=>void)|null=null;
   start(){scope.liveVoice.finalAt=null;scope.liveVoice.emit=(text,final)=>{if(final){scope.liveVoice.finalAt=performance.now();this.onspeechend?.();}this.onresult?.({results:[{isFinal:final,0:{transcript:text}}]});};this.onaudiostart?.();}
   stop(){}abort(){}
  }
  scope.SpeechRecognition=Recognition;
  const original=window.fetch.bind(window);
  window.fetch=async(...args)=>{
   if(args[0]!=='/api/turn')return original(...args);
   const state=scope.liveVoice;
   if(state.stopped||state.sent>=12){state.stopped=true;throw Error('Live benchmark budget exhausted');}
   const body=JSON.parse(String(args[1]?.body??'{}'));state.dispatches.push({text:body.text,turnId:body.turnId,at:performance.now()});
   state.active++;state.sent++;
   try{
    const response=await original(...args),data=await response.clone().json().catch(()=>null);
    const count=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
    const metrics=data?.metrics;
    state.turns.push({finalToResponseMs:state.finalAt===null?undefined:Math.max(0,performance.now()-state.finalAt),status:response.status,totalRequests:count(metrics?.totalRequests),extractionRequests:count(metrics?.extractionRequests),decisionRequests:count(metrics?.decisionRequests),cacheHits:count(metrics?.cacheHits)});
    if(!response.ok||!metrics||state.turns.reduce((n,row)=>n+(row.totalRequests??0),0)>60)state.stopped=true;
    return response;
   }catch(error){if(args[1]?.signal?.aborted||error instanceof DOMException&&error.name==='AbortError')state.turns.push({status:0,totalRequests:null,extractionRequests:null,decisionRequests:null,cacheHits:null});else{state.stopped=true;state.turns.push({status:-1,totalRequests:null,extractionRequests:null,decisionRequests:null,cacheHits:null});}throw error;}finally{state.active--;}
  };
 });
 await browser.route('https://cloudassets.starbucks.com/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'}));
 await browser.route('**/api/stores?*',route=>route.fulfill({json:{stores:[{storeId:'8527800',source:'starbucks',sourceStoreNumber:'85278-313836',name:'Benchmark store',address:{lines:['104 Jay St'],city:'Brooklyn',region:'NY',postalCode:'11201',countryCode:'US'},coordinates:{latitude:40.70205,longitude:-73.98686},selectionToken:'synthetic-benchmark-selection'}]}}));
 await browser.route('**/api/quote',route=>route.fulfill({status:503,json:{error:'Live pricing unavailable'}}));
 const readTiming=async()=>await browser.evaluate(()=>{const text=document.querySelector('[aria-label="Local voice timing"] pre')?.textContent;if(!text)return null;try{return JSON.parse(text);}catch{return null;}}) as {turnId:string;baseRevision:number;committedRevision:number;milestones:Record<string,number>}|null;
 const persistProgress=async()=>{await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output+'.progress.json',JSON.stringify({schemaVersion:2,model,provider,complete:false,rows},null,2)+'\n');};
 const committed=async()=>await browser.evaluate(()=>{
  const root=document.getElementById('root') as unknown as Record<string,any>;
  const key=Object.keys(root).find(key=>key.startsWith('__reactContainer$'));
  if(!key)throw Error('Committed cart snapshot unavailable');
  const stack=[root[key].stateNode.current];
  while(stack.length){const node=stack.pop();const props=node.memoizedProps;if(props?.order?.items&&props?.quote&&typeof props.storeLabel==='string')return JSON.parse(JSON.stringify(props.order));if(node.sibling)stack.push(node.sibling);if(node.child)stack.push(node.child);}
  throw Error('Committed cart snapshot unavailable');
 }) as Order;
 try{
  const configResponse=browser.waitForResponse('**/api/config');await app.open('/');
  const config=await(await configResponse).json() as {liveAvailable?:boolean;model?:string;provider?:string};
  expect(config.liveAvailable).toBe(true);model=typeof config.model==='string'?config.model:'';provider=typeof config.provider==='string'?config.provider:'';
  const initialBudget=await budget();expect(initialBudget.maxRequests).toBe(60);expect(initialBudget.serverRequests??initialBudget.requestCount).toBe(0);providerStart=initialBudget.requestCount;
  await screen.getByRole('button',{name:'Search stores',exact:true}).click();await screen.getByRole('radio').first().click();await screen.getByRole('button',{name:'Use this store',exact:true}).click();
  for(const c of cases){
   const start=await browser.evaluate(()=>(window as unknown as {liveVoice:Harness}).liveVoice.turns.length);
   const sentBefore=await browser.evaluate(()=>(window as unknown as {liveVoice:Harness}).liveVoice.sent);let stage='budget';console.log(JSON.stringify({caseId:c.id,stage}));
   const row:Result={caseId:c.id,phase:c.phase,pass:false,httpTurns:0,providerRequests:null,turns:[],milestones:{},finalToCommandsMs:null,finalToNextFrameMs:null};
   try{
    const beforeBudget=await budget();row.providerBefore=beforeBudget.requestCount;if(beforeBudget.budgetExceeded||beforeBudget.requestCount>=60){fatal=true;throw Error('request_budget_or_transport');}
    const stopped=await browser.evaluate(()=>(window as unknown as {liveVoice:Harness}).liveVoice.stopped);if(stopped){fatal=true;throw Error('request_budget_or_transport');}
    stage='setup';console.log(JSON.stringify({caseId:c.id,stage}));
    if(!('preserve'in c))await screen.getByRole('button',{name:'Start new order',exact:true}).click();
    if('seed'in c){
     const menu=screen.getByRole('region',{name:'Full menu'});
     if(c.seed==='iced-modified'){
      await menu.getByLabel('Iced Caffè Latte size',{exact:true}).selectOption('Grande');await menu.getByRole('button',{name:'Add Iced Caffè Latte',exact:true}).click();
      const cart=screen.getByRole('complementary',{name:'Your order'});await cart.getByLabel('Edit Iced Caffè Latte',{exact:true}).click();await cart.getByLabel('Iced Caffè Latte instructions',{exact:true}).fill('oat milk\none extra shot');await cart.getByRole('heading').first().click();
     }else{
      await menu.getByLabel('Caffè Latte size',{exact:true}).selectOption(c.seed==='two-lattes'?'Tall':'');await menu.getByRole('button',{name:'Add Caffè Latte',exact:true}).click();
      if(c.seed==='two-lattes'){await menu.getByLabel('Caffè Latte size',{exact:true}).selectOption('Grande');await menu.getByRole('button',{name:'Add Caffè Latte',exact:true}).click();}
     }
    }
    const beforeOrder=await committed();
    if('seed'in c){
     stage='manual_seed';expect(beforeOrder.items).toEqual([]);
     const seed=beforeOrder.menuItems??[];
     if(c.seed==='iced-modified')expect(seed.map(({identity,size,quantity,instructions})=>({identity,size,quantity,instructions}))).toEqual([{identity:'407:Iced',size:'Grande',quantity:1,instructions:['oat milk','one extra shot']}]);
     else expect(seed.map(({identity,size,quantity,instructions})=>({identity,size,quantity,instructions}))).toEqual(c.seed==='two-lattes'?[latte('Tall',[]),latte('Grande',[])]:[latte(null,[])]);
    }
    await screen.getByRole('button',{name:'Start microphone',exact:true}).click();
    stage='interpretation';console.log(JSON.stringify({caseId:c.id,stage}));
    const finalResponse='prepared'in c?null:browser.waitForResponse('**/api/turn',{timeout:70_000});
    if('prepared'in c){
     expect(beforeOrder.items.length+(beforeOrder.menuItems?.length??0)).toBe(0);
     await browser.evaluate(async({text,prepared})=>{
      const state=(window as unknown as {liveVoice:Harness}).liveVoice;
      state.emit?.(prepared[0],false);
      if(prepared.length>1){await new Promise(resolve=>setTimeout(resolve,900));state.emit?.(prepared[1],false);await new Promise(resolve=>setTimeout(resolve,1100));}
      else await new Promise(resolve=>setTimeout(resolve,1200));
      state.prematureCart=Boolean(document.querySelector('aside[aria-label="Your order"] [data-item-id]'));
      state.emit?.(text,true);
     },{text:c.text,prepared:c.prepared});
     expect(await browser.evaluate(()=>(window as unknown as {liveVoice:Harness}).liveVoice.prematureCart)).toBe(false);
    }else await browser.evaluate(text=>(window as unknown as {liveVoice:Harness}).liveVoice.emit?.(text,true),c.text);
    if(finalResponse){const response=await finalResponse;expect(response.status).toBe(200);const data=await response.json() as {clarification?:string|null;commands?:unknown[];diagnostics?:{reason?:string;field?:string}};row.clarification=typeof data.clarification==='string'?data.clarification.slice(0,600):undefined;row.diagnostics={...(typeof data.diagnostics?.reason==='string'?{reason:data.diagnostics.reason.slice(0,100)}:{}),...(typeof data.diagnostics?.field==='string'?{field:data.diagnostics.field.slice(0,100)}:{})};if('clarify'in c){stage='clarification';console.log(JSON.stringify({caseId:c.id,stage}));expect(Boolean(data.clarification)).toBe(true);expect(data.commands).toEqual([]);expect(await committed()).toEqual(beforeOrder);row.actualCart=(beforeOrder.menuItems??[]).map(({identity,size,quantity,instructions})=>({identity,size,quantity,instructions}));row.pass=true;}else{stage='unexpected_clarification';console.log(JSON.stringify({caseId:c.id,stage}));expect(data.clarification??null).toBe(null);}}
    if(!('clarify'in c)){
    stage='cart_commit';console.log(JSON.stringify({caseId:c.id,stage}));
    const timing=screen.getByLabel('Local voice timing');await expect(timing).toBeVisible();
    await expect.poll(async()=>{const order=await committed();return order.revision>beforeOrder.revision;}).toBe(true);
    await expect.poll(async()=>{const local=await readTiming();const order=await committed();return local?.baseRevision===beforeOrder.revision&&local?.committedRevision===order.revision&&typeof local?.milestones?.nextFrame==='number';}).toBe(true);
    stage='timing';console.log(JSON.stringify({caseId:c.id,stage}));
    const local=await readTiming();expect(local).not.toBe(null);
    for(const [key,value] of Object.entries(local?.milestones??{}))if(typeof value==='number'&&Number.isFinite(value)&&value>=0)row.milestones[key]=value;
    for(const key of ['finalTranscript','commandsApplied','layoutCommit','nextFrame'])expect(typeof row.milestones[key]).toBe('number');
    row.finalToCommandsMs=row.milestones.commandsApplied-row.milestones.finalTranscript;row.finalToNextFrameMs=row.milestones.nextFrame-row.milestones.finalTranscript;
    row.micToNextFrameMs=row.milestones.nextFrame-(row.milestones.micClick??0);
    stage='turn_correlation';console.log(JSON.stringify({caseId:c.id,stage}));const dispatched=await browser.evaluate(start=>(window as unknown as {liveVoice:Harness}).liveVoice.dispatches.slice(start),sentBefore);expect(local?.turnId).toBe(dispatched.at(-1)?.turnId);
    if('prepared'in c)expect(row.milestones.preparationStarted).toBeLessThan(row.milestones.finalTranscript);
    const order=await committed();stage='unexpected_legacy_cart';console.log(JSON.stringify({caseId:c.id,stage}));expect(order.items).toEqual([]);
    const lines=order.menuItems??[];
    row.actualCart=lines.map(({identity,size,quantity,instructions})=>({identity,size,quantity,instructions}));
    expect(lines.length).toBe(c.expected.length);
    for(let i=0;i<c.expected.length;i++){
     const expected=c.expected[i],line=lines[i];
     stage='identity';console.log(JSON.stringify({caseId:c.id,stage}));expect(line.identity).toBe(expected.identity);stage='size';console.log(JSON.stringify({caseId:c.id,stage}));expect(line.size).toBe(expected.size);stage='quantity';console.log(JSON.stringify({caseId:c.id,stage}));expect(line.quantity).toBe(expected.quantity);stage='instructions';console.log(JSON.stringify({caseId:c.id,stage}));
     expect(line.instructions.map(normalizedInstruction)).toEqual(expected.instructions.map(normalizedInstruction));
    }
    stage='dom_correlation';await expect.poll(async()=>await browser.evaluate(()=>document.querySelectorAll('aside[aria-label="Your order"] [data-item-id]').length)).toBe(c.expected.length);
    row.pass=true;
    }
   }catch{row.failure=stage+'_assertion_failed';await browser.evaluate(()=>{const button=[...document.querySelectorAll('button')].find(button=>button.textContent==='Cancel request');button?.click();});}
   try{await expect.poll(async()=>await browser.evaluate(()=>(window as unknown as {liveVoice:Harness}).liveVoice.active)).toBe(0);}catch{row.pass=false;row.failure='unfinished_request';fatal=true;}
   row.turns=await browser.evaluate(start=>(window as unknown as {liveVoice:Harness}).liveVoice.turns.slice(start),start);
   row.httpTurns=await browser.evaluate(()=>(window as unknown as {liveVoice:Harness}).liveVoice.sent)-sentBefore;
   const afterBudget=await budget();row.providerAfter=afterBudget.requestCount;row.providerRequests=row.providerBefore===undefined?null:afterBudget.requestCount-row.providerBefore;
   if(afterBudget.budgetExceeded||afterBudget.requestCount>60){fatal=true;row.pass=false;row.failure='provider_budget_exhausted';}
   if('prepared'in c){
    const dispatch=await browser.evaluate(start=>{const state=(window as unknown as {liveVoice:Harness}).liveVoice;return {requests:state.dispatches.slice(start),finalAt:state.finalAt};},sentBefore);
    row.preFinalHttpTurns=dispatch.requests.filter(request=>dispatch.finalAt!==null&&request.at<dispatch.finalAt).length;row.postFinalHttpTurns=dispatch.requests.length-row.preFinalHttpTurns;
    const exact=dispatch.requests.length===c.prepared.length&&dispatch.requests.every((request,index)=>request.text===c.prepared[index])&&dispatch.requests.at(-1)?.text===c.text;
    if(!exact||row.postFinalHttpTurns!==0){row.pass=false;row.failure='preparation_not_reused';}
   }
   if(!('prepared'in c)&&row.httpTurns!==1){row.pass=false;row.failure='unexpected_http_turn_count';}
   if(row.turns.some(turn=>turn.status!==0&&(turn.status!==200||turn.totalRequests===null))){row.pass=false;row.failure='request_budget_or_transport';fatal=true;}
   rows.push(row);await persistProgress();console.log(JSON.stringify({caseId:row.caseId,pass:row.pass,failure:row.failure??null,httpTurns:row.httpTurns,providerRequests:row.providerRequests,progress:output+'.progress.json'}));if(fatal)break;
  }
 }finally{
  const finalBudget=await budget().catch(()=>null);
  const actualProviderRequests=finalBudget?finalBudget.requestCount-providerStart:rows.reduce((n,row)=>n+(row.providerRequests??0),0);
  await fs.mkdir(path.dirname(output),{recursive:true});
  await fs.writeFile(output,JSON.stringify({schemaVersion:2,model,provider,measurement:'Real OpenRouter; synthetic recognition excludes physical ASR, natural endpointing and physical paint. Prepared stable final emitted at1200ms; revised interim at900ms/final2000ms regardless provider readiness. Cold requires fresh server. Background store search, photos and pricing are isolated.',providerBudget:60,httpTurnLimit:12,actualProviderRequests,complete:rows.length===cases.length,selectedCases:cases.map(c=>c.id),budgetExceeded:finalBudget?.budgetExceeded??null,rows},null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({output,cases:rows.length,passed:rows.filter(row=>row.pass).length,actualProviderRequests}));
 }
 expect(rows.length).toBe(cases.length);expect(rows.every(row=>row.pass)).toBe(true);expect(rows.reduce((n,row)=>n+(metric(row.providerRequests)??60),0)).toBeLessThanOrEqual(60);
});
