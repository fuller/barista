import {chooseStore} from './store-fixture';
import {expect,test} from 'e2e';

test('empty search recovers the full menu and rapid adds remain available',async({app,screen})=>{
 await app.open('/');await chooseStore(screen);
 const menu=screen.getByRole('region',{name:'Full menu'}),search=menu.getByRole('searchbox',{name:'Search menu'});
 await menu.getByRole('navigation',{name:'Menu categories'}).getByRole('button',{name:'Food',exact:true}).click();
 await search.fill('no-such-drink-123');
 await expect(menu.getByRole('heading',{name:'No matching items'})).toBeVisible();
 await menu.getByRole('button',{name:'Clear filters',exact:true}).click();
 await expect(search).toBeFocused();await expect(search).toHaveValue('');
 await expect(menu.getByRole('button',{name:'Add Caffè Latte',exact:true})).toBeVisible();
 const add=menu.getByRole('button',{name:'Add Caffè Latte',exact:true});
 await add.click();await expect(add).toHaveText('✓ Added');await add.click();
 const cart=screen.getByRole('complementary',{name:'Your order'});
 await expect(cart.getByRole('heading',{name:'Caffè Latte',exact:true})).toHaveCount(2);
 await expect(cart.getByText('2 items',{exact:true})).toBeVisible();
});

test('cart keeps rejected request drafts and exposes editing only when requested',async({app,screen})=>{
 await app.open('/');await chooseStore(screen);await screen.getByRole('button',{name:'Add Caffè Latte',exact:true}).click();
 const cart=screen.getByRole('complementary',{name:'Your order'}),notes=cart.getByLabel('Caffè Latte instructions',{exact:true});
 await expect(notes).not.toBeVisible();
 await cart.getByLabel('Edit Caffè Latte',{exact:true}).click();
 const invalid=Array.from({length:21},(_,i)=>'Request '+i).join('\n');
 await notes.fill(invalid);await cart.getByRole('heading',{name:'Caffè Latte',exact:true}).click();
 await expect(cart.getByRole('alert')).toHaveText('Keep up to 20 requests. Your edits are still here.');
 await cart.getByLabel('Caffè Latte quantity',{exact:true}).fill('2');
 await expect(notes).toHaveValue(invalid);
 await notes.fill('Oat milk\nHalf sweet');await cart.getByRole('heading',{name:/Caffè Latte/}).click();
 await expect(cart.getByRole('alert')).toHaveCount(0);
 await cart.getByLabel('Edit Caffè Latte',{exact:true}).click();
 await expect(cart.getByText('Oat milk · Half sweet',{exact:true})).toBeVisible();
});

test('keyboard cart additions apply immediately without programmatic motion',async({app,screen,browser})=>{
 await browser.addInitScript(()=>{const animate=Element.prototype.animate;(window as unknown as {motionCalls:number}).motionCalls=0;Element.prototype.animate=function(...args:Parameters<Element['animate']>){(window as unknown as {motionCalls:number}).motionCalls++;return animate.apply(this,args);};});
 await app.open('/');await chooseStore(screen);
 await browser.evaluate(()=>document.querySelector<HTMLButtonElement>('button[aria-label="Add Caffè Latte"]')!.focus());
 await browser.keyboard.press('Enter');
 await expect(screen.getByRole('complementary',{name:'Your order'}).getByRole('heading',{name:'Caffè Latte',exact:true})).toBeVisible();
 expect(await browser.evaluate(()=>(window as unknown as {motionCalls:number}).motionCalls)).toBe(0);
});

test('mobile order composer and search remain legible without page overflow',async({app,screen,browser})=>{
 await browser.setViewport({width:390,height:844});await app.open('/');await chooseStore(screen);
 await expect(screen.getByRole('textbox',{name:'Tell us your order'})).toBeVisible();
 const geometry=await browser.evaluate(()=>({width:innerWidth,content:document.documentElement.scrollWidth,fields:['#order-input','input[type=search]','.menu-path-filter select'].map(selector=>parseFloat(getComputedStyle(document.querySelector(selector)!).fontSize)),targets:['button[aria-label="Send order"]','button[aria-label="Start microphone"]'].map(selector=>{const r=document.querySelector(selector)!.getBoundingClientRect();return {width:r.width,height:r.height};})}));
 expect(geometry.content).toBeLessThanOrEqual(geometry.width);
 for(const fontSize of geometry.fields)expect(fontSize).toBeGreaterThanOrEqual(16);
 for(const target of geometry.targets){expect(target.width).toBeGreaterThanOrEqual(44);expect(target.height).toBeGreaterThanOrEqual(44);}
 await app.screenshot('order-composer-mobile');
});


test('short mobile viewport can scroll the whole cart to confirmation and undo',async({app,screen,browser})=>{
 await browser.setViewport({width:390,height:300});await app.open('/');await chooseStore(screen);
 await screen.getByRole('button',{name:'Add Caffè Latte',exact:true}).click();
 const cart=screen.getByRole('dialog',{name:'Your order'});
 await expect(cart).toBeVisible();
 await cart.getByRole('button',{name:'Confirm order',exact:true}).click();
 await expect(cart.getByText('Simulated receipt only. No payment taken or café order placed.',{exact:true})).toBeVisible();
 await cart.getByRole('button',{name:'Undo',exact:true}).click();
 await expect(cart.getByRole('button',{name:'Confirm order',exact:true})).toBeEnabled();
});
