import {useState} from 'react';
import type {SupportedProduct,CatalogProduct} from '../catalog/contracts';
import {PRICE_BOOK,formatMoney} from '../domain/pricing.mjs';
import type {Size,Temperature} from '../contracts';
export function ProductPhoto({src,name,subject='base drink'}:{src:string|null;name:string;subject?:string}){
 const [failed,setFailed]=useState(false);
 let safe=false;try{const url=new URL(src||'');safe=url.protocol==='https:'&&url.hostname==='cloudassets.starbucks.com'&&!url.username&&!url.password;}catch{/* Fall back to the local cup. */}
 return <div className="product-photo">{safe&&!failed?<img src={src!} alt={name+' · '+subject+' photo'} width={480} height={480} loading="lazy" decoding="async" onError={()=>setFailed(true)}/>:<svg role="img" aria-label={name+' · photo unavailable'} width="480" height="480" viewBox="0 0 100 100"><circle cx="50" cy="50" r="39" fill="#e2e9d9"/><path d="M31 33h34v32c0 7-6 12-12 12H43c-7 0-12-5-12-12V33Zm34 7h5c15 0 15 20 0 20h-5M41 21v6m12-6v6" fill="none" stroke="#6c8065" strokeWidth="3" strokeLinecap="round"/></svg>}</div>;
}
export function ProductCard({product,forms,onSelect}:{product:SupportedProduct;forms:CatalogProduct[];onSelect:(id:string,size:Size,temperature:Temperature)=>void}){
 const [temperature,setTemperature]=useState(product.temperatures[0]);
 const sizes=product.sizesByTemperature[temperature]||product.sizes;
 const [size,setSize]=useState(sizes.includes('grande')?'grande':sizes[0]);
 const form=forms.find(p=>p.temperature===temperature);
 const price=(PRICE_BOOK.basePrices as Record<string,Record<string,number>>)[product.id]?.[size];
 return <article className="product-card"><ProductPhoto key={form?.imageURL||product.imageURL} src={form?.imageURL||product.imageURL} name={product.name}/><div className="product-info"><p className="product-kind">{product.temperatures.join(' / ')}</p><h3>{product.name}</h3><p className="product-description">{product.description||'A familiar favorite, made your way.'}</p><details className="card-options"><summary>{product.temperatures.length>1?'Size & format':'Size'} <span>+</span></summary><div>{product.temperatures.length>1&&<label>Format<select aria-label={product.name+' format'} value={temperature} onChange={e=>{const t=e.target.value;setTemperature(t);const available=product.sizesByTemperature[t];if(!available.includes(size))setSize(available.includes('grande')?'grande':available[0]);}}>{product.temperatures.map(value=><option key={value}>{value}</option>)}</select></label>}<label>Size<select aria-label={product.name+' size'} value={size} onChange={e=>setSize(e.target.value)}>{sizes.map(value=><option key={value}>{value}</option>)}</select></label></div></details><div className="product-bottom"><span>{Number.isSafeInteger(price)?<><strong>{formatMoney(price)}</strong><small>Sample · {size}</small></>:<small>Sample price unavailable</small>}</span><button aria-label={'Add '+product.name} onClick={()=>onSelect(product.id,size as Size,temperature as Temperature)}><span aria-hidden="true">+</span> Add</button></div></div></article>;
}
