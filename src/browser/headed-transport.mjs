import {setupGuestThroughUi} from './guest-ui-setup.mjs';
export async function createHeadedTransport({launch,timeoutMs=15000,now=Date.now,idleTtlMs=900000,maxSessions=4,setup=setupGuestThroughUi}={}){
 if(!Number.isInteger(maxSessions)||maxSessions<1||maxSessions>16||!Number.isInteger(idleTtlMs)||idleTtlMs<1)throw Error('Invalid browser session limits');
 if(!launch){const {chromium}=await import('playwright-core');launch=options=>chromium.launch(options);}
 const browser=await launch({channel:'chrome',headless:false});
 const sessions=new Map();let cooldownUntil=0;
 const destroy=async(key,state)=>{if(sessions.get(key)===state)sessions.delete(key);state.ready=false;await state.context.close();};
 const expire=async()=>{await Promise.all([...sessions].filter(([,s])=>!s.busy&&now()-s.lastUsed>=idleTtlMs).map(([key,s])=>destroy(key,s)));};
 const idleTimer=setInterval(()=>{void expire().catch(()=>{});},Math.min(idleTtlMs,30000));idleTimer.unref?.();
 const create=async key=>{
  if(sessions.size>=maxSessions)throw Error('unavailable');
  const state={context:null,page:null,ready:false,busy:true,lastUsed:now(),setupPending:true,documentStatus:null,guestStatus:null,setupFailure:null};sessions.set(key,state);
  try{
   state.context=await browser.newContext();if(sessions.get(key)!==state){await state.context.close();throw Error('unavailable');}state.page=await state.context.newPage();
   state.page.on('response',response=>{
    const guest=response.url()==='https://www.starbucks.com/apiproxy/v1/account/signin/guest';
    const status=response.status();
    if(guest&&status===200){state.ready=true;state.setupFailure=null;}
    // Keep numeric statuses only; never inspect provider bodies or challenge text.
    if(state.setupPending&&Number.isInteger(status)&&status>=100&&status<=599){
     if(guest)state.guestStatus=status;
     else if(state.documentStatus===null&&response.request?.().isNavigationRequest()&&response.frame()===state.page.mainFrame())state.documentStatus=status;
    }
   });
   state.page.on('close',()=>{state.ready=false;});
   await state.page.bringToFront();
   try{await setup(state.page);if(!state.ready&&state.page.waitForResponse)await state.page.waitForResponse(response=>response.url()==='https://www.starbucks.com/apiproxy/v1/account/signin/guest'&&response.status()===200,{timeout:2000});}catch{/* Ordinary UI failed; leave visible setup tab for operator. */}
   state.setupPending=false;
   if(!state.ready){const statuses=[state.documentStatus,state.guestStatus];state.setupFailure=statuses.includes(403)?'access_denied':statuses.includes(429)?'rate_limited':'setup_incomplete';}
   return state;
  }catch{if(state.context)await destroy(key,state);else sessions.delete(key);throw Error('unavailable');}
  finally{state.busy=false;}
 };
 return {
  status:()=>{
   const setupFailures={access_denied:0,rate_limited:0,setup_incomplete:0},setupHttpStatuses={document:{},guest:{}};
   for(const state of sessions.values()){
    if(!state.ready&&state.setupFailure)setupFailures[state.setupFailure]++;
    for(const [kind,status]of [['document',state.documentStatus],['guest',state.guestStatus]])if(status!==null)setupHttpStatuses[kind][status]=(setupHttpStatuses[kind][status]??0)+1;
   }
   return {ready:[...sessions.values()].some(s=>s.ready&&!s.page?.isClosed()),sessions:sessions.size,awaitingSetup:[...sessions.values()].filter(s=>!s.ready).length,sessionCapacity:maxSessions,busy:[...sessions.values()].some(s=>s.busy),cooldownMs:Math.max(0,cooldownUntil-now()),setupFailures,setupHttpStatuses,setup:'Each caller gets a fresh visible guest tab. Automatic ordinary UI setup was attempted. If awaiting setup, select a cafe, add a drink, and review the cart. Do not sign in.'};
  },
  async quote(sessionKey,body){
   if(now()<cooldownUntil)throw Object.assign(Error('unavailable'),{code:'RATE_LIMITED'});
   await expire();let state=sessions.get(sessionKey);
   if(state?.page?.isClosed()){await destroy(sessionKey,state);state=null;}
   if(!state)state=await create(sessionKey);
   if(state.busy)throw Error('unavailable');
   if(sessions.get(sessionKey)!==state)throw Error('unavailable');
   if(!state.ready){await state.page.bringToFront();throw Object.assign(Error('setup required'),{code:'SETUP_REQUIRED'});}
   if(state.page.isClosed()||new URL(state.page.url()).origin!=='https://www.starbucks.com')throw Error('unavailable');
   state.lastUsed=now();state.busy=true;
   try{
    const result=await state.page.evaluate(async({body,timeoutMs})=>{const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);try{const response=await fetch('/apiproxy/v1/orchestra/price-order-guest',{method:'POST',credentials:'same-origin',redirect:'error',headers:{Accept:'application/json','X-Requested-With':'XMLHttpRequest','Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});if(!response.ok)return {status:response.status,retryAfter:response.headers.get('retry-after')};const text=await response.text();if(text.length>1048576)throw Error('unavailable');return {status:response.status,envelope:JSON.parse(text)};}finally{clearTimeout(timer);}},{body,timeoutMs});
    if(result.status===429){const numeric=Number(result.retryAfter);const date=Date.parse(result.retryAfter);const delay=result.retryAfter&&Number.isFinite(numeric)?numeric*1000:Number.isFinite(date)?date-now():60000;cooldownUntil=now()+Math.min(3600000,Math.max(60000,delay));throw Object.assign(Error('unavailable'),{code:'RATE_LIMITED'});}
    if(result.status===401||result.status===403)state.ready=false;
    if(result.status!==200||sessions.get(sessionKey)!==state)throw Error('unavailable');return result.envelope;
   }finally{state.busy=false;state.lastUsed=now();}
  },
  async clear(sessionKey){const state=sessions.get(sessionKey);if(state){if(state.context)await destroy(sessionKey,state);else sessions.delete(sessionKey);}},
  async close(){clearInterval(idleTimer);await Promise.all([...sessions].filter(([,s])=>s.context).map(([key,s])=>destroy(key,s)));await browser.close();}
 };
}
