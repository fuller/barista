import {useEffect,useRef,useState} from 'react';
export type Store={storeId:string;source:'starbucks';sourceStoreNumber:string;name:string;address:{lines:string[];city:string;region:string;postalCode:string;countryCode:string};coordinates:{latitude:number;longitude:number};selectionToken:string};
export function storeAddress(store:Store){const lines=store.address.lines.filter(Boolean);return (lines.length?lines:[[store.address.city,store.address.region,store.address.postalCode].filter(Boolean).join(', ')]).join(' · ');}
export function StorePicker({onConfirm,onCancel}:{onConfirm:(store:Store)=>void;onCancel?:()=>void}){
 const [query,setQuery]=useState('11201'),[stores,setStores]=useState<Store[]>([]),[selected,setSelected]=useState(''),[phase,setPhase]=useState<'idle'|'locating'|'searching'>('idle'),[searched,setSearched]=useState(false),[error,setError]=useState('');
 const controller=useRef<AbortController|null>(null),heading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{heading.current?.focus();return()=>controller.current?.abort();},[]);
 function beginSearch(phase:'locating'|'searching'){
  controller.current?.abort();const current=new AbortController();controller.current=current;
  setPhase(phase);setError('');setStores([]);setSelected('');setSearched(false);return current;
 }
 async function search(params=new URLSearchParams({q:query.trim()}),current=beginSearch('searching')){
  if(current.signal.aborted)return;setPhase('searching');
  try{
   const response=await fetch('/api/stores?'+params,{signal:current.signal});
   if(!response.ok)throw new Error('Store search is unavailable. Try again.');
   const data=await response.json();if(!Array.isArray(data.stores))throw new Error('Store search is unavailable. Try again.');
   if(current.signal.aborted)return;setStores(data.stores);setSearched(true);
  }catch(reason){if(!current.signal.aborted)setError(reason instanceof Error?reason.message:'Store search is unavailable. Try again.');}
  finally{if(!current.signal.aborted)setPhase('idle');}
 }
 function useLocation(){
  const current=beginSearch('locating');
  const fail=(message:string)=>{if(!current.signal.aborted){setError(message+' Enter a ZIP code or city instead.');setPhase('idle');}};
  if(!navigator.geolocation){fail('Location is unavailable in this browser.');return;}
  try{
   navigator.geolocation.getCurrentPosition(position=>{
    if(current.signal.aborted)return;
    const lat=Number(position.coords.latitude.toFixed(4)),lng=Number(position.coords.longitude.toFixed(4));
    void search(new URLSearchParams({lat:String(lat),lng:String(lng)}),current);
   },reason=>fail(reason.code===1?'Location permission was denied.':reason.code===3?'Location request timed out.':'Could not find your location.'),{enableHighAccuracy:false,timeout:10000,maximumAge:60000});
  }catch{fail('Could not find your location.');}
 }
 const choice=stores.find(store=>store.storeId===selected);
 return <section className="store-picker panel" aria-labelledby="store-picker-title"><h1 id="store-picker-title" ref={heading} tabIndex={-1}>Choose your store</h1><p>Find a café for live prices. Your cart stays with you when you change stores.</p><form onSubmit={event=>{event.preventDefault();if(query.trim())void search();}}><label htmlFor="store-search">ZIP code or city</label><div className="store-search"><input id="store-search" value={query} maxLength={120} onChange={event=>setQuery(event.target.value)} autoComplete="postal-code"/><button disabled={!query.trim()}>Search stores</button></div></form><div className="location-search"><button type="button" className="use-location" aria-label="Use my location" disabled={phase==='locating'} onClick={useLocation}>Use my location</button><span>Find nearby cafés with browser permission.</span></div>{phase!=='idle'&&<p role="status">{phase==='locating'?'Finding your location…':'Finding stores…'}</p>}{error&&<p role="alert" className="error">{error}</p>}{searched&&<p role="status">{stores.length?`${stores.length} stores found`:'No stores found. Try another ZIP code or city.'}</p>}{stores.length>0&&<fieldset><legend>Select a store</legend><div className="store-results">{stores.map(store=><label className="store-card" key={store.storeId}><input type="radio" name="store" value={store.storeId} checked={selected===store.storeId} onChange={()=>setSelected(store.storeId)}/><span><strong>{store.name}</strong><span>{storeAddress(store)}</span></span></label>)}</div></fieldset>}<div className="store-actions"><button disabled={!choice} onClick={()=>choice&&onConfirm(choice)}>Use this store</button>{onCancel&&<button onClick={onCancel}>Keep current store</button>}</div></section>;
}
