import {getRelativeBaseline} from '../../src/domain/order.mjs';
import {CATALOG,getDefaults} from '../../src/domain/catalog.mjs';
import {INGREDIENTS} from '../../src/domain/modifiers.mjs';
export const normalize=text=>String(text??'').toLowerCase().replace(/[’']/g,'').replace(/[-_]/g,' ').replace(/[^a-z0-9%\s]/g,' ').replace(/\s+/g,' ').trim();
const numberWords={zero:0,a:1,an:1,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12};
export const numberValue=value=>Object.hasOwn(numberWords,value)?numberWords[value]:Number(value);
const NUM='(?:\\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';
const productNames=[['mocha frappuccino','mocha-frappuccino'],['black tea','black-tea'],['flat white','flat-white'],['cold brew','cold-brew'],['matcha latte','matcha'],['chai latte','chai'],['cappuccino','cappuccino'],['americano','americano'],['refresher','refresher'],['shaken espresso','shaken-espresso'],['espresso','espresso'],['mocha','mocha'],['matcha','matcha'],['chai','chai'],['latte','latte']];
function findProduct(t){for(const [name,id] of productNames){const re=new RegExp(`\\b${name}\\b`);const m=re.exec(t);if(!m)continue;const before=t.slice(0,m.index),after=t.slice(m.index+name.length);if(id==='espresso'&&(/\b(blonde|signature|regular|extra|long|ristretto)\s*$/.test(before)||/^ shots?\b/.test(after)))continue;if(['mocha','matcha'].includes(id)&&(/\b(pumps?|scoops?)\s*$/.test(before)||/^ (sauce|syrup|inclusions|drizzle)\b/.test(after)))continue;return {id,index:m.index,length:name.length};}return null;}
function itemTarget(t,order,activeItemId){t=t.replace(/\b(?:one|two) thirds? decaf\b/g,'decaf');if(/\b(first|1st)\b/.test(t))return order.items[0];if(/\b(second|2nd)\b/.test(t))return order.items[1];if(/\b(third|3rd)\b/.test(t))return order.items[2];return order.items.find(i=>i.id===activeItemId)??order.items.at(-1);}
const amounts={no:'none',none:'none',without:'none',light:'light',regular:'regular',extra:'extra'};
const amountBefore=(t,index)=>{const m=t.slice(0,index).match(/\b(no|none|without|light|regular|extra)\s*$/);return m?amounts[m[1]]:'regular';};
const ingredientNames=Object.entries(INGREDIENTS).filter(([g])=>!['coldFoams','toppings'].includes(g)).flatMap(([group,items])=>items.map(item=>({group,id:item.id,name:normalize(item.label)}))).sort((a,b)=>b.name.length-a.name.length);
function ingredientMentions(t){
 const found=[];let masked=t;
 for(const entry of ingredientNames){

  const re=new RegExp(`\\b${entry.name}\\b`,'g');let m;
  while((m=re.exec(masked))){const tail=t.slice(m.index+m[0].length);if(entry.group==='sauces'&&entry.id==='caramel'&&!/^ sauce\b/.test(tail))continue;if(entry.group==='syrups'&&entry.id==='caramel'&&/^ sauce\b/.test(tail))continue;
   if(entry.group==='sauces'&&entry.id==='mocha'&&/^ drizzle\b/.test(tail))continue;
   const prefix=t.slice(0,m.index);const qty=prefix.match(new RegExp(`\\b(${NUM})\\s*(?:(?:pumps?|packets?|scoops?)\\s*)?$`));
   const suffix=tail.match(new RegExp(`^ (?:inclusions? )?(?:to )(${NUM})\\b`));
   const remove=/\b(no|remove|without)\s*$/.test(prefix);
   found.push({...entry,index:m.index,end:m.index+m[0].length,quantity:remove?0:qty?numberValue(qty[1]):suffix?numberValue(suffix[1]):null});
   masked=masked.slice(0,m.index)+' '.repeat(m[0].length)+masked.slice(m.index+m[0].length);
  }
 }
 return found.sort((a,b)=>a.index-b.index);
}
function withIngredient(changes,current,group,id,quantity){const list=changes[group]??structuredClone(current[group]??[]);const index=list.findIndex(i=>i.id===id);if(quantity===0){if(index>=0)list.splice(index,1);}else if(index>=0)list[index]={id,quantity};else list.push({id,quantity});changes[group]=list;}
const baseVocabulary='a an and the i id like would can could you me have get want please thanks thank with without of for to that this it is all thats make change switch instead actually but add another duplicate copy remove delete cancel first second third 1st 2nd 3rd last one drink drinks order size tall short grande venti trenta trenti hot iced ice water blended warm extra standard light regular no none not or milk nonfat dairy cold steamed foam wet dry half caf caffeine caffeinated decaf third thirds signature blonde ristretto long espresso shot shots syrup syrups sauce sauces pumps pump packets packet scoops scoop inclusions inclusion topping toppings zero two three four five six seven eight nine ten eleven twelve whipped cream whip sweet sweetness sweeter sweeteners sweetener flavor set quantity total replace on side leave room in cup upside down affogato shaken double'.split(' ');
export function knownVocabulary(t){const allowed=new Set([...baseVocabulary,...productNames.flatMap(([name])=>name.split(' ')),...Object.values(INGREDIENTS).flatMap(items=>items.flatMap(i=>normalize(i.label).split(' '))),...['oat','almond','soy','coconut','whole','skim','2%','sugar','free','unsweetened']]);return t.split(' ').every(w=>!w||/^\d+$/.test(w)||allowed.has(w));}
const sizeName=value=>value==='trenti'?'trenta':value;
function conflictingModifiers(t){
 const conflicts=(text,pattern,value=m=>m[1])=>new Set([...text.matchAll(pattern)].map(value)).size>1;
 const cup=/\b(short|tall|grande|venti|trenta|trenti) cup\b/g;
 const format=t.replace(/\b(?:extra hot|double blended)\b/g,'');
 if(conflicts(t,cup,m=>sizeName(m[1]))||conflicts(t.replace(cup,''),/\b(short|tall|grande|venti|trenta|trenti)\b/g,m=>sizeName(m[1]))||conflicts(format,/\b(hot|iced|blended)\b/g))return true;
 const milk=[...t.matchAll(/\b(oat|almond|soy|coconut|whole|skim|nonfat)\b|2%/g)].map(m=>m[0]==='nonfat'?'skim':m[0]);
 if(/\b(?:no|without) milk\b(?! foam)/.test(t))milk.push('none');
 if(new Set(milk).size>1)return true;
 if(conflicts(t,new RegExp(`\\b(${NUM}) (extra )?(?:espresso )?shots?\\b`,'g'),m=>`${m[2]?'extra':'total'}:${numberValue(m[1])}`))return true;
 if(conflicts(t,/\b(two thirds decaf|one third decaf|half caf|decaf|regular (?:espresso|caffeine)|caffeinated)\b/g,m=>/regular|caffeinated/.test(m[1])?'regular':m[1]))return true;
 if(conflicts(t,/\b(blonde|signature)\b/g)||conflicts(t,/\b(warm|extra hot)\b/g)||conflicts(t,/\b(ristretto|long) (?:espresso )?shots?\b/g))return true;
 if(conflicts(t,/\b(no|light|regular|extra) (?:(?:oat|almond|soy|whole|skim|cold|steamed) )?milk\b(?! foam)/g,m=>amounts[m[1]])||conflicts(t,/\b(cold|steamed) milk\b/g))return true;
 if(conflicts(t,/\b(?:(no|light|regular|extra) milk foam|(dry|wet))\b/g,m=>m[2]==='dry'?'extra':m[2]==='wet'?'light':amounts[m[1]]))return true;
 for(const field of ['ice','water','room'])if(conflicts(t,new RegExp(`\\b(no|light|regular|extra) ${field}\\b`,'g'),m=>amounts[m[1]]))return true;
 return conflicts(t,/\b(upside down|double blended|affogato|shaken)\b/g);
}

function normalizeDemoOrder(text){
 const t=normalize(text),count=`(?:a|an|${NUM})`;
 const prefix=new RegExp(`(^|\\band\\s+)((?:add\\s+)?${count}\\s+(?:(?:short|tall|grande|venti|trenta|trenti|hot|iced|blended)\\s+)*)american(?:a)?\\b`,'g');
 return t.replace(prefix,(_match,boundary,intro)=>boundary+intro+'americano');
}

export function splitDemoAdditions(text){
 const t=normalizeDemoOrder(text),count=`(?:a|an|${NUM})`;
 const names=productNames.map(([name])=>name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|');
 const introduction=`(?:add\\s+)?${count}\\s+(?:(?:short|tall|grande|venti|trenta|trenti|hot|iced|blended)\\s+)*(?:${names})\\b(?!\\s+(?:syrups?|sauces?|powder|shots?|drizzle|inclusions?|cold foam)\\b)`;
 const clauses=t.split(new RegExp(`\\band\\s+(?=${introduction})`,'g')).map(part=>part.trim());
 if(clauses.length<2)return null;
 const unsafe=/\b(?:both|either|neither|all|each|entire|for|to|shared|same|together|respectively|it|its|this|that|these|those|them|first|second|third|last|previous|another|or|but|actually|instead|then|make|change|switch|set|replace|remove|delete|undo|clear|confirm|cancel)\b/;
 if(clauses.length>6||/["'“”‘’`]/u.test(text)||unsafe.test(t))return {failure:true};
 const header=new RegExp('^'+introduction);
 const located=[];
 for(const clause of clauses){const match=header.exec(clause);if(!match)return {failure:true};const product=findProduct(match[0]);if(!product)return {failure:true};located.push({text:clause,productId:product.id});}
 return {clauses:located};
}
export function parseDemoTurn({text,order,activeItemId}){
 const t=normalizeDemoOrder(text),touched=new Set();const ask=clarification=>({commands:[],clarification,source:'demo'});const done=command=>{const tokens=[...touched].filter(token=>command.changes?.[token.split(':')[0]]);return {commands:[tokens.length?{...command,touched:tokens}:command],clarification:null,source:'demo'};};
 if(/^(undo|undo that|go back)$/.test(t))return done({type:'undo'});
 if(/^(clear|clear order|start over|cancel order)$/.test(t))return done({type:'clear'});
 if(/^(done|confirm|confirm order|that is all|thats all|checkout|check out)$/.test(t))return done({type:'confirm'});
 if(/half sweet|less sweet|sweeter/.test(t))return ask('Which sweetener, and how many pumps, would you like?');
 if(!t||!knownVocabulary(t))return ask('That phrasing is outside the demo vocabulary. Try an example from Test menu, or use the modifier controls.');

 if(/\b(not|or|actually|instead)\b/.test(t)||/\b(two|three|\d+) (lattes|drinks|coffees)\b/.test(t))return ask('Please request one drink or one clear change at a time.');
 if(/\b(?:no|without) (oat|almond|soy|coconut|vanilla|caramel|blonde|decaf)\b/.test(t))return ask('Please name the replacement or say exactly which ingredient to remove.');
 if(t.split(/\band\b/).slice(1).some(clause=>/\b(add|make|change|remove|duplicate)\b/.test(clause)||/\b(?:a|an|one|another) (?:tall |grande |venti )?(latte|mocha|americano|chai|cold brew|cappuccino|flat white|refresher|shaken espresso)\b(?!\s+(?:syrups?|sauces?|powder|shots?|drizzle|inclusions?|cold foam)\b)/.test(clause)))return ask('Please add or change one drink at a time in demo mode.');
 const item=itemTarget(t,order,activeItemId);const product=findProduct(t);
 const duplicating=/\b(duplicate|copy)\b|\banother\b(?! (?:espresso )?shot)/.test(t);
 const editing=/\b(make|change|switch|set|replace)\b/.test(t)||!product;
 const isAdd=!!product&&!editing&&!duplicating;
 const c={};let mods=isAdd?t.slice(0,product.index)+t.slice(product.index+product.length):t;
 if(isAdd){const count=t.slice(0,product.index).match(new RegExp(`\\b(${NUM})\\s+(?:(?:short|tall|grande|venti|trenta|trenti|hot|iced|blended)\\s+)*$`));if(count&&numberValue(count[1])!==1)c.quantity=numberValue(count[1]);}
 if(conflictingModifiers(mods))return ask('Please choose one value for each modifier so I can keep every change.');
 const cup=mods.match(/\b(short|tall|grande|venti|trenta|trenti) cup\b/);if(cup){c.cupSize=sizeName(cup[1]);mods=mods.replace(cup[0],'cup');}
 const size=mods.match(/\b(short|tall|grande|venti|trenta|trenti)\b/);if(size)c.size=sizeName(size[1]);
 if(/\biced\b/.test(mods))c.temperature='iced';
 if(/\bhot\b/.test(mods)&&!/\bextra hot\b/.test(mods))c.temperature='hot';
 if(/\bblended\b/.test(mods)&&!/\bdouble blended\b/.test(mods))c.temperature='blended';
 let current=item;
 try{if(isAdd)current=getDefaults(product.id,c.size,c.temperature,order.catalogVersion);else if(current)current=getRelativeBaseline(current,c,order.catalogVersion);}catch{return ask('That drink does not support the requested size or format.');}
 if(!current)return ask('Which drink would you like first?');
 const milk=mods.match(/\b(oat|almond|soy|coconut|whole|skim|nonfat)\b|2%/);if(milk)c.milk=milk[0]==='nonfat'?'skim':milk[0];
 if(/\b(no|without) milk\b/.test(mods)&&!/\b(no|without) milk foam\b/.test(mods))c.milk='none';
 const milkAmount=mods.match(/\b(no|light|regular|extra) (?:(?:oat|almond|soy|whole|skim|cold|steamed) )?milk\b(?! foam)/);if(milkAmount)c.milkAmount=amounts[milkAmount[1]];
 const milkPrep=mods.match(/\b(cold|steamed) milk\b/);if(milkPrep)c.milkPreparation=milkPrep[1];
 const milkFoam=mods.match(/\b(no|light|regular|extra) milk foam\b/);if(milkFoam)c.milkFoam=amounts[milkFoam[1]];
 if(/\bdry\b/.test(mods))c.milkFoam='extra';if(/\bwet\b/.test(mods))c.milkFoam='light';
 if(/\bextra hot\b/.test(mods))c.heat='extra-hot';else if(/\bwarm\b/.test(mods))c.heat='warm';
 const roast=mods.match(/\b(blonde|signature)\b/);if(roast)c.roast=roast[1];
 if(/\btwo thirds decaf\b/.test(mods))c.caffeine='two-thirds-decaf';else if(/\bone third decaf\b/.test(mods))c.caffeine='one-third-decaf';else if(/\bhalf caf\b/.test(mods))c.caffeine='half-caf';else if(/\bdecaf\b/.test(mods))c.decaf=true;else if(/\bregular (espresso|caffeine)|caffeinated\b/.test(mods))c.caffeine='regular';
 const style=mods.match(/\b(ristretto|long) (?:espresso )?shots?\b/);if(style)c.shotStyle=style[1];
 const shots=mods.match(new RegExp(`\\b(${NUM}) (extra )?(?:espresso )?shots?\\b`));
 if(shots)c.shots=numberValue(shots[1])+(shots[2]?current.shots:0);
 else if(/\bextra (espresso )?shot\b|\banother (espresso )?shot\b|\badd (?:a|an) (espresso )?shot\b/.test(mods))c.shots=current.shots+1;
 for(const field of ['ice','water','room']){const m=mods.match(new RegExp(`\\b(no|light|regular|extra) ${field}\\b`));if(m)c[field]=amounts[m[1]];}
 const preparation=mods.match(/\b(upside down|double blended|affogato|shaken)\b/);if(preparation)c.preparation=preparation[1].replace(' ','-');
 const side=mods.match(/\b(milk|ice|syrups?|sauces?|sweeteners?|inclusions?|toppings?|cold foam) on (?:the )?side\b/);if(side)c.onSide=[...new Set([...current.onSide,side[1]==='cold foam'?'coldFoam':['milk','ice'].includes(side[1])?side[1]:side[1].replace(/s?$/,'s')])];

 let ingredientText=mods;
 const foam=mods.match(/\b(?:(vanilla sweet cream|salted caramel|chocolate|nondairy vanilla) )?cold foam\b/);
 if(foam){const amount=amountBefore(mods,foam.index);c.coldFoam={id:amount==='none'?'none':foam[1]?foam[1].replaceAll(' ','-'):'vanilla-sweet-cream',amount};ingredientText=ingredientText.replace(foam[0],' '.repeat(foam[0].length));}
 for(const topping of INGREDIENTS.toppings){const name=topping.id==='whipped-cream'?'(?:whipped cream|whip)':normalize(topping.label);const m=new RegExp(`\\b${name}\\b`).exec(ingredientText);if(!m)continue;touched.add('toppings:'+topping.id);const amount=amountBefore(mods,m.index);const list=c.toppings??structuredClone(current.toppings??[]);const i=list.findIndex(x=>x.id===topping.id);if(amount==='none'){if(i>=0)list.splice(i,1);}else if(i>=0)list[i]={id:topping.id,amount};else list.push({id:topping.id,amount});c.toppings=list;ingredientText=ingredientText.slice(0,m.index)+' '.repeat(m[0].length)+ingredientText.slice(m.index+m[0].length);}

 const mentions=ingredientMentions(ingredientText);
 if(/\bhalf the flavor\b/.test(mods)){
  const included=['syrups','sauces'].flatMap(group=>current[group].map(ingredient=>({...ingredient,group})));
  if(included.length!==1)return ask('Which syrup or sauce should have half the flavor?');
  if(mentions.some(m=>['syrups','sauces'].includes(m.group))||new RegExp(`\\b(${NUM}) pumps?\\b`).test(mods)||/\b(?:(?:no|without) (?:syrup|sauce)|unsweetened)\b/.test(mods))return ask('Please choose half the flavor or one exact syrup or sauce change.');
  const {group,id,quantity}=included[0];touched.add(group+':'+id);withIngredient(c,current,group,id,Math.round(quantity/2));
 }
 for(const mention of mentions)touched.add(mention.group+':'+mention.id);
 if(/\breplace\b/.test(t)){
  if(mentions.length!==2||mentions[0].group!==mentions[1].group)return ask('Please name one existing ingredient and one replacement in the same category.');
  const [from,to]=mentions;const prior=current[from.group]?.find(i=>i.id===from.id);if(!prior)return ask('That ingredient is not on this drink. Which one should I replace?');withIngredient(c,current,from.group,from.id,0);withIngredient(c,current,to.group,to.id,to.quantity??prior.quantity);
 }else{
  for(const m of mentions){const prior=(c[m.group]??current[m.group]??[]).find(i=>i.id===m.id)?.quantity??0;const absolute=/\b(set|make)\b/.test(mods)||!/\badd\b/.test(mods);const quantity=m.quantity===0?0:m.quantity===null?(prior||(['syrups','sauces'].includes(m.group)?({short:2,tall:3,grande:4,venti:5,trenta:6}[c.size??current.size]):1)):m.quantity+(absolute?0:prior);withIngredient(c,current,m.group,m.id,quantity);}
 }
 const clearGroup=group=>{for(const ingredient of [...current[group],...(c[group]??[])])touched.add(group+':'+ingredient.id);c[group]=[];};
 if(/\b(no|without) syrup\b/.test(mods))clearGroup('syrups');
 if(/\b(no|without) sauce\b/.test(mods))clearGroup('sauces');
 if(/\bunsweetened\b/.test(mods))for(const group of ['syrups','sauces','sweeteners'])clearGroup(group);
 const pumps=mods.match(new RegExp(`\\b(${NUM}) pumps?\\b`));if(pumps&&!mentions.length)c.pumps=numberValue(pumps[1]);

 if(!/syrup|sauce/.test(mods)&&mentions.length===1&&mentions[0].group==='syrups'&&!/\badd\b/.test(mods)&&!current.syrups?.length&&!current.sauces?.length){c.syrup=mentions[0].id;delete c.syrups;if(pumps)c.pumps=numberValue(pumps[1]);}
 if(/\b(whip|whipped cream)\b/.test(mods)&&!Object.keys(c).some(k=>!['toppings'].includes(k))){const topping=c.toppings?.find(x=>x.id==='whipped-cream');if(!topping||topping.amount==='regular'){c.whip=!!topping;delete c.toppings;}}
 if(!Object.keys(c).length&&/\b(remove|delete|cancel)\b/.test(mods))return done({type:'remove',itemId:current.id});

 if(!isAdd&&item)for(const group of ['syrups','sauces','sweeteners','inclusions','toppings'])if(c[group]){const edited=new Set([...touched].filter(path=>path.startsWith(group+':')).map(path=>path.slice(group.length+1)));c[group]=c[group].flatMap(i=>edited.has(i.id)?[i]:item[group].filter(old=>old.id===i.id));for(const original of item[group])if(!edited.has(original.id)&&!c[group].some(i=>i.id===original.id))c[group].push(original);}
 if(duplicating)return done({type:'duplicate',itemId:item.id,changes:c});
 if(isAdd)return done({type:'add',productId:product.id,changes:c});
 if(!Object.keys(c).length)return ask('What would you like to change?');
 return done({type:'update',itemId:item.id,changes:c});
}
