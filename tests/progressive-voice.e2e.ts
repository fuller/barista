import {expect,test} from 'e2e';
declare global {interface Window {voiceTest:{sessions:Array<{emit:(text:string,final?:boolean)=>void;fail:()=>void}>}}}
async function setup(browser:any){
 await browser.addInitScript(()=>{
  window.voiceTest={sessions:[]};
  class Recognition{
   lang='';continuous=false;interimResults=false;onresult:((event:unknown)=>void)|null=null;onend:(()=>void)|null=null;onerror:((event:unknown)=>void)|null=null;onaudiostart:(()=>void)|null=null;
   start(){window.voiceTest.sessions.push({emit:(text,final=false)=>this.onresult?.({results:[{isFinal:final,0:{transcript:text}}]}),fail:()=>this.onerror?.({error:'network'})});this.onaudiostart?.();}
   stop(){}abort(){this.onend?.();}
  }
  (window as unknown as {SpeechRecognition:typeof Recognition}).SpeechRecognition=Recognition;
 });
 await browser.route('https://cloudassets.starbucks.com/**',(route:any)=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'}));
 await browser.route('**/api/config',(route:any)=>route.fulfill({json:{liveAvailable:true}}));
}
const settle=async(browser:any)=>browser.evaluate(()=>new Promise(resolve=>setTimeout(resolve,850)));
async function timingSample(screen:any,browser:any){
 const diagnostic=screen.getByLabel('Local voice timing');await expect(diagnostic).toBeVisible();await diagnostic.getByText('Local voice timing',{exact:true}).click();
 return JSON.parse(await browser.locator('[aria-label="Local voice timing"] pre').textContent()??'{}');
}

test('stable voice preview stays hypothetical and exact final reuses completed request',async({app,screen,browser})=>{
 await setup(browser);const bodies:any[]=[];
 await browser.route('**/api/turn',async route=>{const body=JSON.parse(route.request.postData??'{}');bodies.push(body);await route.fulfill({json:{turnId:body.turnId,baseRevision:body.baseRevision,commands:[{type:'add',productId:'americano'}],clarification:null,pending:null}});});
 await app.open('/');await screen.getByRole('button',{name:'Start microphone'}).click();
 await browser.evaluate(()=>window.voiceTest.sessions[0].emit('one americano'));
 const preview=screen.getByRole('complementary',{name:'Voice order preview'}),cart=screen.getByRole('complementary',{name:'Your order'});
 await expect(preview.getByText('one americano',{exact:true})).toBeVisible();expect(bodies.length).toBe(0);
 await expect(preview.getByRole('heading',{name:'Caffè Americano',exact:true})).toBeVisible();await expect(cart.getByRole('heading',{name:'Caffè Americano',exact:true})).toHaveCount(0);expect(bodies.length).toBe(1);expect(bodies[0].text).toBe('one americano');expect(bodies[0].baseRevision).toBe(0);expect(bodies[0].order.revision).toBe(0);
 await browser.evaluate(()=>window.voiceTest.sessions[0].emit('one americano',true));
 await expect(cart.getByRole('heading',{name:'Caffè Americano',exact:true})).toBeVisible();await expect(preview).toHaveCount(0);expect(bodies.length).toBe(1);
 const {milestones}=await timingSample(screen,browser);expect(milestones.fetchStart).toBeLessThan(milestones.finalTranscript);expect(milestones.responseParsed).toBeLessThan(milestones.finalTranscript);expect(milestones.commandsApplied).toBeGreaterThanOrEqual(milestones.finalTranscript);
});

test('exact final adopts in-flight preview request without a second HTTP call',async({app,screen,browser})=>{
 await setup(browser);let release=()=>{};const pending=new Promise<void>(resolve=>{release=resolve;});let calls=0;
 await browser.route('**/api/turn',async route=>{calls++;const body=JSON.parse(route.request.postData??'{}');await pending;await route.fulfill({json:{turnId:body.turnId,baseRevision:body.baseRevision,commands:[{type:'add',productId:'americano'}],clarification:null,pending:null}});});
 await app.open('/');await screen.getByRole('button',{name:'Start microphone'}).click();await browser.evaluate(()=>window.voiceTest.sessions[0].emit('one americano'));await settle(browser);expect(calls).toBe(1);
 await browser.evaluate(()=>window.voiceTest.sessions[0].emit('one americano',true));release();
 await expect(screen.getByRole('complementary',{name:'Your order'}).getByRole('heading',{name:'Caffè Americano',exact:true})).toBeVisible();expect(calls).toBe(1);
});

test('corrected final cancels speculative prefix and commits only fresh interpretation',async({app,screen,browser})=>{
 await setup(browser);let release=()=>{};const old=new Promise<void>(resolve=>{release=resolve;});const texts:string[]=[];
 await browser.route('**/api/turn',async route=>{const body=JSON.parse(route.request.postData??'{}');texts.push(body.text);if(body.text==='one americano')await old;try{await route.fulfill({json:{turnId:body.turnId,baseRevision:body.baseRevision,commands:[{type:'add',productId:body.text==='one americano'?'americano':'latte'}],clarification:null,pending:null}});}catch{/* Superseded request can be aborted. */}});
 await app.open('/');await screen.getByRole('button',{name:'Start microphone'}).click();await browser.evaluate(()=>window.voiceTest.sessions[0].emit('one americano'));await settle(browser);expect(texts.length).toBe(1);
 await browser.evaluate(()=>window.voiceTest.sessions[0].emit('one latte',true));release();
 const cart=screen.getByRole('complementary',{name:'Your order'});await expect(cart.getByRole('heading',{name:'Caffè Latte',exact:true})).toBeVisible();await expect(cart.getByRole('heading',{name:'Caffè Americano',exact:true})).toHaveCount(0);expect(texts).toEqual(['one americano','one latte']);
 const {milestones}=await timingSample(screen,browser);expect(milestones.fetchStart).toBeGreaterThanOrEqual(milestones.finalTranscript);expect(milestones.responseParsed).toBeGreaterThanOrEqual(milestones.fetchStart);expect(milestones.commandsApplied).toBeGreaterThanOrEqual(milestones.responseParsed);
});

test('manual cart edit invalidates voice preview and ignores late response and final',async({app,screen,browser})=>{
 await setup(browser);let release=()=>{};const old=new Promise<void>(resolve=>{release=resolve;});let calls=0;
 await browser.route('**/api/turn',async route=>{calls++;const body=JSON.parse(route.request.postData??'{}');await old;try{await route.fulfill({json:{turnId:body.turnId,baseRevision:body.baseRevision,commands:[{type:'add',productId:'americano'}],clarification:null,pending:null}});}catch{/* Edited cart invalidates this request. */}});
 await app.open('/');await screen.getByRole('searchbox',{name:'Search menu'}).fill('Caffè Latte');await screen.getByRole('button',{name:'Start microphone'}).click();await browser.evaluate(()=>window.voiceTest.sessions[0].emit('one americano'));await settle(browser);expect(calls).toBe(1);
 await screen.getByRole('button',{name:'Add Caffè Latte',exact:true}).click();release();await browser.evaluate(()=>window.voiceTest.sessions[0].emit('one americano',true));
 await expect(screen.getByRole('complementary',{name:'Voice order preview'})).toHaveCount(0);const cart=screen.getByRole('complementary',{name:'Your order'});await expect(cart.getByRole('heading',{name:'Caffè Latte',exact:true})).toBeVisible();await expect(cart.getByRole('heading',{name:'Caffè Americano',exact:true})).toHaveCount(0);expect(calls).toBe(1);
});

test('recognition error invalidates draft and late final cannot commit',async({app,screen,browser})=>{
 await setup(browser);let calls=0;
 await browser.route('**/api/turn',async route=>{calls++;const body=JSON.parse(route.request.postData??'{}');await route.fulfill({json:{turnId:body.turnId,baseRevision:body.baseRevision,commands:[{type:'add',productId:'americano'}],clarification:null,pending:null}});});
 await app.open('/');await screen.getByRole('button',{name:'Start microphone'}).click();await browser.evaluate(()=>window.voiceTest.sessions[0].emit('one americano'));
 await expect(screen.getByRole('complementary',{name:'Voice order preview'}).getByText('one americano',{exact:true})).toBeVisible();
 await browser.evaluate(()=>{window.voiceTest.sessions[0].fail();window.voiceTest.sessions[0].emit('one americano',true);});await settle(browser);
 await expect(screen.getByRole('complementary',{name:'Voice order preview'})).toHaveCount(0);await expect(screen.getByRole('complementary',{name:'Your order'}).getByRole('heading',{name:'Caffè Americano',exact:true})).toHaveCount(0);expect(calls).toBe(0);
});


test('failed completed prefetch falls back to a fresh final request and fresh timing',async({app,screen,browser})=>{
 await setup(browser);let calls=0;
 await browser.route('**/api/turn',async route=>{calls++;const body=JSON.parse(route.request.postData??'{}');if(calls===1){await route.fulfill({status:503,json:{error:'Temporary synthetic failure'}});return;}await route.fulfill({json:{turnId:body.turnId,baseRevision:body.baseRevision,commands:[{type:'add',productId:'americano'}],clarification:null,pending:null}});});
 await app.open('/');await screen.getByRole('button',{name:'Start microphone'}).click();await browser.evaluate(()=>window.voiceTest.sessions[0].emit('one americano'));await settle(browser);expect(calls).toBe(1);
 await browser.evaluate(()=>window.voiceTest.sessions[0].emit('one americano',true));
 await expect(screen.getByRole('complementary',{name:'Your order'}).getByRole('heading',{name:'Caffè Americano',exact:true})).toBeVisible();expect(calls).toBe(2);
 const {milestones}=await timingSample(screen,browser);expect(milestones.fetchStart).toBeGreaterThanOrEqual(milestones.finalTranscript);expect(milestones.responseParsed).toBeGreaterThanOrEqual(milestones.fetchStart);
});

test('withdrawn interim clears preview and late speculative response stays discarded',async({app,screen,browser})=>{
 await setup(browser);let release=()=>{};const pending=new Promise<void>(resolve=>{release=resolve;});let calls=0;
 await browser.route('**/api/turn',async route=>{calls++;const body=JSON.parse(route.request.postData??'{}');await pending;try{await route.fulfill({json:{turnId:body.turnId,baseRevision:body.baseRevision,commands:[{type:'add',productId:'americano'}],clarification:null,pending:null}});}catch{/* Withdrawn interim cancels speculation. */}});
 await app.open('/');await screen.getByRole('button',{name:'Start microphone'}).click();await browser.evaluate(()=>window.voiceTest.sessions[0].emit('one americano'));await settle(browser);expect(calls).toBe(1);
 await browser.evaluate(()=>window.voiceTest.sessions[0].emit(''));await expect(screen.getByRole('complementary',{name:'Voice order preview'})).toHaveCount(0);release();await settle(browser);
 await expect(screen.getByRole('complementary',{name:'Voice order preview'})).toHaveCount(0);await expect(screen.getByRole('complementary',{name:'Your order'}).getByRole('heading',{name:'Caffè Americano',exact:true})).toHaveCount(0);expect(calls).toBe(1);
});

test('overlong final clears prepared prefix and its late response cannot commit',async({app,screen,browser})=>{
 await setup(browser);let release=()=>{};const pending=new Promise<void>(resolve=>{release=resolve;});let calls=0;
 await browser.route('**/api/turn',async route=>{calls++;const body=JSON.parse(route.request.postData??'{}');await pending;try{await route.fulfill({json:{turnId:body.turnId,baseRevision:body.baseRevision,commands:[{type:'add',productId:'americano'}],clarification:null,pending:null}});}catch{/* Invalid final cancels prepared prefix. */}});
 await app.open('/');await screen.getByRole('button',{name:'Start microphone'}).click();await browser.evaluate(()=>window.voiceTest.sessions[0].emit('one americano'));await settle(browser);expect(calls).toBe(1);
 await browser.evaluate(()=>window.voiceTest.sessions[0].emit('x'.repeat(601),true));
 try{await expect(screen.getByRole('alert')).toContainText('600 characters');await expect(screen.getByRole('complementary',{name:'Voice order preview'})).toHaveCount(0);}finally{release();}await settle(browser);
 await expect(screen.getByRole('complementary',{name:'Voice order preview'})).toHaveCount(0);await expect(screen.getByRole('complementary',{name:'Your order'}).getByRole('heading',{name:'Caffè Americano',exact:true})).toHaveCount(0);expect(calls).toBe(1);
});
