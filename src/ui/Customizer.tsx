import type {Drink,IngredientPath} from '../contracts';
import {MODIFIER_DEFINITIONS,INGREDIENTS,getCapabilities,getModifierOptions} from '../domain/modifiers.mjs';
type Ingredient={id:string;label:string};
type Definition={id:string;label:string;kind:string;options?:string[];group?:string;min?:number;max?:number;unit?:string};
const label=(value:string)=>value.replace(/([a-z])([A-Z])/g,'$1 $2').replaceAll(/[-_]/g,' ');
export function Customizer({item,onChange,catalogVersion}:{item:Drink;onChange:(changes:Partial<Drink>,touched?:IngredientPath[])=>void;catalogVersion?:string}){
 const cap=getCapabilities(item.productId,item.temperature,catalogVersion);const values=item as unknown as Record<string,unknown>;
 function change(field:string,value:unknown,ingredientId?:string){onChange({[field]:value} as Partial<Drink>,ingredientId?[`${field}:${ingredientId}` as IngredientPath]:undefined);}
 return <div className="custom-fields">{(MODIFIER_DEFINITIONS as Definition[]).filter(def=>cap.fields.includes(def.id)).map(def=>{
 const value=values[def.id];
 if(def.id==='temperature'&&cap.temperatures.length<=1)return null;
 if(def.kind==='ingredients'||def.kind==='toppings'){
 const group=def.group||def.id;const allowed=(cap.ingredients as Record<string,string[]>)[group]||[];const options=((INGREDIENTS as Record<string,Ingredient[]>)[group]||[]).filter(v=>allowed.includes(v.id));const entries=(value||[]) as {id:string;quantity?:number;amount?:string}[];
 return <fieldset className="ingredient-group" key={def.id}><legend>{label(def.label)}{def.unit?` · ${def.unit}`:''}</legend>{options.map((option:Ingredient)=>{const entry=entries.find(v=>v.id===option.id);return <div className="ingredient-row" key={option.id}><span>{option.label}</span>{def.kind==='ingredients'?<input aria-label={`${option.label} ${def.unit||'quantity'}`} type="number" min={0} max={def.max??12} value={entry?.quantity||0} onChange={e=>{if(e.target.value==='')return;const n=Number(e.target.value);change(def.id,[...entries.filter(v=>v.id!==option.id),...(n?[{id:option.id,quantity:n}]:[])],option.id);}}/>:<select aria-label={`${option.label} amount`} value={entry?.amount||'none'} onChange={e=>change(def.id,[...entries.filter(v=>v.id!==option.id),...(e.target.value==='none'?[]:[{id:option.id,amount:e.target.value}])],option.id)}>{['none','light','regular','extra'].map(v=><option key={v}>{v}</option>)}</select>}</div>;})}</fieldset>;
 }
 if(def.kind==='coldFoam'){
 const options=(INGREDIENTS.coldFoams as Ingredient[]).filter(v=>v.id!=='none'&&cap.ingredients.coldFoams.includes(v.id));const foam=value as {id:string;amount:string}|null;
 return <fieldset className="ingredient-group" key={def.id}><legend>{label(def.label)}</legend><label>Flavor<select value={foam?.id||'none'} onChange={e=>change(def.id,e.target.value==='none'?{id:'none',amount:'none'}:{id:e.target.value,amount:foam?.amount&&foam.amount!=='none'?foam.amount:'regular'})}><option value="none">None</option>{options.map(v=><option key={v.id} value={v.id}>{v.label}</option>)}</select></label>{foam&&foam.id!=='none'&&<label>Amount<select value={foam.amount} onChange={e=>change(def.id,{...foam,amount:e.target.value})}>{['light','regular','extra'].map(v=><option key={v}>{v}</option>)}</select></label>}</fieldset>;
 }
 if(def.kind==='multiSelect')return <fieldset className="ingredient-group" key={def.id}><legend>{label(def.label)}</legend>{getModifierOptions(item,def.id,catalogVersion).map((option:string)=><label className="check" key={option}><input type="checkbox" checked={((value||[]) as string[]).includes(option)} onChange={e=>change(def.id,e.target.checked?[...((value||[]) as string[]),option]:((value||[]) as string[]).filter(v=>v!==option))}/>{label(option)}</label>)}</fieldset>;
 const options=def.id==='size'?cap.sizes:def.id==='temperature'?cap.temperatures:getModifierOptions(item,def.id,catalogVersion);
 return <label key={def.id}>{label(def.label)}{def.kind==='number'?<input type="number" min={def.min??0} max={def.max??12} value={Number(value??0)} onChange={e=>{if(e.target.value!=='')change(def.id,Number(e.target.value));}}/>:<select value={String(value??'')} onChange={e=>change(def.id,e.target.value)}>{options.map((option:string)=><option key={option} value={option}>{label(option)}</option>)}</select>}</label>;
 })}{!cap.fields.includes('quantity')&&<label>Quantity<input type="number" min={1} max={12} value={item.quantity} onChange={e=>{if(e.target.value!=='')change('quantity',Number(e.target.value));}}/></label>}</div>;
}
export function Components({item,catalogVersion}:{item:Drink;catalogVersion?:string}){
 const cap=getCapabilities(item.productId,item.temperature,catalogVersion);const values=item as unknown as Record<string,unknown>;
 return <ul className="component-list">{(MODIFIER_DEFINITIONS as Definition[]).filter(def=>cap.fields.includes(def.id)&&!['size','temperature','quantity'].includes(def.id)).flatMap(def=>{
 const value=values[def.id];if(value===undefined||value===null)return [];
 if(Array.isArray(value))return value.map((v: string|{id:string;quantity?:number;amount?:string})=>typeof v==='string'?{key:def.id+':'+v,change:def.id,text:label(def.label)+': '+label(v)}:{key:def.id+':'+v.id,change:def.id+':'+v.id,text:label(v.id)+' · '+(v.quantity??v.amount)+' '+(def.unit||'')});
 if(typeof value==='object'){const v=value as {id:string;amount:string};return [{key:def.id,change:def.id,text:label(v.id)+' cold foam · '+v.amount}];}
 return [{key:def.id,change:def.id,text:label(def.label)+': '+label(String(value))}];
 }).map(component=><li key={component.key} data-change-key={component.change}>{component.text}</li>)}</ul>;
}
