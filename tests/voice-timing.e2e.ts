import {expect,test} from 'e2e';
test('synthetic final speech survives finish and records only committed local milestones',async({app,screen,browser})=>{
 let requests=0;
 await browser.addInitScript(()=>{class Recognition{lang='';continuous=false;interimResults=false;onresult:((event:unknown)=>void)|null=null;onaudiostart:(()=>void)|null=null;onspeechend:(()=>void)|null=null;onend:(()=>void)|null=null;onerror=null;stops=0;aborts=0;start(){(window as unknown as {testRecognition:Recognition}).testRecognition=this;this.onaudiostart?.();}stop(){this.stops++;this.onspeechend?.();}abort(){this.aborts++;this.onend?.();}};(window as unknown as {SpeechRecognition:typeof Recognition}).SpeechRecognition=Recognition;});
 await browser.route('https://cloudassets.starbucks.com/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'}));
 await browser.route('**/api/config',route=>route.fulfill({json:{liveAvailable:true}}));
 await browser.route('**/api/turn',async route=>{requests++;const body=JSON.parse(route.request.postData??'{}');expect(body.text).toBe('one americano');await route.fulfill({json:{turnId:body.turnId,baseRevision:body.baseRevision,commands:[{type:'add',productId:'americano'}],clarification:null,pending:null}});});
 await app.open('/');await screen.getByRole('button',{name:'Start microphone'}).click();
 await browser.evaluate(()=>{const r=(window as unknown as {testRecognition:{onresult:(e:unknown)=>void}}).testRecognition;r.onresult({results:[{isFinal:false,0:{transcript:'one'}}]});});expect(requests).toBe(0);
 await screen.getByRole('button',{name:'Stop microphone'}).click();
 await browser.evaluate(()=>{const r=(window as unknown as {testRecognition:{stops:number;aborts:number;onresult:(e:unknown)=>void}}).testRecognition;if(r.stops!==1||r.aborts!==0)throw new Error('Finish must stop without abort');r.onresult({results:[{isFinal:true,0:{transcript:'one americano'}}]});r.onresult({results:[{isFinal:true,0:{transcript:'duplicate'}}]});});
 await expect(screen.getByRole('complementary',{name:'Your order'}).getByRole('heading',{name:'Caffè Americano',exact:true})).toBeVisible();
 const diagnostic=screen.getByLabel('Local voice timing');await expect(diagnostic).toBeVisible();await diagnostic.getByText('Local voice timing',{exact:true}).click();
 const sample=JSON.parse(await browser.locator('[aria-label="Local voice timing"] pre').textContent()??'{}');expect(sample.baseRevision).toBe(0);expect(sample.committedRevision).toBe(1);expect(typeof sample.turnId).toBe('string');
 let prior=-1;for(const key of ['micClick','recognitionStart','audioStart','speechEnd','finalTranscript','submit','fetchStart','fetchHeaders','responseParsed','commandsApplied','layoutCommit','nextFrame']){expect(typeof sample.milestones[key]).toBe('number');expect(sample.milestones[key]).toBeGreaterThanOrEqual(prior);prior=sample.milestones[key];}expect(requests).toBe(1);expect(JSON.stringify(sample).includes('americano')).toBe(false);
});
test('cancelled synthetic voice response cannot commit cart or publish timing',async({app,screen,browser})=>{
 let release=()=>{};const ready=new Promise<void>(resolve=>{release=resolve;});let requests=0;
 await browser.addInitScript(()=>{class Recognition{lang='';continuous=false;interimResults=false;onresult:((event:unknown)=>void)|null=null;onend=null;onerror=null;start(){(window as unknown as {testRecognition:Recognition}).testRecognition=this;}stop(){}abort(){}};(window as unknown as {SpeechRecognition:typeof Recognition}).SpeechRecognition=Recognition;});
 await browser.route('https://cloudassets.starbucks.com/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'}));
 await browser.route('**/api/config',route=>route.fulfill({json:{liveAvailable:true}}));
 await browser.route('**/api/turn',async route=>{requests++;const body=JSON.parse(route.request.postData??'{}');await ready;try{await route.fulfill({json:{turnId:body.turnId,baseRevision:body.baseRevision,commands:[{type:'add',productId:'cold-brew'}],clarification:null,pending:null}});}catch{/* Cancelled request is expected. */}});
 await app.open('/');await screen.getByRole('searchbox',{name:'Search menu'}).fill('Caffè Latte');await screen.getByRole('button',{name:'Start microphone'}).click();
 await browser.evaluate(()=>{const r=(window as unknown as {testRecognition:{onresult:(event:unknown)=>void}}).testRecognition;r.onresult({results:[{isFinal:true,0:{transcript:'a cold brew'}}]});});
 await expect(screen.getByRole('status').getByText('Working on your order…',{exact:true})).toBeVisible();
 await screen.getByRole('button',{name:'Add Caffè Latte',exact:true}).click();release();
 await expect(screen.getByRole('complementary',{name:'Your order'}).getByRole('heading',{name:'Caffè Latte',exact:true})).toBeVisible();
 await expect(screen.getByRole('complementary',{name:'Your order'}).getByRole('heading',{name:'Cold Brew',exact:true})).toHaveCount(0);await expect(screen.getByLabel('Local voice timing')).toHaveCount(0);await expect(screen.getByRole('searchbox',{name:'Search menu'})).toHaveValue('Caffè Latte');expect(requests).toBe(1);
});
test('new microphone cancels an older HTTP turn before binding speech to the cart',async({app,screen,browser})=>{
 let release=()=>{};const oldReady=new Promise<void>(resolve=>{release=resolve;});let requests=0;
 await browser.addInitScript(()=>{class Recognition{lang='';continuous=false;interimResults=false;onresult:((event:unknown)=>void)|null=null;onend=null;onerror=null;start(){(window as unknown as {testRecognition:Recognition}).testRecognition=this;}stop(){}abort(){}};(window as unknown as {SpeechRecognition:typeof Recognition}).SpeechRecognition=Recognition;});
 await browser.route('https://cloudassets.starbucks.com/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'}));await browser.route('**/api/config',route=>route.fulfill({json:{liveAvailable:true}}));
 await browser.route('**/api/turn',async route=>{requests++;const body=JSON.parse(route.request.postData??'{}');if(body.text==='old latte')await oldReady;try{await route.fulfill({json:{turnId:body.turnId,baseRevision:body.baseRevision,commands:[{type:'add',productId:body.text==='old latte'?'latte':'americano'}],clarification:null,pending:null}});}catch{/* Old request was aborted. */}});
 await app.open('/');await screen.getByRole('textbox',{name:'Tell us your order'}).fill('old latte');await screen.getByRole('button',{name:'Send order'}).click();await expect(screen.getByRole('status').getByText('Working on your order…',{exact:true})).toBeVisible();
 await screen.getByRole('button',{name:'Start microphone'}).click();release();
 await browser.evaluate(()=>{(window as unknown as {testRecognition:{onresult:(event:unknown)=>void}}).testRecognition.onresult({results:[{isFinal:true,0:{transcript:'one americano'}}]});});
 const cart=screen.getByRole('complementary',{name:'Your order'});await expect(cart.getByRole('heading',{name:'Caffè Americano',exact:true})).toBeVisible();await expect(cart.getByRole('heading',{name:'Caffè Latte',exact:true})).toHaveCount(0);await expect(screen.getByLabel('Local voice timing')).toBeVisible();expect(requests).toBe(2);
});
