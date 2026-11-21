import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import type {Drink,IngredientPath} from '../contracts';
import {formatMoney} from '../domain/pricing.mjs';
import {StorePicker,storeAddress} from './StorePicker';
import type {Store} from './StorePicker';
import {VoicePreview} from './VoicePreview';
import {MenuView} from './MenuView';
import {OrderPanel} from './OrderPanel';
import {useLiveQuote} from './quote-query';
import {pricingAvailable} from './quote-cache.mjs';
import {useOrdering} from './use-ordering';
import {useCatalog,useMenuDirectory} from './catalog-query';
import {defaultCatalogService} from '../catalog/service.mjs';
const examples=['A grande iced vanilla latte','Make that oat milk','Add another shot'];
function Icon({kind}:{kind:'mic'|'arrow'}){return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">{kind==='mic'?<><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M6 10v2a6 6 0 0012 0v-2M12 18v4m-4 0h8"/></>:<path d="M5 12h14m-6-6 6 6-6 6"/>}</svg>}
export default function App(){
 const catalog=useCatalog(),menuDirectory=useMenuDirectory();
 const [cartOpen,setCartOpen]=useState(false),[mobile,setMobile]=useState(()=>window.matchMedia('(max-width:720px)').matches);
 const messagesPane=useRef<HTMLDivElement|null>(null),orderRail=useRef<HTMLDivElement|null>(null);
 const [text,setText]=useState('');
 const [store,setStore]=useState<Store|null>(null),[choosingStore,setChoosingStore]=useState(true);
 const activeStore=choosingStore?null:store;
 const [configReady,setConfigReady]=useState(false);
 const [connectionAttempt,setConnectionAttempt]=useState(0),[connectionError,setConnectionError]=useState('');
 const [config,setConfig]=useState({liveAvailable:false,model:'',provider:'',pricingAvailable:false,cacheScope:null as string|null});
 const workflow=useOrdering({ready:configReady,available:config.liveAvailable,error:connectionError});
 const {order,change,pending,messages,error,busy,listening,voiceSupported,replies,metrics,interim,preparing,preview,localTiming,commit,cancel,cancelQuestion,startVoice,finishVoice,setReplies,setError}=workflow;
 const liveReady=configReady&&config.liveAvailable&&Boolean(activeStore);
 function confirmStore(next:Store){workflow.changeStore(next.storeId);setStore(next);setChoosingStore(false);}
 function changeStore(){workflow.changeStore(null);setChoosingStore(true);setCartOpen(false);}
 function selectProduct(identity:string,size:string|null){
  if(!activeStore){setError('Choose a store before ordering.');return false;}
  setError('');const added=commit([{type:'add-menu',identity,size}]);if(added&&mobile)setCartOpen(true);return added;
 }
 function startNewOrder(){workflow.newOrder(catalog.data?.version??defaultCatalogService.version);}
 function submit(value:string){if(workflow.submit(value))setText('');}
 useEffect(()=>{if(busy)setText('');},[busy]);
 useEffect(()=>{
  if(mobile||choosingStore)return;
  const rail=orderRail.current;if(!rail)return;let frame=0;
  const measure=()=>{frame=0;const height=Math.max(0,window.innerHeight-rail.getBoundingClientRect().top-20);rail.style.height=height+'px';};
  const schedule=()=>{if(!frame)frame=window.requestAnimationFrame(measure);};
  const observer=new ResizeObserver(schedule);const intro=document.querySelector('.menu-intro'),header=document.querySelector('header');
  if(intro)observer.observe(intro);if(header)observer.observe(header);
  measure();window.addEventListener('resize',schedule);window.addEventListener('scroll',schedule,{passive:true});
  return()=>{observer.disconnect();window.removeEventListener('resize',schedule);window.removeEventListener('scroll',schedule);window.cancelAnimationFrame(frame);rail.style.removeProperty('height');};
 },[mobile,choosingStore]);

 useEffect(()=>{
  const query=window.matchMedia('(max-width:720px)'),update=()=>setMobile(query.matches);query.addEventListener('change',update);
  return()=>query.removeEventListener('change',update);
 },[]);
 useEffect(()=>{
  const controller=new AbortController();let timedOut=false;
  setConfigReady(false);setConnectionError('');
  const timer=window.setTimeout(()=>{timedOut=true;controller.abort();setConfigReady(true);setConfig(current=>({...current,liveAvailable:false}));setConnectionError('The live ordering connection timed out. Retry connection.');setError(current=>current==='Connecting to live ordering…'?'':current);},8000);
  fetch('/api/config',{signal:controller.signal}).then(async response=>{
   if(!response.ok)throw new Error('Connection failed');const data=await response.json();if(controller.signal.aborted)return;
   if(typeof data.liveAvailable!=='boolean')throw new Error('Invalid connection response');
   setConfig({liveAvailable:data.liveAvailable,model:typeof data.model==='string'?data.model:'',provider:typeof data.provider==='string'?data.provider:'',pricingAvailable:pricingAvailable(data),cacheScope:typeof data.pricing?.cacheScope==='string'?data.pricing.cacheScope:null});
   if(!data.liveAvailable)setConnectionError('Live ordering is unavailable. Configure the server API key, then retry connection.');
  }).catch(()=>{if(!controller.signal.aborted)setConnectionError('Could not reach the live ordering service. Retry connection.');}).finally(()=>{
   window.clearTimeout(timer);if(!controller.signal.aborted){setConfigReady(true);setError(current=>current==='Connecting to live ordering…'?'':current);}
  });
  return()=>{window.clearTimeout(timer);if(!timedOut)controller.abort();};
 },[connectionAttempt]);
 useEffect(()=>{const pane=messagesPane.current;if(pane)pane.scrollTop=pane.scrollHeight;},[messages,busy]);

 const menuSelectRef=useRef(selectProduct);menuSelectRef.current=selectProduct;
 const stableMenuSelect=useCallback((identity:string,size:string|null)=>menuSelectRef.current(identity,size),[]);
 const menuView=useMemo(()=><MenuView catalog={catalog.data} menuDirectory={menuDirectory.data} onSelect={stableMenuSelect}/>,[catalog.data,menuDirectory.data,stableMenuSelect]);
 const pricing=useLiveQuote(order,configReady&&config.pricingAvailable,activeStore,config.cacheScope),quote=pricing.quote;
 function update(item:Drink,changes:Partial<Drink>,touched?:IngredientPath[]){setError('');commit([{type:'update',itemId:item.id,changes,...(touched?.length?{touched}:{})}]);}
 const count=[...order.items,...(order.menuItems??[])].reduce((n,item)=>n+item.quantity,0),source=menuDirectory.data?.provenance;
 const sourceStale=source?Date.now()-Date.parse(source.fetchedAt)>86400000:false;
 return <div className="page"><header><a className="brand" href="/" aria-label="barista home">barista<span className="brand-dot">.</span></a><span className="eyebrow">ORDER LAB</span><span className="simulation"><i/> Practice order · {quote.estimated?'demo prices':'live prices'}</span></header><main>
  {choosingStore?<StorePicker onConfirm={confirmStore} onCancel={store?()=>confirmStore(store):undefined}/>:<>
  <section className="intro menu-intro"><div><p className="eyebrow green">YOUR COFFEE. YOUR WAY.</p><h1>A good day <br/>starts <em>here.</em></h1></div>{store&&<section className="store-bar" aria-label="Selected store"><div><strong>{store.name}</strong><p>{storeAddress(store)}</p></div><button onClick={changeStore}>Change store</button></section>}</section>
  <div><div className="menu-workspace"><div className="order-rail" ref={orderRail}>
   <section className="conversation panel" aria-label="Order conversation"><div className="panel-top"><span className="eyebrow">JUST SAY IT</span><span className="status"><i data-connected={liveReady}/> {!configReady?'Connecting…':config.liveAvailable?'Live ordering':'Live unavailable'}</span></div><div className="messages" ref={messagesPane} role="log" aria-label="Order messages" aria-live="polite" aria-relevant="additions text">{messages.map((message,index)=><div key={index} className={'message '+message.role}><span className="speaker">{message.role==='assistant'?'barista':'You'}</span><p>{message.text}</p></div>)}{busy&&<div className="thinking" role="status"><span>Working on your order…</span> <button className="cancel-request" type="button" onClick={()=>{cancel();setError('Request cancelled. Your cart is unchanged.');}}>Cancel request</button></div>}</div><div className="composer"><VoicePreview transcript={interim} preparing={preparing} preview={preview}/><div className="live-connection" aria-label="Live ordering connection">{!configReady&&<p role="status">Connecting to live ordering…</p>}{connectionError&&<p className="error" role="alert">{connectionError}</p>}{!liveReady&&<button type="button" className="retry-connection" disabled={!configReady} onClick={()=>{cancel();setConfig(current=>({...current,liveAvailable:false}));setConfigReady(false);setError('');setConnectionAttempt(attempt=>attempt+1);}}>Retry connection</button>}</div>{pending&&<div className="clarification"><p>A quick question: {pending.question}</p><button type="button" onClick={cancelQuestion}>Cancel question</button></div>}<div className="examples">{examples.map(example=><button key={example} disabled={!liveReady} onClick={()=>submit(example)}>{example}<span>↗</span></button>)}</div><form onSubmit={e=>{e.preventDefault();submit(text);}}><label className="sr-only" htmlFor="order-input">Tell us your order</label><input id="order-input" enterKeyHint="send" maxLength={600} value={text} onChange={e=>setText(e.target.value)} placeholder="Tell us your order…" autoComplete="off"/><button type="button" className={'mic '+(listening?'listening':'')} aria-label={listening?'Stop microphone':'Start microphone'} aria-pressed={listening} disabled={!voiceSupported||!liveReady} onClick={()=>listening?finishVoice():startVoice()}><Icon kind="mic"/></button><button className="send" disabled={!text.trim()||!liveReady} aria-label="Send order"><Icon kind="arrow"/></button></form>{error&&<p className="error" role="alert">{error}</p>}<div className="voice-settings"><span>{listening?'Listening…':voiceSupported?'Browser speech service.':'Voice unavailable. Type to order.'}</span><label><input type="checkbox" checked={replies} onChange={e=>setReplies(e.target.checked)}/> Spoken replies</label></div></div></section>
   <OrderPanel storeLabel={store?storeAddress(store):'Choose a store'} menuDirectory={menuDirectory.data} order={order} quote={quote} pricingStatus={pricing.status} pricingLoading={pricing.loading} onRefreshPrices={pricing.refresh} change={change} mobile={mobile} open={cartOpen} onClose={()=>setCartOpen(false)} commit={commit} update={update}/>
   <div className="cart-version"><p>Your order keeps its original menu version.</p><details><summary>Order catalog details</summary><p>{order.catalogVersion||'legacy-sample-v1'}</p></details><button onClick={startNewOrder}>Start new order</button></div>
   {localTiming&&<details className="diagnostics" aria-label="Local voice timing"><summary>Local voice timing</summary><p>Monotonic milliseconds from microphone click. Next frame is an animation callback, not physical paint.</p><pre>{JSON.stringify(localTiming)}</pre></details>}
   {metrics&&<details className="diagnostics"><summary>Turn diagnostics</summary><p>{metrics.totalRequests} requests · {metrics.extractionRequests} extraction · {metrics.decisionRequests} decision · {metrics.strategy}</p><p>{Math.round(metrics.totalMs)} ms total · {metrics.clauseCount} clauses</p></details>}
  </div><div className="menu-column">
   {menuView}
   <div className="catalog-note">{source&&<><p>Catalog source: {source.source} · <time dateTime={source.fetchedAt}>{new Date(source.fetchedAt).toLocaleString()}</time>{sourceStale?' · Source data is over 24 hours old.':''}</p><p>Product photos show menu items. Store availability is not verified.</p><details className="source-details"><summary>Catalog details</summary><p>Menu version {menuDirectory.data?.version}</p></details></>}{(menuDirectory.isError||catalog.isError)&&menuDirectory.data&&<p>Refresh failed. Showing the last good menu.</p>}<p>Demo menu prices · live store quotes when available.</p><button onClick={()=>{menuDirectory.refetch();catalog.refetch();}} disabled={menuDirectory.isFetching||catalog.isFetching}>{menuDirectory.isFetching||catalog.isFetching?'Refreshing…':'Refresh menu'}</button></div>
  </div></div><button className="mobile-order-summary" onClick={()=>setCartOpen(true)} aria-haspopup="dialog" aria-expanded={cartOpen}>View order <span>{count} {(order.menuItems?.length??0)>0?(count===1?'item':'items'):(count===1?'drink':'drinks')} · {quote.subtotalCents===null?'Price unavailable':(quote.estimated?'Est. ':'')+formatMoney(quote.subtotalCents)}</span></button></div>
  </>}
  <footer><span>Made for the way you order.</span><span>Practice order. No payment or café order.</span></footer>
 </main></div>;
}
