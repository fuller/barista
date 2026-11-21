import {useState} from 'react';

type Props={value:number;revision:unknown;min:number;max:number;label:string;steppers?:boolean;onCommit:(value:number)=>void};
export function NumberDraft({value,revision,min,max,label,steppers=false,onCommit}:Props){
 const [draft,setDraft]=useState({revision,value,text:String(value)});
 const current=draft.revision===revision&&draft.value===value;
 const text=current?draft.text:String(value);
 const parsed=text.trim()===''?NaN:Number(text);
 const valid=Number.isInteger(parsed)&&parsed>=min&&parsed<=max;
 const stepBase=valid?parsed:value;
 const reset=()=>setDraft({revision,value,text:String(value)});
 const save=()=>{
  if(!current)return;
  if(valid&&parsed!==value)onCommit(parsed);
  reset();
 };
 const step=(delta:number)=>{const next=stepBase+delta;if(next>=min&&next<=max&&next!==value)onCommit(next);reset();};
 return <span className="number-draft">{steppers&&<button type="button" aria-label={'Decrease '+label} disabled={stepBase<=min} onPointerDown={event=>event.preventDefault()} onClick={()=>step(-1)}>−</button>}<input type="number" aria-label={label} min={min} max={max} step={1} value={text} onChange={event=>setDraft({revision,value,text:event.target.value})} onBlur={save} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();save();}else if(event.key==='Escape'){event.preventDefault();reset();}}}/>{steppers&&<button type="button" aria-label={'Increase '+label} disabled={stepBase>=max} onPointerDown={event=>event.preventDefault()} onClick={()=>step(1)}>+</button>}</span>;
}
