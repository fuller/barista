import {expect,test} from 'e2e';
import type {TurnRequest} from '../src/contracts';

test('a generic live retry leaves the next complete order fresh and recoverable',async({app,screen,browser})=>{
 const turns:TurnRequest[]=[];
 const retry='Please repeat one complete drink at a time.';
 await browser.route('https://cloudassets.starbucks.com/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'}));
 await browser.route('**/api/config',route=>route.fulfill({json:{liveAvailable:true,provider:'Mocked',model:'fixture'}}));
 await browser.route('**/api/turn',async route=>{
  const request=JSON.parse(route.request.postData??'{}') as TurnRequest;
  turns.push(request);
  const first=turns.length===1;
  await route.fulfill({json:{
   turnId:request.turnId,baseRevision:request.baseRevision,
   commands:first?[]:[{type:'add',productId:'latte'}],
   clarification:first?retry:null,pending:null,source:'mock-live'
  }});
 });
 await app.open('/');
 const input=screen.getByRole('textbox',{name:'Tell us your order'});
 const send=screen.getByRole('button',{name:'Send order'});
 const order=screen.getByRole('complementary',{name:'Your order'});

 await input.fill('A drink with an impossible flavor');
 await send.click();
 await expect(screen.getByText(retry,{exact:true})).toBeVisible();
 await expect(screen.getByRole('button',{name:'Cancel question',exact:true})).toHaveCount(0);
 await expect(order.getByRole('heading',{name:'Caffè Latte'})).toHaveCount(0);

 await input.fill('a latte');
 await send.click();
 await expect(order.getByRole('heading',{name:'Caffè Latte'})).toBeVisible();
 await expect(order.getByText('1 drink',{exact:true})).toBeVisible();
 await expect(order.getByText('Price unavailable',{exact:true}).first()).toBeVisible();
 expect(turns.length).toBe(2);
 expect(Object.hasOwn(turns[0],'mode')).toBe(false);
 expect(turns[0].pending).toBe(null);
 expect(Object.hasOwn(turns[1],'mode')).toBe(false);
 expect(turns[1].text).toBe('a latte');
 expect(turns[1].pending).toBe(null);
 expect(turns[1].order.items.length).toBe(0);
 expect(turns[1].baseRevision).toBe(turns[1].order.revision);
 expect(turns[1].baseRevision).toBe(turns[0].baseRevision);
 expect(turns[1].turnId).not.toBe(turns[0].turnId);
});
