import test from 'node:test';
import assert from 'node:assert/strict';
import {setupGuestThroughUi} from '../src/browser/guest-ui-setup.mjs';
const selectedStore={storeId:'abc',source:'starbucks',sourceStoreNumber:'85278-313836',name:'104 Jay St',address:{lines:['104 Jay St'],city:'Brooklyn',region:'NY',postalCode:'11201',countryCode:'US'},coordinates:{latitude:40,longitude:-73}};
function fake({deny=false,selected=false,consent=false,hiddenAdd=false,singularCart=false}={}){
 const calls=[];let notice=consent;
 const locator=(role,name)=>({
  first(){return this;},filter({has,hasText}){calls.push(['filter',String(has??hasText)]);return hasText?locator(role,String(name)+' '+String(hasText)):this;},
  locator(selector){return locator('selector',selector);},
  click:async()=>{
   if(hiddenAdd&&role==='button'&&/add to order/i.test(String(name)))throw Error('Role excludes hidden ancestor');
   if(singularCart&&role==='button'&&String(name).includes('Open the cart')&&!name.test('Open the cart. There is one item in cart.'))throw Error('Cart label changed');
   calls.push(['click',role,String(name)]);
   if(deny)throw Error('Access denied');
   if(notice){if(role==='button'&&name==='Agree')notice=false;else throw Error('Cookie notice blocks pointer');}
  },
  fill:async value=>calls.push(['fill',value]),press:async key=>calls.push(['press',key]),
  isVisible:async()=>role==='text'?notice:true,isEnabled:async()=>!selected
 });
 return {calls,page:{goto:async url=>calls.push(['goto',url]),getByRole:(role,{name})=>locator(role,name),getByText:text=>locator('text',text),locator:selector=>{calls.push(['locator',selector]);return locator('selector',selector);}}};
}
test('guest setup uses bounded ordinary cafe/product/cart actions without checkout',async()=>{const {calls,page}=fake();await setupGuestThroughUi(page,{selectedStore});assert.equal(calls.filter(c=>c[0]==='goto').length,2);assert.ok(calls.some(c=>c[0]==='fill'&&c[1]==='11201'));assert.ok(calls.some(c=>c[0]==='click'&&/add to order/i.test(c[2])));assert.ok(calls.some(c=>c[0]==='click'&&c[1]==='selector'&&c[2]==='[data-e2e="confirmStoreButton"]'));assert.ok(calls.some(c=>c[0]==='click'&&c[1]==='button'&&c[2].includes('Open the cart')));assert.doesNotMatch(JSON.stringify(calls),/checkout|signin\/guest|fetch/);});
test('UI denial stops setup without retries',async()=>{const {calls,page}=fake({deny:true});await assert.rejects(setupGuestThroughUi(page,{selectedStore}));assert.equal(calls.filter(c=>c[0]==='click').length,1);});

test('store setup targets provider ID rather than duplicate cafe names',async()=>{
 const {calls,page}=fake();await setupGuestThroughUi(page,{selectedStore:{...selectedStore,sourceStoreNumber:'7358-1369',name:'Duplicate cafe',address:{...selectedStore.address,postalCode:'11217'}}});
 assert.ok(calls.some(c=>c[0]==='fill'&&c[1]==='11217'));
 assert.ok(calls.some(c=>c[0]==='locator'&&c[1].includes('/stores/7358-1369/')));
 assert.ok(!calls.some(c=>c.includes('Duplicate cafe')));
});
test('store setup rejects absent store before navigating',async()=>{const {calls,page}=fake();await assert.rejects(setupGuestThroughUi(page));assert.equal(calls.length,0);});

test('already selected result skips disabled card button and confirms exact store',async()=>{
 const {calls,page}=fake({selected:true});await setupGuestThroughUi(page,{selectedStore});
 assert.equal(calls.some(c=>c[0]==='click'&&c[2]==='[data-e2e="cardButton"]'),false);
 assert.equal(calls.some(c=>c[0]==='click'&&c[2]==='[data-e2e="confirmStoreButton"]'),true);
});
test('inactive result selects card before confirming store',async()=>{
 const {calls,page}=fake();await setupGuestThroughUi(page,{selectedStore});
 const card=calls.findIndex(c=>c[0]==='click'&&c[2]==='[data-e2e="cardButton"]');
 const confirm=calls.findIndex(c=>c[0]==='click'&&c[2]==='[data-e2e="confirmStoreButton"]');
 assert.ok(card>=0&&confirm>card);
});

test('observed cookie notice is acknowledged before ordinary cafe selection',async()=>{
 const {calls,page}=fake({consent:true});await setupGuestThroughUi(page,{selectedStore});
 const consent=calls.findIndex(c=>c[0]==='click'&&c[2]==='Agree'),cafe=calls.findIndex(c=>c[0]==='click'&&c[1]==='link');assert.ok(consent>=0&&cafe>consent);
 assert.equal(calls.filter(c=>c[0]==='click'&&c[2]==='Agree').length,1);
});
test('native Add to Order button remains usable when role tree omits its animated ancestor',async()=>{
 const {calls,page}=fake({hiddenAdd:true});await setupGuestThroughUi(page,{selectedStore});
 assert.ok(calls.some(c=>c[0]==='click'&&c[1]==='selector'&&/Add to Order/.test(c[2])));
});
test('cart review accepts native singular item announcement',async()=>{
 const {calls,page}=fake({singularCart:true});await setupGuestThroughUi(page,{selectedStore});assert.ok(calls.some(c=>c[0]==='click'&&c[2].includes('Open the cart')));
});
test('observed guest rate limit stops remaining cart-review actions',async()=>{
 const {calls,page}=fake();let allowed=true;const original=page.locator;
 page.locator=selector=>{const target=original(selector),filter=target.filter;target.filter=options=>{const result=filter.call(target,options);if(options.hasText){const click=result.click;result.click=async options=>{await click(options);allowed=false;};}return result;};return target;};
 await assert.rejects(setupGuestThroughUi(page,{selectedStore,canContinue:()=>allowed}));assert.equal(calls.some(c=>c[0]==='click'&&c[2].includes('Open the cart')),false);
});
