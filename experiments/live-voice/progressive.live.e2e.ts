import {expect,test} from 'e2e';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
/** Explicit opt-in: one REAL interpretation, synthetic speech, no audio or credentials in artifacts. */
test('prepared interim through real API commits matching final without another request',async({app,screen,browser})=>{
 await browser.addInitScript(()=>{class Recognition{lang='';continuous=false;interimResults=false;onresult:((event:unknown)=>void)|null=null;onaudiostart:(()=>void)|null=null;onspeechend:(()=>void)|null=null;onend=null;onerror=null;start(){(window as unknown as {preparedVoice:Recognition}).preparedVoice=this;this.onaudiostart?.();}stop(){}abort(){}};(window as unknown as {SpeechRecognition:typeof Recognition}).SpeechRecognition=Recognition;});
 await browser.route('https://cloudassets.starbucks.com/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'}));
 const configResponse=browser.waitForResponse('**/api/config');await app.open('/');expect((await (await configResponse).json() as {liveAvailable?:boolean}).liveAvailable).toBe(true);
 let httpTurns=0;await browser.evaluate(()=>{const original=window.fetch.bind(window);(window as unknown as {preparedHttpTurns:number}).preparedHttpTurns=0;window.fetch=(...args)=>{if(args[0]==='/api/turn')(window as unknown as {preparedHttpTurns:number}).preparedHttpTurns++;return original(...args);};});
 await screen.getByRole('button',{name:'Start microphone'}).click();const response=browser.waitForResponse('**/api/turn',{timeout:70_000});
 await browser.evaluate(()=>{(window as unknown as {preparedVoice:{onresult:(event:unknown)=>void}}).preparedVoice.onresult({results:[{isFinal:false,0:{transcript:'one latte'}}]});});
 const turn=await response;expect(turn.status).toBe(200);const data=await turn.json() as {clarification?:string|null;metrics?:{totalRequests?:number}};expect(data.clarification??null).toBe(null);
 const preview=screen.getByRole('complementary',{name:'Voice order preview'}),cart=screen.getByRole('complementary',{name:'Your order'});await expect(preview.getByRole('heading',{name:'Caffè Latte',exact:true})).toBeVisible();await expect(cart.getByRole('heading',{name:'Caffè Latte',exact:true})).toHaveCount(0);
 await browser.evaluate(()=>{const r=(window as unknown as {preparedVoice:{onspeechend:(()=>void)|null;onresult:(event:unknown)=>void}}).preparedVoice;r.onspeechend?.();r.onresult({results:[{isFinal:true,0:{transcript:'one latte'}}]});});
 await expect(cart.getByRole('heading',{name:'Caffè Latte',exact:true})).toBeVisible();await expect(preview).toHaveCount(0);await expect(screen.getByLabel('Local voice timing')).toBeVisible();
 httpTurns=await browser.evaluate(()=>(window as unknown as {preparedHttpTurns:number}).preparedHttpTurns);expect(httpTurns).toBe(1);
 await screen.getByLabel('Local voice timing').getByText('Local voice timing',{exact:true}).click();
 const local=JSON.parse(await browser.locator('[aria-label="Local voice timing"] pre').textContent()??'{}'),durationsMs:Record<string,number>={};
 for(const key of ['micClick','interimTranscript','preparationStarted','fetchStart','fetchHeaders','responseParsed','preparationReady','speechEnd','finalTranscript','preparationReused','submit','commandsApplied','layoutCommit','nextFrame']){const value=local.milestones?.[key];expect(typeof value).toBe('number');expect(Number.isFinite(value)&&value>=0).toBe(true);durationsMs[key]=value;}
 expect(durationsMs.responseParsed).toBeLessThan(durationsMs.finalTranscript);expect(data.metrics?.totalRequests??99).toBeLessThanOrEqual(4);
 const evidence={schemaVersion:1,measurement:'Synthetic interim/final recognition events with real model API; final is deliberately emitted only after preview is ready. Demonstrates work overlap, not natural speech endpointing or physical paint.',httpTurns,actualProviderRequests:data.metrics?.totalRequests,durationsMs,finalToCommandsMs:durationsMs.commandsApplied-durationsMs.finalTranscript,finalToNextFrameMs:durationsMs.nextFrame-durationsMs.finalTranscript};
 const output=path.resolve('work/live-voice-smoke',`progressive-${Date.now()}-${randomUUID()}.json`);await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({output,httpTurns,actualProviderRequests:evidence.actualProviderRequests,finalToNextFrameMs:evidence.finalToNextFrameMs}));
});
