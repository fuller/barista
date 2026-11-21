import directory from '../catalog/data/starbucks-menu-directory.json' with {type:'json'};
import book from '../catalog/data/demo-price-book.json' with {type:'json'};
import {quoteOrder} from './pricing.mjs';

const PROVENANCE='Illustrative demo prices; not verified store prices.';
const cents=value=>Number.isSafeInteger(value)&&value>=0&&value<=1000000;
const owns=(value,key)=>value&&Object.hasOwn(value,key);
export function validateDemoPriceBook(value,menu=directory){
 if(!value||typeof value.version!=='string'||!value.version||value.version.length>100||value.currency!=='USD'||value.provenance!==PROVENANCE||value.menuVersion!==menu.version||!value.products||typeof value.products!=='object'||Array.isArray(value.products)||Object.keys(value.products).length!==menu.products.length)throw Error('Invalid demo price book');
 for(const product of menu.products){
  const entry=owns(value.products,product.identity)?value.products[product.identity]:null;
  if(!entry||!cents(entry.defaultCents)||!entry.sizes||Array.isArray(entry.sizes)||typeof entry.sizes!=='object'||Object.keys(entry.sizes).length!==product.sizes.length||product.sizes.some(size=>!owns(entry.sizes,size.sizeCode)||!cents(entry.sizes[size.sizeCode])))throw Error('Invalid demo price book');
 }
 return value;
}
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
export const DEMO_PRICE_BOOK=freeze(validateDemoPriceBook(book));

export function getDemoMenuPrice(productOrIdentity,size=null){
 const identity=typeof productOrIdentity==='string'?productOrIdentity:productOrIdentity?.identity;
 if(typeof identity!=='string'||!owns(DEMO_PRICE_BOOK.products,identity))return null;
 const entry=DEMO_PRICE_BOOK.products[identity];
 if(size===null)return entry.defaultCents;
 return typeof size==='string'&&owns(entry.sizes,size)?entry.sizes[size]:null;
}
function checkCart(order){
 if(!order||!Array.isArray(order.items)||!Array.isArray(order.menuItems??[])||order.items.length+(order.menuItems?.length??0)>100||!Number.isSafeInteger(order.revision)||order.revision<0)throw Error('Invalid demo order');
 const ids=new Set();
 for(const item of [...order.items,...(order.menuItems??[])]){
  if(!item||typeof item.id!=='string'||!item.id||ids.has(item.id)||!Number.isSafeInteger(item.quantity)||item.quantity<1||item.quantity>100)throw Error('Invalid demo item');
  ids.add(item.id);
 }
 for(const item of order.menuItems??[])if(typeof item.identity!=='string'||!item.identity||item.size!==null&&typeof item.size!=='string'||!Array.isArray(item.instructions)||item.instructions.length>20||item.instructions.some(text=>typeof text!=='string'||!text.trim()||text.length>600))throw Error('Invalid demo menu item');
}

export function quoteDemoOrder(order,{directory:menu=directory}={}){
 checkCart(order);
 const products=new Map(menu.products.map(product=>[product.identity,product]));
 const legacy=quoteOrder({...order,menuItems:[],history:[],confirmed:false});
 const items=legacy.items.map(item=>({...item,lines:item.lines.map(line=>({...line}))}));
 let customizations=false;
 for(const item of order.menuItems??[]){
  const product=products.get(item.identity);
  const unitCents=product&&(item.size===null||product.sizes.some(size=>size.sizeCode===item.size))?getDemoMenuPrice(item.identity,item.size):null;
  const hasInstructions=item.instructions.length>0;customizations ||= hasInstructions;
  items.push({itemId:item.id,quantity:item.quantity,unitCents,totalCents:unitCents===null?null:unitCents*item.quantity,lines:unitCents===null?[]:[{label:hasInstructions?'Demo base price · Customizations may change price':'Demo base price',amountCents:unitCents}]});
 }
 const subtotal=items.reduce((sum,item)=>sum+(item.totalCents??0),0);
 if(!Number.isSafeInteger(subtotal))throw Error('Invalid demo subtotal');
 const unpricedItemCount=items.reduce((sum,item)=>sum+(item.totalCents===null?item.quantity:0),0);
 return {currency:'USD',source:'demo',estimated:true,priceBookVersion:DEMO_PRICE_BOOK.version,items,subtotalCents:unpricedItemCount?null:subtotal,pricedSubtotalCents:subtotal,unpricedItemCount,taxCents:null,totalCents:null,taxLabel:'Tax not calculated',provenance:PROVENANCE+(customizations?' Customizations may change price.':'')};
}
