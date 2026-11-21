import {expect,test} from 'e2e';
import {chooseStore} from './store-fixture';

test('menu and cart demo prices render before a held live request and remain after failure',async({app,screen,browser})=>{
 let release:()=>void=()=>{};const held=new Promise<void>(resolve=>{release=resolve;});let calls=0;
 await browser.route('**/api/config',route=>route.fulfill({json:{liveAvailable:true,pricing:{available:true,cacheScope:'demo-fallback-session'}}}));
 await browser.route('**/api/quote',async route=>{calls++;await held;return route.fulfill({status:503,json:{error:'Live pricing unavailable'}});});
 await app.open('/');await chooseStore(screen);
 const menu=screen.getByRole('region',{name:'Full menu'}),cart=screen.getByRole('complementary',{name:'Your order'});
 await expect(menu.getByText('Demo estimate',{exact:true}).first()).toBeVisible();
 await menu.getByRole('button',{name:'Add Caffè Latte',exact:true}).click();
 try{
  await expect(cart.getByText('Demo estimate',{exact:true})).toBeVisible();
  await expect(cart.getByText(/^\$\d+\.\d{2}$/).first()).toBeVisible();
  expect(await browser.evaluate(()=>document.querySelector('[data-subtotal]')?.textContent)).toMatch(/^\$\d+\.\d{2}$/);
  await expect.poll(()=>calls).toBe(1);
  expect(await browser.evaluate(()=>sessionStorage.getItem('barista:price-quotes:v1'))).toBe(null);
 }finally{release();}
 await expect(cart.getByText(/live pricing unavailable/i)).toBeVisible();
 const original=await browser.evaluate(()=>document.querySelector('aside.cart [data-item-price]')?.textContent);
 await cart.getByLabel('Edit Caffè Latte',{exact:true}).click();await cart.getByLabel('Caffè Latte size',{exact:true}).selectOption('Tall');
 await expect(cart.getByText('Demo estimate',{exact:true})).toBeVisible();
 await expect.poll(()=>browser.evaluate(()=>document.querySelector('aside.cart [data-item-price]')?.textContent)).not.toBe(original);
 expect(await browser.evaluate(()=>sessionStorage.getItem('barista:price-quotes:v1'))).toBe(null);
});

test('a verified whole-cart quote replaces demo pricing and alone enters the live cache',async({app,screen,browser})=>{
 let release:()=>void=()=>{};const held=new Promise<void>(resolve=>{release=resolve;});
 await browser.route('**/api/config',route=>route.fulfill({json:{liveAvailable:true,pricing:{available:true,cacheScope:'verified-demo-session'}}}));
 await browser.route('**/api/quote',async route=>{
  const {order,storeId}=JSON.parse(route.request.postData??'{}');await held;
  return route.fulfill({json:{cacheScope:'verified-demo-session',source:'starbucks',estimated:false,storeId,storeNumber:'85278-313836',revision:order.revision,currency:'USD',expiresAt:Date.now()+60000,items:order.menuItems.map(item=>({itemId:item.id,quantity:item.quantity,unitCents:500,totalCents:500*item.quantity,lines:[{label:'Verified drink',amountCents:500}]})),subtotalCents:500,taxCents:44,totalCents:544}});
 });
 await app.open('/');await chooseStore(screen);await screen.getByRole('button',{name:'Add Caffè Latte',exact:true}).click();
 const cart=screen.getByRole('complementary',{name:'Your order'});
 try{await expect(cart.getByText('Demo estimate',{exact:true})).toBeVisible();}finally{release();}
 await expect(cart.getByText('$5.00',{exact:true}).first()).toBeVisible();await expect(cart.getByText('Tax $0.44',{exact:true})).toBeVisible();await expect(cart.getByText('$5.44',{exact:true})).toBeVisible();
 await expect(cart.getByText('Demo estimate',{exact:true})).toHaveCount(0);
 await expect(cart.getByText('Live prices · 104 Jay St',{exact:true})).toBeVisible();
 const records=await browser.evaluate(()=>JSON.parse(sessionStorage.getItem('barista:price-quotes:v1')??'{"entries":[]}').entries);
 expect(records.length).toBeGreaterThan(0);expect(records.every((entry:any)=>entry[1].quote.estimated===false&&entry[1].quote.source==='starbucks')).toBe(true);
});

test('food and literal customizations retain clearly estimated prices without inventing tax',async({app,screen,browser})=>{
 await browser.route('**/api/config',route=>route.fulfill({json:{liveAvailable:true,pricing:{available:false}}}));
 await app.open('/');await chooseStore(screen);const menu=screen.getByRole('region',{name:'Full menu'}),cart=screen.getByRole('complementary',{name:'Your order'});
 await menu.getByRole('searchbox',{name:'Search menu'}).fill('Bearista');await menu.getByRole('button',{name:'Add Bearista™ Cake Pop',exact:true}).click();
 await expect(cart.getByText('Demo estimate',{exact:true})).toBeVisible();await expect(cart.getByText(/^\$\d+\.\d{2}$/).first()).toBeVisible();
 await cart.getByLabel('Edit Bearista™ Cake Pop',{exact:true}).click();await cart.getByLabel('Bearista™ Cake Pop instructions').fill('with extra cream');await cart.getByRole('heading',{name:'Bearista™ Cake Pop',exact:true}).click();
 await expect(cart.getByText(/Customizations may change/i).first()).toBeVisible();await expect(cart.getByText(/Tax not included/i)).toBeVisible();
 expect(await browser.evaluate(()=>sessionStorage.getItem('barista:price-quotes:v1'))).toBe(null);
});
