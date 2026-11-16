import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import type {Command,DecisionMetrics,Drink,IngredientPath,Order,PendingClarification,Quote,Size,Temperature,TurnResponse} from '../contracts';
import {createOrder,applyCommands} from '../domain/order.mjs';
import {quoteOrder,formatMoney} from '../domain/pricing.mjs';
import {createTurnGate} from '../application/turns.mjs';
import {createVoiceInput,createVoiceOutput} from '../adapters/voice';
import type {VoiceInput} from '../adapters/voice';
import {createLocalTurnTiming} from './local-turn-timing';
import type {LocalTurnTiming} from './local-turn-timing';
import {MenuView} from './MenuView';
import {OrderPanel} from './OrderPanel';
import type {CommittedChange} from './OrderPanel';
import {diffOrder} from './order-diff.mjs';
import {useCatalog,useMenuDirectory} from './catalog-query';
import {defaultCatalogService} from '../catalog/service.mjs';
type Message={role:'assistant'|'user';text:string};
const examples=['A grande iced vanilla latte','Make that oat milk','Add another shot'];
function Icon({kind}:{kind:'mic'|'arrow'}){return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">{kind==='mic'?<><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M6 10v2a6 6 0 0012 0v-2M12 18v4m-4 0h8"/></>:<path d="M5 12h14m-6-6 6 6-6 6"/>}</svg>}
export default function App(){
 const catalog=useCatalog(),menuDirectory=useMenuDirectory();
 const [order,setOrder]=useState<Order>(()=>createOrder(defaultCatalogService.version)),latest=useRef(order);
 const [change,setChange]=useState<CommittedChange|null>(null);
 const [cartOpen,setCartOpen]=useState(false),[mobile,setMobile]=useState(()=>window.matchMedia('(max-width:720px)').matches);
 const messagesPane=useRef<HTMLDivElement|null>(null);
 const [messages,setMessages]=useState<Message[]>([{role:'assistant',text:'Pick a favorite, or tell me what sounds good.'}]);
 const [pending,setPending]=useState<PendingClarification|null>(null),pendingRef=useRef(pending);
 const [text,setText]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[listening,setListening]=useState(false),[voiceSupported,setVoiceSupported]=useState(false);
 const [replies,setReplies]=useState(true),repliesRef=useRef(replies);repliesRef.current=replies;
 const [configReady,setConfigReady]=useState(false);
 const [connectionAttempt,setConnectionAttempt]=useState(0),[connectionError,setConnectionError]=useState('');
 const [config,setConfig]=useState({liveAvailable:false,model:'',provider:''});
 const liveReady=configReady&&config.liveAvailable;
 const [metrics,setMetrics]=useState<DecisionMetrics|null>(null);
 const gate=useRef(createTurnGate());
 const timing=useRef(createLocalTurnTiming()),voiceRevision=useRef<number|null>(null),pendingFrame=useRef<{id:string;revision:number}|null>(null);
 const [localTiming,setLocalTiming]=useState<LocalTurnTiming|null>(null);
 const active=useRef<{id:string;revision:number;controller:AbortController}|null>(null),voice=useRef<VoiceInput|null>(null),output=useRef<ReturnType<typeof createVoiceOutput>|null>(null),submitRef=useRef<(value:string,spoken?:boolean)=>void>(()=>{});
 function cancel(preserveTiming=false){if(!preserveTiming){timing.current.cancel();pendingFrame.current=null;setLocalTiming(null);}voiceRevision.current=null;voice.current?.stop();output.current?.stop();gate.current.cancel();if(active.current){active.current.controller.abort();active.current=null;setBusy(false);setError('Order changed. Previous request cancelled.');}}
 function acceptOrder(next:Order){const before=latest.current;latest.current=next;setChange({before,after:next,diff:diffOrder(before,next)});setOrder(next);}
 function commit(commands:Command[],base=latest.current){try{const next=applyCommands(base,commands) as Order;cancel();acceptOrder(next);pendingRef.current=null;setPending(null);return true;}catch(e){setError(e instanceof Error?e.message:'Could not update the order.');return false;}}
 function selectProduct(identity:string,size:string|null){
  setError('');if(commit([{type:'add-menu',identity,size}])&&mobile)setCartOpen(true);
 }
 function startNewOrder(){try{const next=createOrder(catalog.data?.version??defaultCatalogService.version) as Order;cancel();acceptOrder(next);pendingRef.current=null;setPending(null);setError('');setMetrics(null);}catch(e){setError(e instanceof Error?e.message:'Could not start a new order. Your order has not changed.');}}
 async function submit(value:string,spoken=false){
  value=value.trim();if(!value)return;if(!configReady){setError('Connecting to live ordering…');return;}if(!config.liveAvailable){setError(connectionError||'Live ordering is unavailable. Configure the server API key, then retry connection.');return;}if(value.length>600){setError('Keep your order to 600 characters or fewer.');return;}
  if(spoken&&voiceRevision.current!==latest.current.revision){timing.current.cancel();return;}
  cancel(spoken);setError('');setText('');setMessages(m=>[...m,{role:'user',text:value}]);const snapshot=latest.current,id=crypto.randomUUID(),controller=new AbortController();active.current={id,revision:snapshot.revision,controller};gate.current.begin(id,snapshot.revision);setBusy(true);if(spoken){timing.current.bind(id,snapshot.revision);timing.current.mark('submit',id);}
  try{
   timing.current.mark('fetchStart',id);
   const response=await fetch('/api/turn',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({turnId:id,baseRevision:snapshot.revision,text:value,order:snapshot,pending:pendingRef.current?.revision===snapshot.revision?pendingRef.current:null})});
   timing.current.mark('fetchHeaders',id);
   const data=await response.json() as TurnResponse&{error?:string};timing.current.mark('responseParsed',id);if(!response.ok||data.error)throw new Error(data.error||'Request failed. Please try again.');
   if(active.current?.id!==id||latest.current.revision!==snapshot.revision)return;
   if(data.turnId!==id||data.baseRevision!==snapshot.revision)throw new Error('Response did not match this order. Please try again.');
   if(!gate.current.accept(data.turnId,latest.current.revision))return;
   const next=data.commands.length?applyCommands(latest.current,data.commands) as Order:latest.current;
   timing.current.mark('commandsApplied',id);
   if(data.commands.length){pendingFrame.current={id,revision:next.revision};acceptOrder(next);}else timing.current.cancel();
   const nextPending=data.pending&&data.pending.revision===next.revision?data.pending:null;pendingRef.current=nextPending;setPending(nextPending);setMetrics(data.metrics??null);
   const answer=data.clarification||(next.confirmed?'Order confirmed. Your simulated receipt is ready.':data.commands.length?'Got it. Your order is updated.':'Tell me what you’d like to order.');setMessages(m=>[...m,{role:'assistant',text:answer}]);if(spoken&&repliesRef.current)output.current?.speak(answer);
  }catch(e){if(active.current?.id===id){timing.current.cancel();pendingFrame.current=null;}if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Could not reach the order service.');}
  finally{if(active.current?.id===id){active.current=null;setBusy(false);}}
 }
 submitRef.current=submit;
 useLayoutEffect(()=>{
  const frame=pendingFrame.current;if(!frame||frame.revision!==order.revision)return;
  timing.current.mark('layoutCommit',frame.id);
  const handle=requestAnimationFrame(()=>{if(pendingFrame.current!==frame||latest.current.revision!==frame.revision)return;timing.current.mark('nextFrame',frame.id);const sample=timing.current.complete(frame.id,frame.revision);pendingFrame.current=null;if(sample)setLocalTiming(sample);});
  return()=>cancelAnimationFrame(handle);
 },[order]);
 useEffect(()=>{
  const query=window.matchMedia('(max-width:720px)'),update=()=>setMobile(query.matches);query.addEventListener('change',update);
  output.current=createVoiceOutput();voice.current=createVoiceInput({onTranscript:value=>submitRef.current(value,true),onState:setListening,onError:message=>{timing.current.cancel();voiceRevision.current=null;setError(message);},onTiming:event=>timing.current.mark(event)});setVoiceSupported(voice.current.supported);
  return()=>{query.removeEventListener('change',update);gate.current.cancel();active.current?.controller.abort();voice.current?.dispose();timing.current.cancel();pendingFrame.current=null;output.current?.stop();};
 },[]);
 useEffect(()=>{
  const controller=new AbortController();let timedOut=false;
  setConfigReady(false);setConnectionError('');
  const timer=window.setTimeout(()=>{timedOut=true;controller.abort();setConfigReady(true);setConfig(current=>({...current,liveAvailable:false}));setConnectionError('The live ordering connection timed out. Retry connection.');setError(current=>current==='Connecting to live ordering…'?'':current);},8000);
  fetch('/api/config',{signal:controller.signal}).then(async response=>{
   if(!response.ok)throw new Error('Connection failed');const data=await response.json();if(controller.signal.aborted)return;
   if(typeof data.liveAvailable!=='boolean')throw new Error('Invalid connection response');
   setConfig({liveAvailable:data.liveAvailable,model:typeof data.model==='string'?data.model:'',provider:typeof data.provider==='string'?data.provider:''});
   if(!data.liveAvailable)setConnectionError('Live ordering is unavailable. Configure the server API key, then retry connection.');
  }).catch(()=>{if(!controller.signal.aborted)setConnectionError('Could not reach the live ordering service. Retry connection.');}).finally(()=>{
   window.clearTimeout(timer);if(!controller.signal.aborted){setConfigReady(true);setError(current=>current==='Connecting to live ordering…'?'':current);}
  });
  return()=>{window.clearTimeout(timer);if(!timedOut)controller.abort();};
 },[connectionAttempt]);
 function cancelQuestion(){cancel();pendingRef.current=null;setPending(null);setError('');setMessages(current=>[...current,{role:'assistant',text:'Cancelled. What would you like next?'}]);}
 useEffect(()=>{const pane=messagesPane.current;if(pane)pane.scrollTop=pane.scrollHeight;},[messages,busy]);
 // Stable subtree identity skips hundreds of cards on voice/busy renders; ref delegates to current cart/mobile state.
 const menuSelectRef=useRef(selectProduct);menuSelectRef.current=selectProduct;
 const stableMenuSelect=useCallback((identity:string,size:string|null)=>menuSelectRef.current(identity,size),[]);
 const menuView=useMemo(()=><MenuView catalog={catalog.data} menuDirectory={menuDirectory.data} onSelect={stableMenuSelect}/>,[catalog.data,menuDirectory.data,stableMenuSelect]);
 const quote=useMemo(()=>quoteOrder(order) as Quote,[order]);
 function update(item:Drink,changes:Partial<Drink>,touched?:IngredientPath[]){setError('');commit([{type:'update',itemId:item.id,changes,...(touched?.length?{touched}:{})}]);}
 const count=[...order.items,...(order.menuItems??[])].reduce((n,item)=>n+item.quantity,0),source=menuDirectory.data?.provenance;
 const sourceStale=source?Date.now()-Date.parse(source.fetchedAt)>86400000:false;
 return <div className="page"><header><a className="brand" href="/" aria-label="barista home">barista<span className="brand-dot">.</span></a><span className="eyebrow">ORDER LAB</span><span className="simulation"><i/> Simulator · sample pricing</span></header><main>
  <section className="intro menu-intro"><div><p className="eyebrow green">YOUR COFFEE. YOUR WAY.</p><h1>A good day <br/>starts <em>here.</em></h1></div><p className="intro-note">Find your favorite. Fine-tune the details.<br/>Or just say what’s on your mind.</p></section>
  <div><div className="menu-workspace"><div className="menu-column">
   {menuView}
   <div className="catalog-note">{source&&<><p>Catalog source: {source.source} · <time dateTime={source.fetchedAt}>{new Date(source.fetchedAt).toLocaleString()}</time>{sourceStale?' · Source data is over 24 hours old.':''}</p><p>Product photos show menu items. Store availability is not verified.</p><details className="source-details"><summary>Catalog details</summary><p>Menu version {menuDirectory.data?.version}</p></details></>}{(menuDirectory.isError||catalog.isError)&&menuDirectory.data&&<p>Refresh failed. Showing the last good menu.</p>}<p>Prices are illustrative sample USD amounts for 11201. Tax is not calculated.</p><button onClick={()=>{menuDirectory.refetch();catalog.refetch();}} disabled={menuDirectory.isFetching||catalog.isFetching}>{menuDirectory.isFetching||catalog.isFetching?'Refreshing…':'Refresh menu'}</button></div>
  </div><div className="right-rail">
   <OrderPanel menuDirectory={menuDirectory.data} order={order} quote={quote} change={change} mobile={mobile} open={cartOpen} onClose={()=>setCartOpen(false)} commit={commit} update={update}/>
   <section className="conversation panel" aria-label="Order conversation"><div className="panel-top"><span className="eyebrow">JUST SAY IT</span><span className="status"><i/> {!configReady?'Connecting…':config.liveAvailable?'Live ordering':'Live unavailable'}</span></div><div className="messages" ref={messagesPane} aria-live="polite">{messages.map((message,index)=><div key={index} className={'message '+message.role}><span className="speaker">{message.role==='assistant'?'barista':'You'}</span><p>{message.text}</p></div>)}{busy&&<p className="thinking" role="status">Working on your order…</p>}</div><div className="composer"><div className="live-connection" aria-label="Live ordering connection">{!configReady&&<p role="status">Connecting to live ordering…</p>}{connectionError&&<p className="error" role="alert">{connectionError}</p>}<button type="button" disabled={!configReady} onClick={()=>{cancel();setConfig(current=>({...current,liveAvailable:false}));setConfigReady(false);setError('');setConnectionAttempt(attempt=>attempt+1);}}>Retry connection</button></div>{pending&&<div className="clarification"><p>A quick question: {pending.question}</p><button type="button" onClick={cancelQuestion}>Cancel question</button></div>}<div className="examples">{examples.map(example=><button key={example} disabled={!liveReady} onClick={()=>submit(example)}>{example}<span>↗</span></button>)}</div><form onSubmit={e=>{e.preventDefault();submit(text);}}><label className="sr-only" htmlFor="order-input">Tell us your order</label><input id="order-input" maxLength={600} value={text} onChange={e=>setText(e.target.value)} placeholder="Tell us your order…" autoComplete="off"/><button type="button" className={'mic '+(listening?'listening':'')} aria-label={listening?'Stop microphone':'Start microphone'} aria-pressed={listening} disabled={!voiceSupported||!liveReady} onClick={()=>{output.current?.stop();if(listening)voice.current?.finish();else {cancel();setError('');timing.current.begin(latest.current.revision);voiceRevision.current=latest.current.revision;setLocalTiming(null);voice.current?.start();}}}><Icon kind="mic"/></button><button className="send" disabled={!text.trim()||!liveReady} aria-label="Send order"><Icon kind="arrow"/></button></form>{error&&<p className="error" role="alert">{error}</p>}<div className="voice-settings"><span>{listening?'Listening…':voiceSupported?'Browser speech service.':'Voice unavailable. Type to order.'}</span><label><input type="checkbox" checked={replies} onChange={e=>{setReplies(e.target.checked);if(!e.target.checked)output.current?.stop();}}/> Spoken replies</label></div></div></section>
   <div className="cart-version"><p>Your order keeps its original menu version.</p><details><summary>Order catalog details</summary><p>{order.catalogVersion||'legacy-sample-v1'}</p></details><button onClick={startNewOrder}>Start new order</button></div>
   {localTiming&&<details className="diagnostics" aria-label="Local voice timing"><summary>Local voice timing</summary><p>Monotonic milliseconds from microphone click. Next frame is an animation callback, not physical paint.</p><pre>{JSON.stringify(localTiming)}</pre></details>}
   {metrics&&<details className="diagnostics"><summary>Turn diagnostics</summary><p>{metrics.totalRequests} requests · {metrics.extractionRequests} extraction · {metrics.decisionRequests} decision · {metrics.strategy}</p><p>{Math.round(metrics.totalMs)} ms total · {metrics.clauseCount} clauses</p></details>}
  </div></div><button className="mobile-order-summary" onClick={()=>setCartOpen(true)} aria-haspopup="dialog" aria-expanded={cartOpen}>View order <span>{count} {(order.menuItems?.length??0)>0?(count===1?'item':'items'):(count===1?'drink':'drinks')} · {quote.subtotalCents===null?'Price unavailable':formatMoney(quote.subtotalCents)}</span></button></div>
  <footer><span>Made for the way you order.</span><span>Practice order. No payment or café order.</span></footer>
 </main></div>;
}
