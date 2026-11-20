import {expect,test} from 'e2e';
import {chooseStore,fixtureStores,installStoreFixture} from './store-fixture';

test('fresh visit requires explicit store confirmation before manual, typed or voice ordering',async({app,screen,browser})=>{
 await browser.setViewport({width:1440,height:900});await installStoreFixture(browser);await app.open('/');
 await expect(screen.getByRole('heading',{name:'Choose your store'})).toBeVisible();
 await expect(screen.getByLabel('ZIP code or city')).toHaveValue('11201');
 await expect(screen.getByRole('region',{name:'Full menu'})).toHaveCount(0);
 await expect(screen.getByLabel('Tell us your order')).toHaveCount(0);
 await expect(screen.getByRole('button',{name:'Start microphone'})).toHaveCount(0);
 await expect(screen.getByRole('button',{name:'Use this store'})).toBeDisabled();
 await screen.getByRole('button',{name:'Search stores'}).click();
 await expect(screen.getByText('104 Jay St · Brooklyn, NY 11201',{exact:true})).toBeVisible();
 await expect(screen.getByRole('region',{name:'Full menu'})).toHaveCount(0);
 await screen.getByRole('radio').first().click();await screen.getByRole('button',{name:'Use this store'}).click();
 await expect(screen.getByRole('region',{name:'Full menu'})).toBeVisible();
 await expect(screen.getByRole('region',{name:'Selected store'}).getByText('104 Jay St',{exact:true})).toBeVisible();
 await app.screenshot('selected-store-desktop');
});

test('search errors and empty results recover; latest city search wins',async({app,screen,browser})=>{
 let release:()=>void=()=>{};const held=new Promise<void>(resolve=>{release=resolve;});
 await browser.route('**/api/stores?*',async route=>{
  const q=new URL(route.request.url).searchParams.get('q');
  if(q==='fail')return route.fulfill({status:503,json:{error:'offline'}});
  if(q==='empty')return route.fulfill({json:{stores:[]}});
  if(q==='old'){await held;try{await route.fulfill({json:{stores:[fixtureStores[0]]}});}catch{}return;}
  return route.fulfill({json:{stores:[fixtureStores[1]]}});
 });
 await app.open('/');const input=screen.getByLabel('ZIP code or city'),search=screen.getByRole('button',{name:'Search stores'});
 await input.fill('fail');await search.click();await expect(screen.getByRole('alert')).toHaveText('Store search is unavailable. Try again.');
 await input.fill('empty');await search.click();await expect(screen.getByText('No stores found. Try another ZIP code or city.',{exact:true})).toBeVisible();
 await input.fill('old');await search.click();await expect(screen.getByText('Finding stores…',{exact:true})).toBeVisible();
 await input.fill('Brooklyn');await search.click();await expect(screen.getByRole('radio',{name:/6 Metro Tech at Jay Street/})).toBeVisible();release();
 await expect(screen.getByRole('radio',{name:/104 Jay St/})).toHaveCount(0);
});

test('mobile store change keeps cart and replaces live prices',async({app,screen,browser})=>{
 await browser.setViewport({width:390,height:844});await installStoreFixture(browser);
 await browser.route('**/api/config',route=>route.fulfill({json:{liveAvailable:true,pricing:{available:true}}}));
 await browser.route('**/api/quote',route=>{const {order,storeId}=JSON.parse(route.request.postData??'{}'),store=fixtureStores.find(value=>value.storeId===storeId)!;const unitCents=storeId===fixtureStores[0].storeId?500:650;return route.fulfill({json:{revision:order.revision,source:'starbucks',storeId,storeNumber:store.sourceStoreNumber,expiresAt:Date.now()+60000,currency:'USD',items:order.menuItems.map((item:{id:string;quantity:number})=>({itemId:item.id,quantity:item.quantity,unitCents,totalCents:item.quantity*unitCents,lines:[{label:'Drink',amountCents:unitCents}]})),subtotalCents:unitCents,taxCents:0,totalCents:unitCents}});});
 await app.open('/');await chooseStore(screen);await screen.getByRole('button',{name:'Add Caffè Latte',exact:true}).click();
 const cart=screen.getByRole('dialog',{name:'Your order'});await expect(cart.getByText('$5.00',{exact:true}).first()).toBeVisible();await screen.getByRole('button',{name:'Close order'}).click();
 await screen.getByRole('button',{name:'Change store'}).click();await screen.getByRole('button',{name:'Search stores'}).click();await screen.getByRole('radio',{name:/6 Metro Tech at Jay Street/}).click();await screen.getByRole('button',{name:'Use this store'}).click();
 await screen.getByRole('button',{name:/View order/}).click();await expect(cart.getByRole('heading',{name:'Caffè Latte',exact:true})).toBeVisible();await expect(cart.getByText('$6.50',{exact:true}).first()).toBeVisible();await expect(cart.getByText('$5.00',{exact:true})).toHaveCount(0);await screen.getByRole('button',{name:'Close order'}).click();await app.screenshot('selected-store-mobile');
});
