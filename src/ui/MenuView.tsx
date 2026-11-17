import {useEffect,useMemo,useRef,useState} from 'react';
import type {CatalogSnapshot} from '../catalog/contracts';
import type {MenuDirectory,MenuDirectoryProduct} from '../catalog/menu-directory-contracts';
import bundledDirectory from '../catalog/data/starbucks-menu-directory.json';
import {ProductPhoto} from './ProductCard';
const directory=bundledDirectory as MenuDirectory;
const searchable=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
type SelectMenuProduct=(identity:string,size:string|null)=>boolean;

function MenuItemCard({product,onSelect}:{product:MenuDirectoryProduct;onSelect:SelectMenuProduct}){
 const [size,setSize]=useState<string|null>(product.sizes.length===1?product.sizes[0].sizeCode:null);
 const [added,setAdded]=useState(false);
 const feedbackTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 useEffect(()=>()=>{if(feedbackTimer.current!==null)clearTimeout(feedbackTimer.current);},[]);
 const categoryPath=product.categories[0]?.path;
 const path=categoryPath?.map(part=>part.name).join(' › ')||product.productType;
 const categoryName=categoryPath?.at(-1)?.name||product.productType;
 function add(){
  // Every click reaches the cart; feedback never locks out a second serving.
  const accepted=onSelect(product.identity,size);
  if(feedbackTimer.current!==null)clearTimeout(feedbackTimer.current);
  setAdded(accepted);
  if(accepted)feedbackTimer.current=setTimeout(()=>{setAdded(false);feedbackTimer.current=null;},1400);
 }
 return <article className="product-card" data-menu-identity={product.identity}>
  <ProductPhoto key={product.imageURL} src={product.imageURL} name={product.name} subject="product"/>
  <div className="product-info">
   <p className="product-kind" title={path}><span aria-hidden="true">{categoryName}</span><span className="sr-only">{path}</span></p>
   <h3>{product.name}</h3>
   <p className="product-description">{product.description||product.productType}</p>
   {product.sizes.length>1&&<label>Size<select aria-label={product.name+' size'} value={size??''} onChange={event=>setSize(event.target.value||null)}><option value="">Default size</option>{product.sizes.map(option=><option key={option.sizeCode} value={option.sizeCode}>{option.sizeCode}</option>)}</select></label>}
   {product.sizes.length===1&&<p className="product-kind">{product.sizes[0].sizeCode}</p>}
   <div className="product-bottom"><span><small>Price unavailable</small></span><button aria-label={'Add '+product.name} data-added={added||undefined} onClick={add}><span aria-hidden="true">{added?'✓':'+'}</span> {added?'Added':'Add'}</button></div>
   <span className="sr-only" role="status">{added?product.name+' added to your order.':''}</span>
  </div>
 </article>;
}
export function MenuView({catalog:_,menuDirectory=directory,onSelect}:{catalog?:CatalogSnapshot;menuDirectory?:MenuDirectory;onSelect:SelectMenuProduct}){
 const [search,setSearch]=useState(''),[root,setRoot]=useState('all'),[category,setCategory]=useState('all');
 const searchInput=useRef<HTMLInputElement>(null);
 const roots=useMemo(()=>menuDirectory.categories.filter(c=>c.parentPathKey===null),[menuDirectory]);
 const categories=useMemo(()=>menuDirectory.categories.filter(c=>root==='all'||c.rootCategory.id===root),[menuDirectory,root]);
 // Normalize catalog text once per snapshot rather than for every keystroke.
 const searchIndex=useMemo(()=>menuDirectory.products.map(product=>({product,text:searchable([product.name,product.description,product.productType,...product.categories.map(c=>c.path.map(p=>p.name).join(' '))].join(' '))})),[menuDirectory]);
 const query=searchable(search.trim());
 const products=useMemo(()=>searchIndex.filter(({product,text})=>(root==='all'||product.categories.some(c=>c.rootCategory.id===root))&&(category==='all'||product.categories.some(c=>c.pathKey===category||c.pathKey.startsWith(category+'/')))&&text.includes(query)).map(({product})=>product),[searchIndex,root,category,query]);
 const filtered=Boolean(search||root!=='all'||category!=='all');
 function resetFilters(){setSearch('');setRoot('all');setCategory('all');searchInput.current?.focus();}
 return <section className="menu-view" aria-label="Full menu">
  <div className="menu-heading"><div><p className="eyebrow">THE FULL MENU</p><h2>Find your next favorite.</h2><p>Drinks, food and more. Make it yours.</p></div><label className="menu-search"><span className="sr-only">Search menu</span><input ref={searchInput} type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search the full menu…" autoComplete="off" enterKeyHint="search"/></label></div>
  <nav className="category-strip" aria-label="Menu categories"><button aria-pressed={root==='all'} onClick={()=>{setRoot('all');setCategory('all');}}>All menu</button>{roots.map(c=><button key={c.pathKey} aria-pressed={root===c.id} onClick={()=>{setRoot(c.id);setCategory('all');}}>{c.name}</button>)}</nav>
  <div className="menu-filters"><label className="menu-path-filter">Category<select aria-label="Menu category" value={category} onChange={event=>setCategory(event.target.value)}><option value="all">All categories</option>{categories.map(c=><option key={c.pathKey} value={c.pathKey}>{c.path.map(p=>p.name).join(' › ')}</option>)}</select></label>{filtered&&products.length>0&&<button className="clear-menu-filters" onClick={resetFilters}>Clear filters</button>}</div>
  <p className="menu-count" role="status">{products.length} {products.length===1?'item':'items'} · full menu</p>
  <div className="product-grid">{products.map(product=><MenuItemCard key={menuDirectory.version+':'+product.identity} product={product} onSelect={onSelect}/>)}</div>
  {!products.length&&<div className="no-results"><h3>No matching items</h3><p>{search.trim()?`No items match “${search.trim()}” with these filters.`:'No items match these categories.'} Try another name or browse the full menu.</p><button className="clear-menu-filters" onClick={resetFilters}>Clear filters</button></div>}
 </section>;
}
