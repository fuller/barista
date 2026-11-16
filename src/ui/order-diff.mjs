/** Compare authoritative order states; transport metadata never produces a visual change. */
/** @returns {{added:string[],removed:string[],updated:Array<{id:string,fields:string[],ingredients:string[]}>}} */
export function diffOrder(before,after){
 const groups=['syrups','sauces','sweeteners','inclusions','toppings'];
 const ignored=new Set(['id','explicit','syrup','pumps','decaf','whip',...groups]);
 const old=new Map([...before.items,...(before.menuItems??[])].map(item=>[item.id,item])),next=new Map([...after.items,...(after.menuItems??[])].map(item=>[item.id,item]));
 const result={added:[...next.keys()].filter(id=>!old.has(id)),removed:[...old.keys()].filter(id=>!next.has(id)),updated:[]};
 for(const item of after.items){
  const previous=old.get(item.id);if(!previous)continue;
  const fields=Object.keys(item).filter(key=>!ignored.has(key)&&JSON.stringify(key==='onSide'?[...previous[key]].sort():previous[key])!==JSON.stringify(key==='onSide'?[...item[key]].sort():item[key]));
  const ingredients=[];
  for(const group of groups){const a=new Map(previous[group].map(i=>[i.id,i])),b=new Map(item[group].map(i=>[i.id,i]));for(const id of new Set([...a.keys(),...b.keys()]))if(JSON.stringify(a.get(id))!==JSON.stringify(b.get(id)))ingredients.push(group+':'+id);}
  if(fields.length||ingredients.length)result.updated.push({id:item.id,fields,ingredients});
 }
 for(const item of after.menuItems??[]){const previous=old.get(item.id);if(!previous)continue;const fields=['identity','name','size','quantity','instructions'].filter(key=>JSON.stringify(previous[key])!==JSON.stringify(item[key]));if(fields.length)result.updated.push({id:item.id,fields,ingredients:[]});}
 return result;
}
