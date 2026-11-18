import {expect,test} from 'e2e';
for(const phrase of ['one cold brew and one americano','one American and one cold brew','one Americana and one cold brew'])test(`Live ordering receives the spoken wording: ${phrase}`,async({app,screen,browser})=>{
 await browser.route('https://cloudassets.starbucks.com/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'}));
 await browser.route('**/api/config',route=>route.fulfill({json:{liveAvailable:true,provider:'Mocked',model:'fixture'}}));
 await browser.route('**/api/turn',async route=>{const request=JSON.parse(route.request.postData??'{}');expect(request.text).toBe(phrase);expect(Object.hasOwn(request,'mode')).toBe(false);await route.fulfill({json:{turnId:request.turnId,baseRevision:request.baseRevision,commands:[{type:'add',productId:'americano'},{type:'add',productId:'cold-brew'}],clarification:null,pending:null,source:'mock-live'}});});
 await app.open('/');
 await screen.getByRole('textbox',{name:'Tell us your order'}).fill(phrase);
 await screen.getByRole('button',{name:'Send order'}).click();
 const order=screen.getByRole('complementary',{name:'Your order'});
 await expect(order.getByRole('heading',{name:'Caffè Americano',exact:true})).toBeVisible();
 await expect(order.getByRole('heading',{name:'Cold Brew',exact:true})).toBeVisible();
 await expect(order.getByText('Price unavailable',{exact:true}).first()).toBeVisible();
 await expect(order.getByText('2 drinks',{exact:true})).toBeVisible();
});
