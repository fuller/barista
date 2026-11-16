import {SOURCE_ONLY_PROFILES} from '../catalog/product-profiles.mjs';
import {getDefaults,MILKS,CATALOG,SIZES} from './catalog.mjs';
import {validateOrder} from './order.mjs';
const known={'shaken-espresso':[495,545,595],latte:[475,525,575],americano:[345,395,445],mocha:[525,575,625],'cold-brew':[425,475,525],chai:[495,545,595]};
export const PRICE_BOOK={currency:'USD',estimated:true,provenance:'Illustrative sample prices for ZIP 11201; not verified store prices.',zip:'11201',basePrices:Object.fromEntries([...CATALOG,...SOURCE_ONLY_PROFILES].map(p=>[p.id,Object.fromEntries(p.sizes.map(size=>[size,(known[p.id]??[475,525,575])[Math.max(0,Math.min(2,SIZES.indexOf(size)-1))]+(size==='short'?-50:size==='trenta'?50:0)]))])),modifiers:{extraShot:125,syrups:20,sauces:25,sweeteners:0,inclusions:50,toppings:60,coldFoam:125,ingredientOverrides:{},fieldSurcharges:{cupSize:{},preparation:{},roast:{},caffeine:{}},milkSurcharges:Object.fromEntries(MILKS.map(m=>[m,0]))}};
function cents(v){if(!Number.isSafeInteger(v)||v<0)throw new Error('Invalid price book cents');return v}
export function formatMoney(value){cents(value);return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value/100)}
export function quoteOrder(order,book=PRICE_BOOK){
  validateOrder(order);
  if(book?.currency!=='USD'||typeof book.estimated!=='boolean'||typeof book.provenance!=='string')throw new Error('Invalid price book');
  const items=order.items.map(d=>{
    const recipe=getDefaults(d.productId,d.size,d.temperature,order.catalogVersion);
    const lines=[{label:'Base drink',amountCents:cents(book.basePrices?.[d.productId]?.[d.size])}];
    const append=(label,amount)=>{cents(amount);if(amount)lines.push({label,amountCents:amount})};
    append('Extra espresso shots',Math.max(0,d.shots-recipe.shots)*cents(book.modifiers?.extraShot));
    const portions={none:0,light:1,regular:1,extra:2};
    for(const group of ['syrups','sauces','sweeteners','inclusions','toppings'])for(const ingredient of d[group]){
      const baseline=recipe[group].find(i=>i.id===ingredient.id);
      const amount=group==='toppings'?portions[ingredient.amount]:ingredient.quantity;
      const included=baseline?(group==='toppings'?portions[baseline.amount]:baseline.quantity):0;
      const rate=cents(book.modifiers?.ingredientOverrides?.[group]?.[ingredient.id]??book.modifiers?.[group]);
      append(`${ingredient.id} ${group}`,Math.max(0,amount-included)*rate);
    }
    if(d.coldFoam.id!=='none')append(`${d.coldFoam.id} cold foam`,Math.max(0,portions[d.coldFoam.amount]-(recipe.coldFoam.id===d.coldFoam.id?portions[recipe.coldFoam.amount]:0))*cents(book.modifiers?.ingredientOverrides?.coldFoams?.[d.coldFoam.id]??book.modifiers?.coldFoam));
    for(const field of ['cupSize','preparation','roast','caffeine'])if(d[field]!==recipe[field])append(`${field}: ${d[field]}`,cents(book.modifiers?.fieldSurcharges?.[field]?.[d[field]]??0));
    append(`${d.milk} milk`,cents(book.modifiers?.milkSurcharges?.[d.milk]));
    const unitCents=cents(lines.reduce((n,l)=>n+l.amountCents,0));
    return {itemId:d.id,quantity:d.quantity,unitCents,totalCents:cents(unitCents*d.quantity),lines};
  });
  const subtotalCents=cents(items.reduce((n,i)=>n+i.totalCents,0));
  const quote={currency:book.currency,subtotalCents,taxCents:null,totalCents:subtotalCents,items,estimated:book.estimated,taxLabel:'Tax not calculated',provenance:book.provenance};
  if(order.menuItems?.length){quote.pricedSubtotalCents=subtotalCents;quote.unpricedItemCount=order.menuItems.reduce((sum,item)=>sum+item.quantity,0);quote.subtotalCents=null;quote.totalCents=null;quote.items.push(...order.menuItems.map(item=>({itemId:item.id,quantity:item.quantity,unitCents:null,totalCents:null,lines:[]})));}
  return quote;
}
