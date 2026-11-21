import {mkdirSync,writeFileSync} from 'node:fs';
import {expect,test} from 'e2e';
import {chooseStore} from './store-fixture';

const summarize=(samples:number[])=>{const sorted=[...samples].sort((a,b)=>a-b);return {samples:samples.length,medianMs:sorted[Math.floor(sorted.length/2)],p95Ms:sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*.95)-1)],maxMs:sorted.at(-1)};};
function save(name:string,value:unknown){mkdirSync('work',{recursive:true});writeFileSync(`work/interaction-${name}.json`,JSON.stringify(value,null,2)+'\n');}

test('manual cart interaction benchmark preserves every add and size change',async({app,screen,browser})=>{
 await browser.route('https://cloudassets.starbucks.com/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'}));
 await browser.route('**/api/config',route=>route.fulfill({json:{liveAvailable:true,pricing:{available:false}}}));
 await app.open('/');await chooseStore(screen);
 await expect(screen.getByRole('button',{name:'Add Caffè Latte',exact:true})).toBeVisible();
 const samples=await browser.evaluate(async()=>{
  const frame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
  const cart=document.querySelector('[aria-label="Your order"]')!;
  const add=document.querySelector<HTMLButtonElement>('button[aria-label="Add Caffè Latte"]')!;
  const additions:number[]=[],modifiers:number[]=[];
  for(let index=0;index<30;index++){
   const start=performance.now();add.click();await frame();
   if(cart.querySelectorAll('article.drink').length!==index+1)throw Error('Lost cart addition');
   additions.push(performance.now()-start);
  }
  const row=cart.querySelector('article.drink')!;
  const size=row.querySelector<HTMLSelectElement>('select')!;
  const options=Array.from(size.options).map(option=>option.value).filter(Boolean);
  if(options.length<2)throw Error('Size choices required');
  for(let index=0;index<30;index++){
   const selected=options[index%2],start=performance.now();size.value=selected;size.dispatchEvent(new Event('change',{bubbles:true}));await frame();
   if(!row.querySelector('.drink-summary')?.textContent?.toLowerCase().includes(selected.toLowerCase()))throw Error('Lost size change');
   modifiers.push(performance.now()-start);
  }
  return {additions,modifiers};
 });
 const result={measurement:'DOM event dispatch to next animation frame; synthetic, not physical paint or INP',cartSize:30,add:summarize(samples.additions),sizeChange:summarize(samples.modifiers)};
 save('manual',result);console.log('INTERACTION_BENCHMARK '+JSON.stringify(result));
 expect(samples.additions).toHaveLength(30);expect(samples.modifiers).toHaveLength(30);
});

test('revised voice benchmark commits only matching final speech',async({app,screen,browser})=>{
 let requests=0;const transcripts:string[]=[];
 await browser.addInitScript(()=>{class Recognition{lang='';continuous=false;interimResults=false;onresult:((event:unknown)=>void)|null=null;onend=null;onerror=null;start(){(window as unknown as {testRecognition:Recognition}).testRecognition=this;}stop(){}abort(){}};(window as unknown as {SpeechRecognition:typeof Recognition}).SpeechRecognition=Recognition;});
 await browser.route('https://cloudassets.starbucks.com/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'}));
 await browser.route('**/api/config',route=>route.fulfill({json:{liveAvailable:true,pricing:{available:false}}}));
 await browser.route('**/api/turn',async route=>{
  requests++;const input=JSON.parse(route.request.postData??'{}');transcripts.push(input.text);await new Promise(resolve=>setTimeout(resolve,200));
  try{await route.fulfill({json:{turnId:input.turnId,baseRevision:input.baseRevision,commands:[{type:'add',productId:input.text==='one americano'?'americano':'cold-brew'}],clarification:null,pending:null}});}catch{}
 });
 await app.open('/');await chooseStore(screen);
 const samples:number[]=[];
 for(let index=0;index<5;index++){
  await screen.getByRole('button',{name:'Start microphone'}).click();
  await browser.evaluate(async()=>{const r=(window as unknown as {testRecognition:{onresult:(event:unknown)=>void}}).testRecognition;r.onresult({results:[{isFinal:false,0:{transcript:'one americano'}}]});await new Promise(resolve=>setTimeout(resolve,950));r.onresult({results:[{isFinal:false,0:{transcript:'one cold brew'}}]});await new Promise(resolve=>setTimeout(resolve,950));});
  const beforeFinal=requests;
  expect(transcripts.slice(-2)).toEqual(['one americano','one cold brew']);
  expect(beforeFinal).toBe((index+1)*2);
  const elapsed=await browser.evaluate(async()=>{
   const cart=document.querySelector('[aria-label="Your order"]')!,before=cart.querySelectorAll('article.drink').length;
   const r=(window as unknown as {testRecognition:{onresult:(event:unknown)=>void}}).testRecognition;
   const start=performance.now();r.onresult({results:[{isFinal:true,0:{transcript:'one cold brew'}}]});
   for(let frame=0;frame<180;frame++){await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));if(cart.querySelectorAll('article.drink').length===before+1)return performance.now()-start;}
   throw Error('Final transcript did not update cart');
  });
  samples.push(elapsed);expect(requests).toBe(beforeFinal);
 }
 const cart=screen.getByRole('complementary',{name:'Your order'});
 await expect(cart.getByRole('heading',{name:'Cold Brew',exact:true})).toHaveCount(5);
 await expect(cart.getByRole('heading',{name:'Caffè Americano',exact:true})).toHaveCount(0);
 const result={measurement:'synthetic final transcript to matching cart DOM at animation frame; mocked200ms inference; excludes physical ASR',finalToCart:summarize(samples),requests,preparationRequests:requests,finalRequests:0,microphoneSessions:5};
 save('voice',result);console.log('VOICE_BENCHMARK '+JSON.stringify(result));expect(requests).toBeLessThanOrEqual(15);
});
