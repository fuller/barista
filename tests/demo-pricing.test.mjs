import test from 'node:test';
import assert from 'node:assert/strict';
import directory from '../src/catalog/data/starbucks-menu-directory.json' with {type:'json'};
import {createOrder,applyCommands} from '../src/domain/order.mjs';
import {quoteOrder} from '../src/domain/pricing.mjs';
import {DEMO_PRICE_BOOK,getDemoMenuPrice,quoteDemoOrder,validateDemoPriceBook} from '../src/domain/demo-pricing.mjs';

const product=directory.products.find(p=>p.identity==='407:Hot');
const menu=(size=null,quantity=1,instructions=[])=>applyCommands(createOrder(),[{type:'add-menu',identity:product.identity,size,quantity,instructions}]);

test('stored demo book covers every recorded item and every offered size',()=>{
 assert.equal(directory.products.length,313);assert.equal(Object.keys(DEMO_PRICE_BOOK.products).length,313);
 assert.equal(DEMO_PRICE_BOOK.menuVersion,directory.version);assert.equal(validateDemoPriceBook(DEMO_PRICE_BOOK),DEMO_PRICE_BOOK);
 for(const p of directory.products){assert.ok(Number.isSafeInteger(getDemoMenuPrice(p)));assert.ok(getDemoMenuPrice(p)>=0);assert.equal(getDemoMenuPrice(p),getDemoMenuPrice(p.identity));for(const size of p.sizes)assert.ok(Number.isSafeInteger(getDemoMenuPrice(p,size.sizeCode)),p.identity+' '+size.sizeCode);}
});
test('demo menu size and quantity produce immediate integer-cent line and subtotal',()=>{
 const order=menu('Tall',3),quote=quoteDemoOrder(order),unit=getDemoMenuPrice(product,'Tall');
 assert.equal(quote.items[0].unitCents,unit);assert.equal(quote.items[0].totalCents,unit*3);assert.equal(quote.subtotalCents,unit*3);assert.equal(quote.items[0].lines.reduce((n,l)=>n+l.amountCents,0),unit);
 assert.equal(quote.source,'demo');assert.equal(quote.estimated,true);assert.equal(quote.currency,'USD');assert.equal(quote.taxCents,null);assert.equal(quote.totalCents,null);assert.match(quote.provenance,/not verified store prices/);
});
test('default and explicit source sizes use stored values rather than a live request',()=>{
 assert.equal(quoteDemoOrder(menu()).items[0].unitCents,DEMO_PRICE_BOOK.products[product.identity].defaultCents);
 assert.equal(quoteDemoOrder(menu('Tall')).items[0].unitCents,DEMO_PRICE_BOOK.products[product.identity].sizes.Tall);
});
test('confirming a source-only cart preserves its demo estimate',()=>{
 const order=menu(),before=quoteDemoOrder(order),confirmed=applyCommands(order,[{type:'confirm'}]);
 assert.deepEqual(quoteDemoOrder(confirmed),before);
});
test('legacy modifier estimates and generic menu prices combine without changing legacy pricing',()=>{
 const legacy=applyCommands(createOrder(),[{type:'add',productId:'latte',changes:{shots:3}}]);const before=quoteOrder(legacy);
 const mixed=applyCommands(legacy,[{type:'add-menu',identity:product.identity,size:'Venti',quantity:2}]),quote=quoteDemoOrder(mixed);
 assert.equal(quote.items[0].unitCents,before.items[0].unitCents);assert.equal(quote.subtotalCents,before.subtotalCents+2*getDemoMenuPrice(product,'Venti'));assert.equal(quote.totalCents,null);assert.deepEqual(quoteOrder(legacy),before);
});
test('literal instructions retain a base demo estimate with an explicit customization caution',()=>{
 const quote=quoteDemoOrder(menu(null,1,['oat milk and three shots']));assert.equal(quote.items[0].unitCents,getDemoMenuPrice(product));assert.match(quote.provenance,/Customizations may change price/);assert.match(quote.items[0].lines[0].label,/Customizations may change price/);
});
test('unknown identities and sizes never inherit an unrelated demo amount',()=>{
 for(const change of [{identity:'unknown:Hot'},{size:'not-a-size'}]){const order=menu();Object.assign(order.menuItems[0],change);const quote=quoteDemoOrder(order);assert.equal(quote.items[0].unitCents,null);assert.equal(quote.subtotalCents,null);assert.equal(quote.totalCents,null);assert.equal(quote.unpricedItemCount,1);}
 assert.equal(getDemoMenuPrice('unknown:Hot'),null);assert.equal(getDemoMenuPrice(product,'not-a-size'),null);assert.equal(getDemoMenuPrice('__proto__'),null);
});
test('mixed known and unknown lines preserve known estimated subtotal but suppress full totals',()=>{
 const order=menu();order.menuItems.push({...order.menuItems[0],id:'menu-2',identity:'new:Single',quantity:2});order.nextId=3;const quote=quoteDemoOrder(order);
 assert.equal(quote.pricedSubtotalCents,getDemoMenuPrice(product));assert.equal(quote.unpricedItemCount,2);assert.equal(quote.subtotalCents,null);assert.equal(quote.taxCents,null);assert.equal(quote.totalCents,null);
});
test('demo calculations never mutate the cart, directory or price book',()=>{
 const order=menu('Tall',2,['extra foam']),saved=structuredClone(order),book=structuredClone(DEMO_PRICE_BOOK),snapshot=structuredClone(directory);quoteDemoOrder(order);assert.deepEqual(order,saved);assert.deepEqual(DEMO_PRICE_BOOK,book);assert.deepEqual(directory,snapshot);
});
test('invalid price books reject missing entries, invalid cents and inconsistent menu metadata',()=>{
 for(const mutate of [b=>{delete b.products[product.identity]},b=>{b.products[product.identity].defaultCents=-1},b=>{b.products[product.identity].sizes.Tall=1.5},b=>{b.currency='CAD'},b=>{b.menuVersion='other'}]){const book=structuredClone(DEMO_PRICE_BOOK);mutate(book);assert.throws(()=>validateDemoPriceBook(book));}
});
test('malformed quantities and duplicate IDs fail rather than displaying misleading prices',()=>{
 for(const value of [0,1.5,101,NaN]){const order=menu();order.menuItems[0].quantity=value;assert.throws(()=>quoteDemoOrder(order));}
 const order=menu();order.menuItems.push({...order.menuItems[0]});assert.throws(()=>quoteDemoOrder(order));assert.throws(()=>quoteDemoOrder({}));
});
test('empty demo cart has a zero estimated subtotal and no fabricated tax or total',()=>{const quote=quoteDemoOrder(createOrder());assert.equal(quote.subtotalCents,0);assert.equal(quote.taxCents,null);assert.equal(quote.totalCents,null);assert.equal(quote.estimated,true);});
