import {chooseStore} from './store-fixture';
import {expect,test} from 'e2e';
import directory from '../src/catalog/data/starbucks-menu-directory.json' with {type:'json'};
import type {CatalogSnapshot} from '../src/catalog/contracts';
import type {Browser} from '@e2e-dev/web';
import {quoteOrder} from '../src/domain/pricing.mjs';

// Keep modifier/undo prices deterministic while exercising the live quote path.
async function mockModifierPrices(browser:Browser){
 await browser.route('**/api/config',route=>route.fulfill({json:{liveAvailable:true,provider:'test-fixture',model:'deterministic-test-only',pricing:{available:true}}}));
 await browser.route('**/api/quote',route=>{
  const {order,storeId}=JSON.parse(route.request.postData??'{}'),quote=quoteOrder(order);
  return route.fulfill({json:{...quote,revision:order.revision,source:'starbucks',storeId,storeNumber:'85278-313836',expiresAt:Date.now()+60000,taxCents:quote.subtotalCents===null?null:0}});
 });
}

test('a pristine typed order uses the same current Flat White recipe as the menu',async({app,screen})=>{
 await app.open('/');await chooseStore(screen);
 await expect(screen.getByRole('button',{name:'Add Flat White'})).toBeVisible();
 await screen.getByRole('textbox',{name:'Tell us your order'}).fill('Flat white');
 await screen.getByRole('button',{name:'Send order'}).click();
 const order=screen.getByRole('complementary',{name:'Your order'});
 await expect(order.getByText('grande · hot · whole',{exact:true})).toBeVisible();
 await expect(order.getByText('shots: 3',{exact:true})).toBeVisible();
});

test('recipe refresh preserves active cart and native full-menu items',async({app,screen,browser})=>{
 const response=browser.waitForResponse('**/api/catalog');await app.open('/');await chooseStore(screen);
 const original=await(await response).json<CatalogSnapshot>(),refreshed=structuredClone(original);refreshed.version+='-ui-refresh';
 await screen.getByRole('button',{name:'Add Caffè Latte'}).click();
 const order=screen.getByRole('complementary',{name:'Your order'});
 const revision=await browser.evaluate(()=>document.querySelector('aside.cart')!.getAttribute('data-commit-revision'));
 await screen.getByText('Order catalog details',{exact:true}).click();
 await expect(screen.getByText(original.version,{exact:true})).toBeVisible();
 await browser.route('**/api/catalog',route=>route.fulfill({json:refreshed}));
 await screen.getByRole('button',{name:'Refresh menu',exact:true}).click();
 await screen.getByText('Catalog details',{exact:true}).click();
 await expect(screen.getByText('Menu version '+directory.version,{exact:true})).toBeVisible();
 await expect(order.getByRole('heading',{name:'Caffè Latte'})).toBeVisible();
 await expect(screen.getByText(original.version,{exact:true})).toBeVisible();
 expect(await browser.evaluate(()=>document.querySelector('aside.cart')!.getAttribute('data-commit-revision'))).toBe(revision);
 await screen.getByRole('button',{name:'Start new order',exact:true}).click();
 await expect(order.getByRole('heading',{name:'Caffè Latte'})).toHaveCount(0);
 await screen.getByRole('button',{name:'Add Flat White'}).click();
 await expect(order.getByRole('heading',{name:'Flat White',exact:true})).toBeVisible();
 await expect(order.getByText('Price unavailable',{exact:true}).first()).toBeVisible();
 await expect(screen.getByText(refreshed.version,{exact:true})).toBeVisible();
});

test('an invalid refreshed recipe retains the old menu and current cart',async({app,screen,browser})=>{
 const response=browser.waitForResponse('**/api/catalog');await app.open('/');await chooseStore(screen);
 const original=await(await response).json<CatalogSnapshot>(),invalid=structuredClone(original);invalid.version+='-ui-invalid';invalid.products[0].sizes[0].recipe.defaults.shots='many';
 await screen.getByRole('button',{name:'Add Caffè Latte'}).click();
 await browser.route('**/api/catalog',route=>route.fulfill({json:invalid}));
 await screen.getByRole('button',{name:'Refresh menu',exact:true}).click();
 await expect(screen.getByText('Refresh failed. Showing the last good menu.',{exact:true})).toBeVisible();
 await expect(screen.getByRole('complementary',{name:'Your order'}).getByRole('heading',{name:'Caffè Latte'})).toBeVisible();
 await screen.getByText('Catalog details',{exact:true}).click();
 await expect(screen.getByText('Menu version '+directory.version,{exact:true})).toBeVisible();
 await screen.getByRole('button',{name:'Start new order',exact:true}).click();
 await screen.getByRole('button',{name:'Add Flat White'}).click();
 await expect(screen.getByRole('complementary',{name:'Your order'}).getByRole('heading',{name:'Flat White',exact:true})).toBeVisible();
});

test('first desktop fold exposes drink add actions and the persistent composer',async({app,screen,browser})=>{
 await browser.setViewport({width:1440,height:900});
 await app.open('/');await chooseStore(screen);
 await expect(screen.getByRole('button',{name:'Add Cold Brew'})).toBeVisible();
 const geometry=await browser.evaluate(()=>({composer:document.querySelector('#order-input')!.getBoundingClientRect().bottom,cards:Array.from(document.querySelectorAll('.product-card')).slice(0,3).map(card=>card.getBoundingClientRect().bottom),height:innerHeight}));
 expect(geometry.composer).toBeLessThanOrEqual(geometry.height);
 expect(Math.max(...geometry.cards)).toBeLessThanOrEqual(geometry.height);
 const photos=await browser.evaluate(()=>Array.from(document.querySelectorAll('.product-photo')).slice(0,3).map(frame=>{const media=frame.querySelector('img,svg')!,box=frame.getBoundingClientRect(),image=media.getBoundingClientRect();return {frameHeight:box.height,mediaHeight:image.height,top:image.top-box.top,bottom:image.bottom-box.bottom,fit:getComputedStyle(media).objectFit};}));
 for(const photo of photos){expect(photo.mediaHeight).toBeLessThanOrEqual(photo.frameHeight+.5);expect(photo.top).toBeGreaterThanOrEqual(-.5);expect(photo.bottom).toBeLessThanOrEqual(.5);expect(photo.fit).toBe('contain');}
});

test('full menu filters product cards and adds an unpriced source drink',async({app,screen})=>{
 await app.open('/');await chooseStore(screen);
 await expect(screen.getByRole('heading',{name:'Find your next favorite.'})).toBeVisible();
 const menu=screen.getByRole('region',{name:'Full menu'});
 await expect(menu.getByRole('img',{name:'Caffè Latte · product photo'})).toBeVisible();
 await menu.getByRole('navigation',{name:'Menu categories'}).getByRole('button',{name:'Food',exact:true}).click();
 await expect(menu.getByRole('button',{name:'Add Caffè Mocha'})).toHaveCount(0);
 await menu.getByRole('navigation',{name:'Menu categories'}).getByRole('button',{name:'All menu',exact:true}).click();
 await menu.getByRole('searchbox',{name:'Search menu'}).fill('Caffè Latte');
 await expect(menu.getByRole('button',{name:'Add Caffè Latte'})).toBeVisible();
 await expect(menu.getByRole('button',{name:'Add Caffè Mocha'})).toHaveCount(0);
 await menu.getByRole('button',{name:'Add Caffè Latte'}).click();
 const order=screen.getByRole('complementary',{name:'Your order'});
 await expect(order.getByRole('heading',{name:'Caffè Latte'})).toBeVisible();
 await expect(order.getByText('Tax Price unavailable',{exact:true})).toBeVisible();
 await expect(screen.getByText(/Catalog source: Starbucks website/)).toBeVisible();
});

test('mobile cart opens as a keyboard reachable dialog and restores menu access',async({app,screen,browser})=>{
 await browser.setViewport({width:390,height:844});
 await app.open('/');await chooseStore(screen);
 await screen.getByRole('button',{name:'Add Caffè Latte'}).click();
 const drawer=screen.getByRole('dialog',{name:'Your order'});
 await expect(drawer).toBeVisible();
 await expect(drawer.getByRole('heading',{name:'Caffè Latte'})).toBeVisible();
 await drawer.getByRole('button',{name:'Close order'}).click();
 await expect(drawer).not.toBeVisible();
 await screen.getByRole('button',{name:/View order/}).click();
 await expect(drawer).toBeVisible();
 await browser.keyboard.press('Escape');
 await expect(drawer).not.toBeVisible();
 await expect(screen.getByRole('button',{name:/View order/})).toBeFocused();
 await expect(screen.getByRole('textbox',{name:'Tell us your order'})).toBeVisible();
 await expect(screen.getByRole('button',{name:'Test menu',exact:true})).toHaveCount(0);
});

test('broken product photos keep a stable fallback and remain orderable',async({app,screen,browser})=>{
 await browser.route('https://cloudassets.starbucks.com/**',route=>route.fulfill({status:404,body:''}));
 await app.open('/');await chooseStore(screen);
 const menu=screen.getByRole('region',{name:'Full menu'});
 await menu.getByRole('searchbox',{name:'Search menu'}).fill('Caffè Latte');
 await expect(menu.getByRole('img',{name:'Caffè Latte · photo unavailable'})).toBeVisible();
 await menu.getByRole('button',{name:'Add Caffè Latte'}).click();
 await expect(screen.getByRole('complementary',{name:'Your order'}).getByRole('heading',{name:'Caffè Latte'})).toBeVisible();
});

test('reduced motion preserves rapid modifier and undo results without animations',async({app,screen,browser})=>{
 await mockModifierPrices(browser);
 await browser.emulateMedia({reducedMotion:'reduce'});
 await browser.addInitScript(()=>{const animate=Element.prototype.animate;(window as unknown as {baristaAnimationCalls:number}).baristaAnimationCalls=0;Element.prototype.animate=function(...args:Parameters<Element['animate']>){(window as unknown as {baristaAnimationCalls:number}).baristaAnimationCalls++;return animate.apply(this,args);};});
 await app.open('/');await chooseStore(screen);
 await screen.getByRole('textbox',{name:'Tell us your order'}).fill('a latte');
 await screen.getByRole('button',{name:'Send order'}).click();
 const order=screen.getByRole('complementary',{name:'Your order'});
 await order.getByText(/^Customize\s*\+$/).click();
 await order.getByLabel('shots',{exact:true}).fill('3');
 await order.getByLabel('shots',{exact:true}).fill('4');
 await expect(order.getByText('$7.75',{exact:true}).first()).toBeVisible();
 await order.getByRole('button',{name:'Undo',exact:true}).click();
 await expect(order.getByLabel('shots',{exact:true})).toHaveValue('3');
 await expect(order.getByText('$6.50',{exact:true}).first()).toBeVisible();
 expect(await browser.evaluate(()=>(window as unknown as {baristaAnimationCalls:number}).baristaAnimationCalls)).toBe(0);
});

test('refresh outage retains the menu and active cart; reload uses bundled catalog',async({app,screen,browser})=>{
 await app.open('/');await chooseStore(screen);
 await screen.getByRole('button',{name:'Add Caffè Latte'}).click();
 const order=screen.getByRole('complementary',{name:'Your order'});
 await expect(order.getByRole('heading',{name:'Caffè Latte'})).toBeVisible();
 await browser.route('**/api/menu-directory',route=>route.fulfill({status:503,body:'unavailable'}));
 await screen.getByRole('button',{name:'Refresh menu',exact:true}).click();
 await expect(screen.getByText('Refresh failed. Showing the last good menu.',{exact:true})).toBeVisible();
 await expect(order.getByRole('heading',{name:'Caffè Latte'})).toBeVisible();
 await expect(screen.getByRole('button',{name:'Add Caffè Mocha'})).toBeVisible();
 await browser.unroute('**/api/menu-directory');
 await browser.reload();await chooseStore(screen);
 await expect(screen.getByRole('button',{name:'Add Caffè Latte'})).toBeVisible();
});

test('committed modifiers and undo show authoritative final price',async({app,screen,browser})=>{
 await mockModifierPrices(browser);
 await browser.addInitScript(()=>{const animate=Element.prototype.animate;(window as unknown as {baristaAnimationCalls:number}).baristaAnimationCalls=0;Element.prototype.animate=function(...args:Parameters<Element['animate']>){(window as unknown as {baristaAnimationCalls:number}).baristaAnimationCalls++;return animate.apply(this,args);};});
 await app.open('/');await chooseStore(screen);
 await screen.getByRole('textbox',{name:'Tell us your order'}).fill('a latte');
 await screen.getByRole('button',{name:'Send order'}).click();
 const order=screen.getByRole('complementary',{name:'Your order'});
 await order.getByText(/^Customize\s*\+$/).click();
 await order.getByLabel('shots',{exact:true}).fill('3');
 await expect(order.getByText('$6.50',{exact:true}).first()).toBeVisible();
 await order.getByRole('button',{name:'Undo',exact:true}).click();
 await expect(order.getByLabel('shots',{exact:true})).toHaveValue('2');
 await expect(order.getByText('$5.25',{exact:true}).first()).toBeVisible();
 const animationsBeforeClarification=await browser.evaluate(()=>(window as unknown as {baristaAnimationCalls:number}).baristaAnimationCalls);
 expect(animationsBeforeClarification).toBeGreaterThan(0);
 const input=screen.getByRole('textbox',{name:'Tell us your order'});
 await input.fill('make it hot and iced');
 await screen.getByRole('button',{name:'Send order'}).click();
 await expect(screen.getByText('Please choose one value for each modifier so I can keep every change.',{exact:true})).toBeVisible();
 await expect(order.getByText('$5.25',{exact:true}).first()).toBeVisible();
 expect(await browser.evaluate(()=>(window as unknown as {baristaAnimationCalls:number}).baristaAnimationCalls)).toBe(animationsBeforeClarification);
});
