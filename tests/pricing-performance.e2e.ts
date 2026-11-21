import {expect,test} from 'e2e';
import {chooseStore} from './store-fixture';

test('fresh exact-cart prices survive undo and changed line IDs without extra requests; refresh bypasses cache',async({app,screen,browser})=>{
 let calls=0,unitCents=500,prepares=0;
 await browser.route('**/api/config',route=>route.fulfill({json:{liveAvailable:true,pricing:{available:true,cacheScope:'price-scope-a'}}}));
 await browser.route('**/api/pricing/prepare',route=>{prepares++;return route.fulfill({json:{ready:true,cacheScope:'price-scope-a'}});});
 await browser.route('**/api/quote',async route=>{
  calls++;const {order,storeId}=JSON.parse(route.request.postData??'{}');
  const items=[...order.items,...(order.menuItems??[])].map(item=>({itemId:item.id,quantity:item.quantity,unitCents,totalCents:item.quantity*unitCents,lines:[{label:'Fixture drink',amountCents:unitCents}]}));
  const total=items.reduce((sum,item)=>sum+item.totalCents,0);
  await route.fulfill({json:{cacheScope:'price-scope-a',source:'starbucks',estimated:false,storeId,storeNumber:'85278-313836',revision:order.revision,currency:'USD',expiresAt:Date.now()+60000,items,subtotalCents:total,taxCents:0,totalCents:total}});
 });
 await app.open('/');expect(prepares).toBe(0);await chooseStore(screen);
 expect(prepares).toBe(0);expect(calls).toBe(0);
 const cart=screen.getByRole('complementary',{name:'Your order'});
 await screen.getByRole('button',{name:'Add Caffè Latte',exact:true}).click();
 await expect(cart.getByText('$5.00',{exact:true}).first()).toBeVisible();expect(calls).toBe(1);expect(prepares).toBe(0);
 await screen.getByRole('button',{name:'Add Cold Brew',exact:true}).click();
 await expect(cart.getByText('$10.00',{exact:true}).first()).toBeVisible();expect(calls).toBe(2);
 await cart.getByRole('button',{name:'Undo',exact:true}).click();
 await expect(cart.getByText('$5.00',{exact:true}).first()).toBeVisible();expect(calls).toBe(2);
 await cart.getByRole('button',{name:'Clear order',exact:true}).click();
 await screen.getByRole('button',{name:'Add Caffè Latte',exact:true}).click();
 await expect(cart.getByText('$5.00',{exact:true}).first()).toBeVisible();expect(calls).toBe(2);
 unitCents=700;await cart.getByRole('button',{name:'Refresh prices',exact:true}).click();
 await expect(cart.getByText('$7.00',{exact:true}).first()).toBeVisible();expect(calls).toBe(3);
});

test('local quote cache survives reload only inside the same caller scope',async({app,screen,browser})=>{
 let calls=0,scope='reload-scope-a';
 await browser.route('**/api/config',route=>route.fulfill({json:{liveAvailable:true,pricing:{available:true,cacheScope:scope}}}));
 await browser.route('**/api/pricing/prepare',route=>route.fulfill({json:{ready:true,cacheScope:scope}}));
 await browser.route('**/api/quote',route=>{
  calls++;const {order,storeId}=JSON.parse(route.request.postData??'{}');const items=order.menuItems.map(item=>({itemId:item.id,quantity:item.quantity,unitCents:500,totalCents:500,lines:[{label:'Fixture drink',amountCents:500}]}));
  return route.fulfill({json:{cacheScope:scope,source:'starbucks',estimated:false,storeId,storeNumber:'85278-313836',revision:order.revision,currency:'USD',expiresAt:Date.now()+60000,items,subtotalCents:500,taxCents:0,totalCents:500}});
 });
 const add=async()=>{await chooseStore(screen);await screen.getByRole('button',{name:'Add Caffè Latte',exact:true}).click();await expect(screen.getByRole('complementary',{name:'Your order'}).getByText('$5.00',{exact:true}).first()).toBeVisible();};
 await app.open('/');await add();expect(calls).toBe(1);
 await browser.reload();await add();expect(calls).toBe(1);
 scope='reload-scope-b';await browser.reload();await add();expect(calls).toBe(2);
});

test('a rotated caller scope adopts fresh prices and persists the new namespace',async({app,screen,browser})=>{
 let calls=0,scope='before-cookie-rotation';
 await browser.route('**/api/config',route=>route.fulfill({json:{liveAvailable:true,pricing:{available:true,cacheScope:scope}}}));
 await browser.route('**/api/pricing/prepare',route=>route.fulfill({json:{ready:true}}));
 await browser.route('**/api/quote',route=>{
  calls++;scope='after-cookie-rotation';const {order,storeId}=JSON.parse(route.request.postData??'{}');
  return route.fulfill({json:{cacheScope:scope,source:'starbucks',estimated:false,storeId,storeNumber:'85278-313836',revision:order.revision,currency:'USD',expiresAt:Date.now()+60000,items:order.menuItems.map(item=>({itemId:item.id,quantity:1,unitCents:500,totalCents:500,lines:[{label:'Fixture drink',amountCents:500}]})),subtotalCents:500,taxCents:0,totalCents:500}});
 });
 await app.open('/');await chooseStore(screen);await screen.getByRole('button',{name:'Add Caffè Latte',exact:true}).click();
 await expect(screen.getByRole('complementary',{name:'Your order'}).getByText('$5.00',{exact:true}).first()).toBeVisible();expect(calls).toBe(1);
 await browser.reload();await chooseStore(screen);await screen.getByRole('button',{name:'Add Caffè Latte',exact:true}).click();
 await expect(screen.getByRole('complementary',{name:'Your order'}).getByText('$5.00',{exact:true}).first()).toBeVisible();expect(calls).toBe(1);
});

test('first item creates the caller scope once; page load and store selection create no pricing session',async({app,screen,browser})=>{
 let quotes=0,prepares=0,scope:string|null=null;
 await browser.route('**/api/config',route=>route.fulfill({json:{liveAvailable:true,pricing:{available:true,cacheScope:scope}}}));
 await browser.route('**/api/pricing/prepare',route=>{prepares++;return route.fulfill({json:{ready:true}});});
 await browser.route('**/api/quote',route=>{
  quotes++;scope='lazy-caller-scope';const {order,storeId}=JSON.parse(route.request.postData??'{}');
  return route.fulfill({json:{cacheScope:scope,source:'starbucks',estimated:false,storeId,storeNumber:'85278-313836',revision:order.revision,currency:'USD',expiresAt:Date.now()+60000,items:order.menuItems.map(item=>({itemId:item.id,quantity:1,unitCents:500,totalCents:500,lines:[{label:'Fixture drink',amountCents:500}]})),subtotalCents:500,taxCents:0,totalCents:500}});
 });
 await app.open('/');expect(prepares).toBe(0);expect(quotes).toBe(0);
 await chooseStore(screen);expect(prepares).toBe(0);expect(quotes).toBe(0);
 await screen.getByRole('button',{name:'Add Caffè Latte',exact:true}).click();
 await expect(screen.getByRole('complementary',{name:'Your order'}).getByText('$5.00',{exact:true}).first()).toBeVisible();expect(quotes).toBe(1);expect(prepares).toBe(0);
 await browser.reload();await chooseStore(screen);expect(quotes).toBe(1);expect(prepares).toBe(0);
 await screen.getByRole('button',{name:'Add Caffè Latte',exact:true}).click();
 await expect(screen.getByRole('complementary',{name:'Your order'}).getByText('$5.00',{exact:true}).first()).toBeVisible();expect(quotes).toBe(1);expect(prepares).toBe(0);
});
