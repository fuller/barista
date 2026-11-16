import {expect,test} from 'e2e';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
const milestones=['micClick','recognitionStart','audioStart','speechEnd','finalTranscript','submit','fetchStart','fetchHeaders','responseParsed','commandsApplied','layoutCommit','nextFrame'];
const metricKeys=['totalRequests','extractionRequests','decisionRequests','cacheHits','extractionMs','decisionMs','totalMs'];
/** This explicit config uses the REAL local API. Synthetic recognition is not microphone latency. */
test('synthetic voice final through real live API commits cold and warm carts',async({app,screen,browser})=>{
 await browser.addInitScript(()=>{class Recognition{lang='';continuous=false;interimResults=false;onresult:((event:unknown)=>void)|null=null;onaudiostart:(()=>void)|null=null;onspeechend:(()=>void)|null=null;onend:(()=>void)|null=null;onerror=null;start(){(window as unknown as {syntheticVoice:Recognition}).syntheticVoice=this;this.onaudiostart?.();}stop(){}abort(){}};(window as unknown as {SpeechRecognition:typeof Recognition}).SpeechRecognition=Recognition;});
 await browser.route('https://cloudassets.starbucks.com/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'}));
 const configResponse=browser.waitForResponse('**/api/config');await app.open('/');const config=await (await configResponse).json() as {liveAvailable?:boolean};expect(config.liveAvailable).toBe(true);
 const rows:Array<{phase:string;cartNames:string[];durationsMs:Record<string,number>;wireMetrics:Record<string,number|null>}>=[];
 for(const phase of ['cold-after-server-restart','warm-same-process']){
  if(rows.length){await screen.getByRole('button',{name:'Start new order',exact:true}).click();await expect(screen.getByRole('complementary',{name:'Your order'}).getByRole('heading',{name:'Caffè Latte',exact:true})).toHaveCount(0);}
  await screen.getByRole('button',{name:'Start microphone'}).click();const response=browser.waitForResponse('**/api/turn',{timeout:70_000});
  await browser.evaluate(()=>{const r=(window as unknown as {syntheticVoice:{onspeechend:(()=>void)|null;onresult:(event:unknown)=>void}}).syntheticVoice;r.onspeechend?.();r.onresult({results:[{isFinal:true,0:{transcript:'one latte'}}]});});
  const turnResponse=await response;expect(turnResponse.status).toBe(200);const data=await turnResponse.json() as {commands?:unknown[];clarification?:string|null;metrics?:Record<string,unknown>};expect(data.clarification??null).toBe(null);expect(data.commands?.length).toBe(1);
  const cart=screen.getByRole('complementary',{name:'Your order'});await expect(cart.getByRole('heading',{name:'Caffè Latte',exact:true})).toBeVisible();
  const diagnostic=screen.getByLabel('Local voice timing');await expect(diagnostic).toBeVisible();await diagnostic.getByText('Local voice timing',{exact:true}).click();
  const local=JSON.parse(await browser.locator('[aria-label="Local voice timing"] pre').textContent()??'{}');const durationsMs:Record<string,number>={};
  for(const key of milestones){const value=local.milestones?.[key];expect(typeof value).toBe('number');expect(Number.isFinite(value)&&value>=0).toBe(true);durationsMs[key]=value;}
  const wireMetrics:Record<string,number|null>={};for(const key of metricKeys){const value=data.metrics?.[key];wireMetrics[key]=typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;}
  expect(wireMetrics.totalRequests).not.toBe(null);rows.push({phase,cartNames:[await cart.getByRole('heading',{name:'Caffè Latte',exact:true}).textContent()??''],durationsMs,wireMetrics});
 }
 const actualProviderRequests=rows.reduce((n,row)=>n+(row.wireMetrics.totalRequests??0),0);expect(actualProviderRequests).toBeLessThanOrEqual(6);
 const output=path.resolve('work/live-voice-smoke',`synthetic-voice-${Date.now()}-${randomUUID()}.json`);await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify({schemaVersion:1,measurement:'Synthetic recognition final to real API and committed cart animation frame; no physical microphone or paint claim. Cold label requires a fresh server process before this run.',actualProviderRequests,rows},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({output,actualProviderRequests}));
});
