import {CATALOG,SIZES,getCatalogService,LEGACY_CATALOG_VERSION} from './catalog.mjs';
import {INGREDIENTS,AMOUNTS,MODIFIER_DEFINITIONS,sourceSelectValues} from './modifier-definitions.mjs';
export {INGREDIENTS,AMOUNTS,MODIFIER_DEFINITIONS} from './modifier-definitions.mjs';

export function getCapabilities(productId,temperature,catalogVersion=LEGACY_CATALOG_VERSION){
 if(catalogVersion!==LEGACY_CATALOG_VERSION){const service=getCatalogService(catalogVersion),product=service.getProduct(productId,temperature);if(!product)throw new Error('Unsupported catalog product');const options=service.getSupportedOptions(product.identity),maps=options.map(o=>o.mapping),base=getCapabilities(productId==='shaken-espresso'?'latte':productId,product.temperature);return {...base,fields:base.fields.filter(f=>['size','temperature','quantity','onSide','cupSize','preparation'].includes(f)||maps.some(m=>m[0]===f)||['syrups','sauces','sweeteners','inclusions','toppings','coldFoam'].includes(f)),ingredients:Object.fromEntries(Object.keys(INGREDIENTS).map(g=>[g,[...(g==='coldFoams'?['none']:[]),...new Set(maps.filter(m=>m[0]===(g==='coldFoams'?'coldFoam':g)).map(m=>m[1]))]])),sizes:product.sizes.map(s=>s.size),temperatures:service.products.find(p=>p.id===productId).temperatures};}

 const p=CATALOG.find(p=>p.id===productId);if(!p)throw new Error('Invalid product');
 temperature??=p.temperatures[0];if(!p.temperatures.includes(temperature))throw new Error('Invalid temperature');
 const espresso=['latte','americano','mocha','cappuccino','flat-white','espresso'].includes(productId);
 const milky=['latte','mocha','cappuccino','flat-white','chai','matcha','mocha-frappuccino'].includes(productId);
 const inclusionIds=productId==='matcha'?['matcha']:productId==='mocha-frappuccino'?['java-chips','vanilla-bean']:productId==='refresher'?['strawberry','dragonfruit']:[];
 return {fields:MODIFIER_DEFINITIONS.filter(d=>!(['shots','caffeine','roast','shotStyle'].includes(d.id)&&!espresso)&&!(d.id==='heat'&&temperature!=='hot')).map(d=>d.id),ingredients:Object.fromEntries(Object.entries(INGREDIENTS).map(([g,list])=>[g,list.filter(i=>g==='inclusions'?inclusionIds.includes(i.id):g==='sauces'?milky:g==='toppings'?(i.id==='cookie-crumble'?productId==='mocha-frappuccino':i.id==='whipped-cream'?milky:true):g==='coldFoams'?(i.id==='none'||temperature==='iced'||temperature==='blended'):true).map(i=>i.id)])),sizes:p.sizesByTemperature[temperature],temperatures:p.temperatures};
}

export function getModifierOptions(drink,fieldId,catalogVersion=LEGACY_CATALOG_VERSION){
 const def=MODIFIER_DEFINITIONS.find(d=>d.id===fieldId);if(!def?.options)return [];
 const caps=getCapabilities(drink.productId,drink.temperature,catalogVersion);
 if(catalogVersion!==LEGACY_CATALOG_VERSION&&!['size','temperature','cupSize','onSide','preparation'].includes(fieldId)){return sourceSelectValues(getCatalogService(catalogVersion).getSupportedOptions(drink.productId,drink.size,drink.temperature),fieldId,def.options);}
 if(fieldId==='size')return [...caps.sizes];
 if(fieldId==='temperature')return [...caps.temperatures];
 if(fieldId==='cupSize')return ['standard',...caps.sizes.filter(size=>SIZES.indexOf(size)>=SIZES.indexOf(drink.size))];
 if(fieldId==='preparation'&&catalogVersion!==LEGACY_CATALOG_VERSION)return ['standard'];
 if(fieldId==='preparation')return def.options.filter(value=>value==='standard'||value==='double-blended'&&drink.temperature==='blended'||value==='affogato'&&drink.productId==='mocha-frappuccino'||value==='shaken'&&drink.temperature==='iced'&&['espresso','latte','mocha','cappuccino','flat-white'].includes(drink.productId)||value==='upside-down'&&['latte','mocha','cappuccino','flat-white'].includes(drink.productId));
 if(fieldId==='onSide')return def.options.filter(value=>value==='milk'?drink.milk!=='none':value==='ice'?drink.ice!=='none':value==='coldFoam'?drink.coldFoam.id!=='none'&&drink.coldFoam.amount!=='none':drink[value]?.some(i=>i.amount?i.amount!=='none':i.quantity>0));
 return [...def.options];
}
