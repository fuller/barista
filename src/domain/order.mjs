import menuDirectory from '../catalog/data/starbucks-menu-directory.json' with {type:'json'};
import {getDefaults,deriveAliases,MILKS,SYRUPS,SIZES,getCatalogService,LEGACY_CATALOG_VERSION} from './catalog.mjs';
import {MODIFIER_DEFINITIONS,INGREDIENTS,getCapabilities,getModifierOptions,AMOUNTS} from './modifiers.mjs';
const FIELDS=Object.keys(getDefaults('latte'));
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).every(k=>keys.includes(k));
const clone=o=>structuredClone(o);
const menuProducts=new Map(menuDirectory.products.map(p=>[p.identity,{name:p.name,sizes:new Set(p.sizes.map(size=>size.sizeCode))}]));
const MENU_FIELDS=['size','quantity','instructions'];
const GROUPS=['syrups','sauces','sweeteners','inclusions','toppings'];
const ingredientPath=path=>typeof path==='string'&&GROUPS.some(g=>INGREDIENTS[g].some(i=>path===`${g}:${i.id}`));
function checkIngredients(group,list,allowed=INGREDIENTS[group].map(i=>i.id)){
  if(!Array.isArray(list)||list.length>INGREDIENTS[group].length||new Set(list.map(i=>i?.id)).size!==list.length)throw new Error('Invalid '+group);
  for(const i of list)if(!exact(i,['id',group==='toppings'?'amount':'quantity'])||!allowed.includes(i.id)||(group==='toppings'?!AMOUNTS.includes(i.amount):!Number.isInteger(i.quantity)||i.quantity<0||i.quantity>12))throw new Error('Invalid ingredient');
}
function checkDrink(d,catalogVersion){
  if(!exact(d,['id','explicit',...FIELDS])||FIELDS.some(k=>!(k in d))||typeof d.id!=='string'||!/^drink-[1-9]\d*$/.test(d.id)||!Array.isArray(d.explicit)||new Set(d.explicit).size!==d.explicit.length||d.explicit.some(k=>!FIELDS.includes(k)&&!GROUPS.some(g=>k.startsWith(g+':')&&INGREDIENTS[g].some(i=>i.id===k.slice(g.length+1)))))throw new Error('Invalid drink');
  getDefaults(d.productId,d.size,d.temperature,catalogVersion);
  const caps=getCapabilities(d.productId,d.temperature,catalogVersion), defaults=getDefaults(d.productId,d.size,d.temperature,catalogVersion);
  for(const def of MODIFIER_DEFINITIONS){const v=d[def.id];if(def.kind==='select'&&!def.options.includes(v))throw new Error('Invalid '+def.id);if(catalogVersion!==LEGACY_CATALOG_VERSION&&def.kind==='select'&&caps.fields.includes(def.id)&&!getModifierOptions(d,def.id,catalogVersion).includes(v))throw new Error('Unsupported '+def.id);if(def.kind==='number'&&(!Number.isInteger(v)||v<def.min||v>def.max))throw new Error('Invalid '+def.id);if(!caps.fields.includes(def.id)&&JSON.stringify(v)!==JSON.stringify(defaults[def.id]))throw new Error('Unsupported '+def.id)}
  if(d.cupSize!=='standard'&&(!caps.sizes.includes(d.cupSize)||SIZES.indexOf(d.cupSize)<SIZES.indexOf(d.size)))throw new Error('Invalid cup size');
  if(!getModifierOptions(d,'preparation',catalogVersion).includes(d.preparation))throw new Error('Unsupported preparation');
  for(const g of GROUPS)checkIngredients(g,d[g],caps.ingredients[g]);
  if(!exact(d.coldFoam,['id','amount'])||!caps.ingredients.coldFoams.includes(d.coldFoam.id)||!AMOUNTS.includes(d.coldFoam.amount)||d.coldFoam.id==='none'&&d.coldFoam.amount!=='none')throw new Error('Invalid cold foam');
  if(!Array.isArray(d.onSide)||new Set(d.onSide).size!==d.onSide.length||d.onSide.some(v=>!MODIFIER_DEFINITIONS.find(x=>x.id==='onSide').options.includes(v)||v==='milk'&&d.milk==='none'||v==='ice'&&d.ice==='none'||GROUPS.includes(v)&&!d[v].length||v==='coldFoam'&&d.coldFoam.id==='none'))throw new Error('Invalid onSide');
  const aliases=deriveAliases(structuredClone(d));for(const k of ['syrup','pumps','decaf','whip'])if(aliases[k]!==d[k])throw new Error('Incoherent alias');
}
function checkItems(items,nextId,catalogVersion){
  if(!Array.isArray(items)||items.length>100)throw new Error('Invalid items');
  const ids=new Set();for(const d of items){checkDrink(d,catalogVersion);if(ids.has(d.id)||Number(d.id.slice(6))>=nextId)throw new Error('Invalid drink ID');ids.add(d.id)}
}
function checkMenuItems(items,nextId,drinks=[]){
 if(!Array.isArray(items)||items.length+drinks.length>100)throw new Error('Invalid menu items');
 const numbers=new Set(drinks.map(item=>Number(item.id.slice(6))));
 for(const item of items){
  if(!exact(item,['id','identity','name',...MENU_FIELDS])||['id','identity','name',...MENU_FIELDS].some(key=>!Object.hasOwn(item,key))||typeof item.id!=='string'||!/^menu-[1-9]\d*$/.test(item.id))throw new Error('Invalid menu item');
  const number=Number(item.id.slice(5)),product=menuProducts.get(item.identity);
  if(!Number.isSafeInteger(number)||number>=nextId||numbers.has(number)||!product||item.name!==product.name||item.size!==null&&!product.sizes.has(item.size)||!Number.isSafeInteger(item.quantity)||item.quantity<1||item.quantity>100||!Array.isArray(item.instructions)||item.instructions.length>20||item.instructions.some(text=>typeof text!=='string'||!text.trim()||text.length>600))throw new Error('Invalid menu item');
  numbers.add(number);
 }
}
function checkCart(state,nextId,catalogVersion){
 checkItems(state.items,nextId,catalogVersion);
 if(Object.hasOwn(state,'menuItems'))checkMenuItems(state.menuItems,nextId,state.items);
}
export function validateOrder(o){
  if(!exact(o,['revision','items','menuItems','confirmed','history','nextId','catalogVersion'])||!Number.isSafeInteger(o.revision)||o.revision<0||!Number.isSafeInteger(o.nextId)||o.nextId<1||typeof o.confirmed!=='boolean'||!Array.isArray(o.history)||o.confirmed&&!(o.items?.length||o.menuItems?.length))throw new Error('Invalid order');
  const catalogVersion=o.catalogVersion??LEGACY_CATALOG_VERSION;getCatalogService(catalogVersion);
  checkCart(o,o.nextId,catalogVersion);
  for(const h of o.history){if(!exact(h,['items','menuItems','confirmed'])||typeof h.confirmed!=='boolean'||h.confirmed&&!(h.items?.length||h.menuItems?.length))throw new Error('Invalid history');checkCart(h,o.nextId,catalogVersion)}
  return o;
}
function menuChanges(previous,changes,id){
 if(!exact(changes,['identity',...MENU_FIELDS]))throw new Error('Invalid menu changes');
 const next={...clone(previous),...clone(changes),id},product=menuProducts.get(next.identity);
 if(!product)throw new Error('Unknown menu product');
 next.name=product.name;
 if(Object.hasOwn(changes,'identity')&&!Object.hasOwn(changes,'size')&&next.size!==null&&!product.sizes.has(next.size))next.size=null;
 return next;
}
function createMenuItem(command,id){
 const product=menuProducts.get(command.identity);if(!product)throw new Error('Unknown menu product');
 return {id,identity:command.identity,name:product.name,size:command.size===undefined?null:command.size,quantity:command.quantity===undefined?1:command.quantity,instructions:command.instructions===undefined?[]:clone(command.instructions)};
}
export function createOrder(catalogVersion=LEGACY_CATALOG_VERSION){getCatalogService(catalogVersion);return {revision:0,items:[],confirmed:false,history:[],nextId:1,catalogVersion}}
function build(previous,changes={},id,touched=[],catalogVersion,validate=true){
  if(!exact(changes,FIELDS))throw new Error('Unknown drink field');
  if(!Array.isArray(touched)||new Set(touched).size!==touched.length||touched.some(path=>!ingredientPath(path)||!Object.hasOwn(changes,path.split(':')[0])))throw new Error('Invalid touched ingredients');
  changes=clone(changes);
  const requested=new Set(touched);
  const chosen={...previous,...changes};
  const defaults=getDefaults(chosen.productId,chosen.size,('temperature' in changes||previous?.explicit.includes('temperature'))?chosen.temperature:undefined,catalogVersion);
  const explicit=new Set(previous?.explicit||[]);
  for(const alias of ['syrup','pumps','decaf','whip'])explicit.delete(alias);
  if('decaf' in changes){if(typeof changes.decaf!=='boolean'||'caffeine' in changes&&changes.caffeine!==(changes.decaf?'decaf':'regular'))throw new Error('Conflicting caffeine alias');changes.caffeine=changes.decaf?'decaf':'regular';delete changes.decaf}
  if('whip' in changes){if(typeof changes.whip!=='boolean'||'toppings' in changes&&changes.toppings.some(t=>t.id==='whipped-cream'&&t.amount!=='none')!==changes.whip)throw new Error('Conflicting whip alias');changes.toppings=(changes.toppings??previous?.toppings??defaults.toppings).filter(t=>t.id!=='whipped-cream');if(changes.whip)changes.toppings.push({id:'whipped-cream',amount:'regular'});requested.add('toppings:whipped-cream');delete changes.whip}
  if(('syrup' in changes||'pumps' in changes)&&('syrups' in changes||'sauces' in changes)){
    const sweet=[...(changes.syrups??previous?.syrups??defaults.syrups),...(changes.sauces??previous?.sauces??defaults.sauces)];
    if('syrup' in changes&&changes.syrup!==(sweet[0]?.id??'none')||'pumps' in changes&&(sweet.length!==1||changes.pumps!==sweet[0].quantity))throw new Error('Conflicting sweet aliases');
    if(sweet[0]){
      const group=(changes.syrups??previous?.syrups??defaults.syrups).includes(sweet[0])?'syrups':'sauces';
      requested.add(`${group}:${sweet[0].id}`);
      changes[group]??=clone(previous?.[group]??defaults[group]);
    }else for(const group of ['syrups','sauces']){changes[group]??=[];for(const i of INGREDIENTS[group])requested.add(`${group}:${i.id}`);}
    delete changes.syrup;delete changes.pumps;
  }
  if('syrup' in changes||'pumps' in changes){if('syrups' in changes||'sauces' in changes)throw new Error('Conflicting sweet aliases');if('pumps' in changes&&(!Number.isInteger(changes.pumps)||changes.pumps<0||changes.pumps>12))throw new Error('Invalid pumps');const current=previous??defaults;const sweet=[...current.syrups,...current.sauces];if(!('syrup' in changes)&&sweet.length!==1)throw new Error('Ambiguous pumps alias');const syrup=changes.syrup??sweet[0].id;if(!SYRUPS.includes(syrup)||syrup==='chai')throw new Error('Invalid syrup');const quantity=changes.pumps??(current.pumps||4);changes.syrups=[];changes.sauces=[];if(syrup!=='none'){const group=INGREDIENTS.sauces.some(i=>i.id===syrup)?'sauces':'syrups';requested.add(`${group}:${syrup}`);if(quantity>0)changes[group]=[{id:syrup,quantity}];}else for(const group of ['syrups','sauces'])for(const i of INGREDIENTS[group])requested.add(`${group}:${i.id}`);delete changes.syrup;delete changes.pumps}
  const d={...defaults,id};
  for(const k of explicit)if(!k.includes(':'))d[k]=clone(previous[k]);
  for(const g of GROUPS){const touched=[...explicit].filter(k=>k.startsWith(g+':')).map(k=>k.slice(g.length+1));d[g]=[...defaults[g].filter(i=>!touched.includes(i.id)),...(previous?.[g]??[]).filter(i=>touched.includes(i.id))]}
  for(const [key,value] of Object.entries(changes)){
    if(!GROUPS.includes(key)){explicit.add(key);d[key]=value;continue;}
    checkIngredients(key,value);
    const before=previous?.[key]??defaults[key];
    const ids=new Set([...before,...value].map(i=>i.id));
    for(const path of requested)if(path.startsWith(key+':'))ids.add(path.slice(key.length+1));

    for(const ingredientId of ids){
      const oldIngredient=before.find(i=>i.id===ingredientId),newIngredient=value.find(i=>i.id===ingredientId);
      if(!requested.has(`${key}:${ingredientId}`)&&oldIngredient?.quantity===newIngredient?.quantity&&oldIngredient?.amount===newIngredient?.amount&&Boolean(oldIngredient)===Boolean(newIngredient))continue;
      explicit.add(`${key}:${ingredientId}`);
      const index=d[key].findIndex(i=>i.id===ingredientId);
      if(newIngredient){if(index<0)d[key].push(newIngredient);else d[key][index]=newIngredient;}else if(index>=0)d[key].splice(index,1);
    }
  }
  d.explicit=[...explicit];deriveAliases(d);if(validate)checkDrink(d,catalogVersion);return d;
}

export function getRelativeBaseline(current,shapeChanges={},catalogVersion=LEGACY_CATALOG_VERSION){
 const shape=Object.fromEntries(['productId','size','temperature'].filter(k=>shapeChanges[k]!==undefined).map(k=>[k,shapeChanges[k]]));
 if(!current?.id)return getDefaults(shape.productId??current?.productId,shape.size??current?.size,shape.temperature??current?.temperature,catalogVersion);
 return build(current,shape,current.id,[],catalogVersion,false);
}
export function applyCommands(order,commands){
  validateOrder(order);
  if(!Array.isArray(commands)||!commands.length||commands.length>100)throw new Error('Commands must be a nonempty array');
  const result=clone(order);result.catalogVersion??=LEGACY_CATALOG_VERSION;const snapshot={items:clone(order.items),confirmed:order.confirmed};
  if(Object.hasOwn(order,'menuItems'))snapshot.menuItems=clone(order.menuItems);
  let undo=false;
  for(const c of commands){
    const schemas={add:['type','productId','changes','touched'],'add-menu':['type','identity',...MENU_FIELDS],update:['type','itemId','changes','touched'],'update-menu':['type','itemId','changes'],duplicate:['type','itemId','changes','touched'],remove:['type','itemId'],undo:['type'],clear:['type'],confirm:['type']};
    if(!c||!Object.hasOwn(schemas,c.type)||!exact(c,schemas[c.type]))throw new Error('Invalid command');
    const index=result.items.findIndex(d=>d.id===c.itemId),menuIndex=result.menuItems?.findIndex(item=>item.id===c.itemId)??-1;
    if(c.type==='update'&&index<0)throw new Error('Unknown drink');
    if(c.type==='update-menu'&&menuIndex<0)throw new Error('Unknown menu item');
    if(['duplicate','remove'].includes(c.type)&&index<0&&menuIndex<0)throw new Error('Unknown item');
    switch(c.type){
      case 'add':{if(c.changes!==undefined&&!exact(c.changes,FIELDS))throw new Error('Invalid changes');if(typeof c.productId!=='string')throw new Error('Missing product');const changes={...c.changes,productId:c.productId};result.items.push(build(null,changes,`drink-${result.nextId++}`,c.touched,result.catalogVersion));result.confirmed=false;break}
      case 'add-menu':{result.menuItems??=[];result.menuItems.push(createMenuItem(c,`menu-${result.nextId++}`));checkMenuItems(result.menuItems,result.nextId,result.items);result.confirmed=false;break;}
      case 'update':if(!c.changes)throw new Error('Missing changes');result.items[index]=build(result.items[index],c.changes,c.itemId,c.touched,result.catalogVersion);result.confirmed=false;break;
      case 'update-menu':if(!c.changes)throw new Error('Missing changes');result.menuItems[menuIndex]=menuChanges(result.menuItems[menuIndex],c.changes,c.itemId);checkMenuItems(result.menuItems,result.nextId,result.items);result.confirmed=false;break;
      case 'duplicate':{
       if(menuIndex>=0){if(Object.hasOwn(c,'touched'))throw new Error('Invalid menu changes');result.menuItems.push(menuChanges(result.menuItems[menuIndex],c.changes===undefined?{}:c.changes,`menu-${result.nextId++}`));checkMenuItems(result.menuItems,result.nextId,result.items);}
       else result.items.push(build(result.items[index],c.changes,`drink-${result.nextId++}`,c.touched,result.catalogVersion));
       result.confirmed=false;break;
      }
      case 'remove':if(menuIndex>=0)result.menuItems.splice(menuIndex,1);else result.items.splice(index,1);result.confirmed=false;break;
      case 'clear':result.items=[];if(Object.hasOwn(result,'menuItems'))result.menuItems=[];result.confirmed=false;break;
      case 'confirm':if(!result.items.length&&!result.menuItems?.length)throw new Error('Cannot confirm an empty order');result.confirmed=true;break;
      case 'undo':{if(commands.length!==1)throw new Error('Undo must stand alone');const h=result.history.pop();if(!h)throw new Error('Nothing to undo');result.items=h.items;if(Object.hasOwn(h,'menuItems'))result.menuItems=h.menuItems;else delete result.menuItems;result.confirmed=false;undo=true;break}
    }
  }
  result.revision++;
  if(!undo)result.history.push(snapshot);
  validateOrder(result);return result;
}
