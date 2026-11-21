import {chooseStore} from './store-fixture';
import {expect,test} from 'e2e';

test('quantity drafts commit on blur, recover invalid input and step immediately',async({app,screen,browser})=>{
 await app.open('/');await chooseStore(screen);
 await screen.getByRole('button',{name:'Add Caffè Latte',exact:true}).click();
 const cart=screen.getByRole('complementary',{name:'Your order'});
 await cart.getByLabel('Edit Caffè Latte',{exact:true}).click();
 const quantity=cart.getByLabel('Caffè Latte quantity',{exact:true});
 await quantity.fill('');await expect(quantity).toHaveValue('');
 await quantity.fill('12');await expect(cart.getByText('Qty 1',{exact:true})).toBeVisible();
 await cart.getByRole('heading',{name:'Caffè Latte',exact:true}).click();
 await expect(cart.getByText('Qty 12',{exact:true})).toBeVisible();
 await quantity.fill('101');await cart.getByText('Qty 12',{exact:true}).click();
 await expect(quantity).toHaveValue('12');
 await cart.getByRole('button',{name:'Increase Caffè Latte quantity',exact:true}).click();
 await expect(quantity).toHaveValue('13');
 await cart.getByRole('button',{name:'Decrease Caffè Latte quantity',exact:true}).click();
 await expect(quantity).toHaveValue('12');
 await quantity.fill('9');
 await browser.evaluate(()=>{const cart=document.querySelector('aside[aria-label="Your order"]');const undo=[...(cart?.querySelectorAll('button')??[])].find(button=>button.textContent==='Undo');undo?.click();});
 await expect(quantity).toHaveValue('13');
 await cart.getByText('Qty 13',{exact:true}).click();await expect(quantity).toHaveValue('13');
});

for(const width of [1440,390])test(`Enter saves quantity and Escape preserves the cart at ${width}px`,async({app,screen,browser})=>{
 await browser.setViewport({width,height:900});
 await app.open('/');await chooseStore(screen);
 await screen.getByRole('button',{name:'Add Caffè Latte',exact:true}).click();
 const cart=screen.getByRole('complementary',{name:'Your order'});
 await cart.getByLabel('Edit Caffè Latte',{exact:true}).click();
 const quantity=cart.getByLabel('Caffè Latte quantity',{exact:true});
 await quantity.fill('100');await browser.keyboard.press('Enter');
 await expect(cart.getByText('Qty 100',{exact:true})).toBeVisible();
 await expect(cart.getByRole('button',{name:'Increase Caffè Latte quantity',exact:true})).toBeDisabled();
 await quantity.fill('2');await browser.keyboard.press('Escape');
 await expect(quantity).toHaveValue('100');await expect(cart).toBeVisible();
 await quantity.fill('0');await browser.keyboard.press('Enter');await expect(quantity).toHaveValue('100');
 await cart.getByRole('button',{name:'Undo',exact:true}).click();
 await expect(quantity).toHaveValue('1');
});

test('interim speech does not repeat cart price formatting',async({app,screen,browser})=>{
 await browser.addInitScript(()=>{
  const scope=window as unknown as {formatCalls:number;emitInterim?:(text:string)=>void;SpeechRecognition:unknown};
  scope.formatCalls=0;
  const NumberFormat=Intl.NumberFormat;
  Intl.NumberFormat=new Proxy(NumberFormat,{construct(target,args){scope.formatCalls++;return Reflect.construct(target,args);}});
  scope.SpeechRecognition=class {
   onresult:((event:unknown)=>void)|null=null;
   start(){scope.emitInterim=text=>this.onresult?.({results:[{isFinal:false,0:{transcript:text}}]});}
   abort(){}stop(){}
  };
 });
 await browser.route('**/api/quote',route=>route.fulfill({status:503,json:{error:'Live pricing unavailable'}}));
 await app.open('/');await chooseStore(screen);
 await screen.getByRole('button',{name:'Add Caffè Latte',exact:true}).click();
 await screen.getByRole('button',{name:'Start microphone',exact:true}).click();
 await browser.evaluate(()=>new Promise(resolve=>setTimeout(resolve,1600)));
 const calls=await browser.evaluate(()=>(window as unknown as {formatCalls:number}).formatCalls);
 for(const text of ['one','one cold','one cold brew','one cold brew with','one cold brew with oat']){
  await browser.evaluate(text=>{(window as unknown as {emitInterim:(text:string)=>void}).emitInterim(text);},text);
  await expect(screen.getByRole('complementary',{name:'Voice order preview'}).getByText(text,{exact:true})).toBeVisible();
 }
 const after=await browser.evaluate(()=>(window as unknown as {formatCalls:number}).formatCalls);
 expect(after-calls).toBeLessThanOrEqual(5);
});

test('stepping a valid draft commits the displayed quantity once',async({app,screen})=>{
 await app.open('/');await chooseStore(screen);
 await screen.getByRole('button',{name:'Add Caffè Latte',exact:true}).click();
 const cart=screen.getByRole('complementary',{name:'Your order'});
 await cart.getByLabel('Edit Caffè Latte',{exact:true}).click();
 const quantity=cart.getByLabel('Caffè Latte quantity',{exact:true});
 await quantity.fill('12');
 await cart.getByRole('button',{name:'Increase Caffè Latte quantity',exact:true}).click();
 await expect(quantity).toHaveValue('13');
 await quantity.fill('12');await cart.getByRole('button',{name:'Increase Caffè Latte quantity',exact:true}).click();
 await expect(quantity).toHaveValue('13');
 await cart.getByRole('button',{name:'Undo',exact:true}).click();await expect(quantity).toHaveValue('1');
 await quantity.fill('100');await expect(cart.getByRole('button',{name:'Increase Caffè Latte quantity',exact:true})).toBeDisabled();
 await quantity.fill('101');await cart.getByRole('button',{name:'Increase Caffè Latte quantity',exact:true}).click();
 await expect(quantity).toHaveValue('2');
});
