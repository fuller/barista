import {validateOrder} from '../domain/order.mjs';
import {validateMenuDirectory} from '../catalog/menu-directory.mjs';
import {validateCatalogSnapshot} from '../catalog/validate-snapshot.mjs';

const same=(a,b)=>a===b||Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>same(v,b[i]))||a!==null&&b!==null&&typeof a==='object'&&typeof b==='object'&&!Array.isArray(a)&&!Array.isArray(b)&&Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(k=>Object.hasOwn(b,k)&&same(a[k],b[k]));
const validSku=value=>typeof value==='string'&&/^\d{1,16}$/.test(value);
const normalize=value=>value.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[®™]/g,'').replace(/\s+/g,' ').trim();

function plainInstruction(text,item,product){
 let value=normalize(text).replace(/[.!?]+$/,'').trim();
 value=value.replace(/^(?:can i (?:get|have)|could i (?:get|have)|i would like|i'd like|i want|add|order) /,'');
 value=value.replace(/^please /,'').replace(/ please$/,'');
 const count=value.match(/^(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) /);
 const numbers={a:1,an:1,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};
 if(count){if((numbers[count[1]]??Number(count[1]))!==item.quantity)return false;value=value.slice(count[0].length);}
 else if(item.quantity!==1)return false;
 const sizes=product.sizes.map(s=>normalize(s.sizeCode));
 const size=sizes.find(s=>value.startsWith(s+' '));
 if(size){const selected=item.size??product.defaultSize?.displayName;if(!selected||normalize(selected)!==size)return false;value=value.slice(size.length+1);}
 else if(item.size!==null&&normalize(item.size)!==normalize(product.defaultSize?.displayName??''))return false;
 const names=new Set([normalize(product.name)]);

 if(product.identity==='407:Hot'){names.add('latte');names.add('hot latte');names.add('hot caffe latte');}
 if(product.identity==='407:Iced'){names.add('iced latte');}
 if(item.quantity>1){for(const name of [...names])names.add(name+'s');}
 return names.has(value);
}
function configured(item,sku){return {itemId:item.id,sku,quantity:item.quantity,modifiers:[]};}

export async function resolveOrderQuote(order,{directory,catalog,resolveProduct,signal}={}){
 signal?.throwIfAborted();
 validateOrder(order);validateMenuDirectory(directory);validateCatalogSnapshot(catalog);
 const lines=[...order.items,...(order.menuItems??[])];
 if(lines.length>50||lines.reduce((total,item)=>total+item.quantity,0)>100)return {items:[],unpriced:lines.map(item=>({itemId:item.id,reason:'pricing_limit_exceeded'}))};
 const items=[],unpriced=[];
 const unavailable=(item,reason)=>unpriced.push({itemId:item.id,reason});
 for(const item of order.items){
  signal?.throwIfAborted();
  const product=catalog.products.find(p=>p.productId===item.productId&&p.temperature===item.temperature);
  const size=product?.sizes.find(s=>s.size===item.size);
  if(order.catalogVersion!==catalog.version||!size||!validSku(size.sku)){unavailable(item,'catalog_unavailable');continue;}
  const defaults=size.recipe.defaults;
  if(Object.entries(defaults).some(([key,value])=>!['quantity'].includes(key)&&!same(item[key],value))){unavailable(item,'unsupported_configuration');continue;}
  items.push(configured(item,size.sku));
 }
 const menu=order.menuItems??[],results=new Array(menu.length),details=new Map();let next=0;
 const resolveMenuLine=async item=>{
  signal?.throwIfAborted();
  const missing=reason=>({unpriced:{itemId:item.id,reason}});
  const product=directory.products.find(p=>p.identity===item.identity);
  if(!product||item.size!==null&&!product.sizes.some(s=>s.sizeCode===item.size))return missing('product_unavailable');
  if(item.instructions.some(text=>!plainInstruction(text,item,product)))return missing('unsupported_instructions');
  if(item.size===null||item.size===product.defaultSize?.displayName)return validSku(product.defaultSize?.sku)?{item:configured(item,product.defaultSize.sku)}:missing('size_unavailable');
  try{
   if(!details.has(product.identity))details.set(product.identity,Promise.resolve().then(()=>{signal?.throwIfAborted();return resolveProduct(product.identity,{signal});}));
   const raw=await details.get(product.identity);
   signal?.throwIfAborted();
   const matches=raw?.products?.filter(p=>String(p.productNumber)===product.productNumber&&p.formCode===product.formCode);
   const sizes=matches?.length===1?matches[0].sizes?.filter(s=>s.sizeCode===item.size):[];
   if(sizes?.length!==1||!validSku(sizes[0].sku))return missing('size_unavailable');
   return {item:configured(item,sizes[0].sku)};
  }catch(error){signal?.throwIfAborted();if(error?.name==='AbortError')throw error;return missing('product_unavailable');}
 };
 await Promise.all(Array.from({length:Math.min(4,menu.length)},async()=>{
  for(;;){signal?.throwIfAborted();const index=next++;if(index>=menu.length)return;results[index]=await resolveMenuLine(menu[index]);}
 }));
 for(const result of results){if(result.item)items.push(result.item);else unpriced.push(result.unpriced);}
 return {items,unpriced};
}
