const ORIGIN = 'https://www.starbucks.com';
const BOOTSTRAP = '/apiproxy/v1/account/signin/guest';
const QUOTE = '/apiproxy/v1/orchestra/price-order-guest';
export class StarbucksGuestError extends Error {
  constructor(code, status = 503, retryAfterMs) {
    super(code); this.name = 'StarbucksGuestError'; this.code = code; this.status = status;
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs;
  }
}
const fail = (code, status, retry) => new StarbucksGuestError(code, status, retry);
function waitFor(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) { promise.catch(() => {}); return Promise.reject(fail('ABORTED', 499)); }
  return new Promise((resolve, reject) => {
    const abort = () => reject(fail('ABORTED', 499));
    signal.addEventListener('abort', abort, {once:true});
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
export function createStarbucksGuestSource({fetchImpl = fetch, now = Date.now, timeoutMs = 8000, maxSessions = 128, idleTtlMs = 900000, backoffMs = 60000} = {}) {
  for (const value of [timeoutMs,maxSessions,idleTtlMs,backoffMs]) if (!Number.isSafeInteger(value) || value <= 0) throw fail('INVALID_REQUEST',400);
  const sessions = new Map();
  let rateLimitedUntil = 0, closed = false;
  function cooldown(state, code, status, delay) {
    state.until = now() + delay; state.error = {code,status};
    return fail(code,status,delay);
  }
  function acceptCookies(state, response, path) {
    const values = response.headers.getSetCookie?.() ?? [];
    for (const line of values) {
      if (line.length > 4096) continue;
      const [pair,...parts] = line.split(';'); const split = pair.indexOf('=');
      if (split < 1) continue;
      const name = pair.slice(0,split).trim(), value = pair.slice(split+1).trim();
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[^\x21-\x3a\x3c-\x7e]/.test(value)) continue;
      const attrs = new Map(parts.map(p=>{const i=p.indexOf('=');return [p.slice(0,i<0?undefined:i).trim().toLowerCase(),i<0?'':p.slice(i+1).trim()];}));
      const domain = (attrs.get('domain') || 'www.starbucks.com').toLowerCase().replace(/^\./,'');
      if (!['starbucks.com','www.starbucks.com'].includes(domain)) continue;
      const cookiePath = attrs.get('path')?.startsWith('/') ? attrs.get('path') : path.slice(0,path.lastIndexOf('/'));
      let expires = Infinity;
      if (attrs.has('expires')) {const parsed=Date.parse(attrs.get('expires'));if(Number.isFinite(parsed))expires=parsed;}
      if (/^-?\d+$/.test(attrs.get('max-age') ?? '')) expires=now()+Number(attrs.get('max-age'))*1000;
      const key = `${domain}|${cookiePath}|${name}`;
      if (expires <= now()) {state.cookies.delete(key);continue;}
      if (state.cookies.size >= 128 && !state.cookies.has(key)) continue;
      state.cookies.set(key,{name,value,path:cookiePath,expires});
    }
  }
  function cookieHeader(state,path) {
    const matching=[];
    for (const [key,c] of state.cookies) {
      if(c.expires<=now()){state.cookies.delete(key);continue;}
      if(path===c.path || (path.startsWith(c.path) && (c.path.endsWith('/') || path[c.path.length]==='/'))) matching.push(c);
    }
    return matching.sort((a,b)=>b.path.length-a.path.length).map(c=>`${c.name}=${c.value}`).join('; ');
  }
  async function request(state,path,body,signal) {
    if (signal?.aborted || state.controller.signal.aborted) throw fail('ABORTED',499);
    const controller = new AbortController(); let timer, rejectAbort;
    const cancelled = new Promise((_,reject) => { rejectAbort = reject; });
    const abort = () => { controller.abort(); rejectAbort(fail('ABORTED',499)); };
    signal?.addEventListener('abort',abort,{once:true});
    state.controller.signal.addEventListener('abort',abort,{once:true});
    const work = (async()=>{
      try {
        if (rateLimitedUntil > now()) throw fail('RATE_LIMITED',429,rateLimitedUntil-now());
        const headers = {'Content-Type':'application/json',Accept:'application/json'};
        headers['X-Requested-With']='XMLHttpRequest';
        const cookie = cookieHeader(state,path);
        if (cookie.length > 16384) throw fail('UNAVAILABLE',503);
        if(cookie) headers.Cookie=cookie;
        const response = await fetchImpl(ORIGIN+path,{method:'POST',headers,body,redirect:'manual',signal:controller.signal});
        if (controller.signal.aborted) {void response.body?.cancel().catch(()=>{});throw fail('ABORTED',499);}
        if (!response.ok) {

          void response.body?.cancel().catch(()=>{});
          if(response.status===429){
            const raw=response.headers.get('retry-after');const seconds=typeof raw==='string' && raw.trim()!==''?Number(raw):NaN;
            const delay=Number.isFinite(seconds)?seconds*1000:Date.parse(raw)-now();
            const boundedDelay = Math.min(3600000,Math.max(1000,Number.isFinite(delay)?delay:backoffMs));
            rateLimitedUntil = Math.max(rateLimitedUntil,now()+boundedDelay);
            throw cooldown(state,'RATE_LIMITED',429,boundedDelay);
          }
          if(path===QUOTE && [401,403].includes(response.status)){state.ready=false;state.cookies.clear();}
          throw cooldown(state,'UNAVAILABLE',503,backoffMs);
        }
        if (path === BOOTSTRAP) {
          void response.body?.cancel().catch(()=>{});
          acceptCookies(state,response,path);
          const cookies = cookieHeader(state,QUOTE);
          if (!cookies || cookies.length > 16384) {state.cookies.clear();throw fail('UNAVAILABLE',503);}
          return;
        }
        if(Number(response.headers.get('content-length'))>1048576) {void response.body?.cancel().catch(()=>{});throw fail('INVALID_RESPONSE',502);}
        const reader=response.body?.getReader();let size=0;const chunks=[];
        if(reader)try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1048576){void reader.cancel().catch(()=>{});throw fail('INVALID_RESPONSE',502);}chunks.push(value);}}finally{reader.releaseLock();}
        const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
        let parsed;try{parsed=JSON.parse(new TextDecoder().decode(bytes));}catch{throw fail('INVALID_RESPONSE',502);}
        if(!parsed || typeof parsed!=='object' || Array.isArray(parsed))throw fail('INVALID_RESPONSE',502);
        if(controller.signal.aborted)throw fail('TIMEOUT',504);
        acceptCookies(state,response,path);return parsed;
      } catch(error) {if(error instanceof StarbucksGuestError)throw error;throw fail('UNAVAILABLE',503);}
    })();
    const timeout = new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(fail('TIMEOUT',504));},timeoutMs);});
    return Promise.race([work,timeout,cancelled]).catch(error=>{
      if (error.code !== 'ABORTED' && state.until <= now()) throw cooldown(state,error.code,error.status,backoffMs);
      throw error;
    }).finally(()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);state.controller.signal.removeEventListener('abort',abort);});
  }
  async function ensureGuest(state,signal){
    if(state.ready&&cookieHeader(state,QUOTE))return;
    if(!state.bootstrap)state.bootstrap=request(state,BOOTSTRAP,JSON.stringify({market:'US'})).then(()=>{if(state.controller.signal.aborted)throw fail('ABORTED',499);state.ready=true;}).finally(()=>{state.bootstrap=null;});
    await waitFor(state.bootstrap,signal);
  }
  return {
    status(){
      const states=[...sessions.values()];
      const readySessions=states.filter(state=>state.ready&&cookieHeader(state,QUOTE)).length;
      return {transport:'http',ready:readySessions>0,sessions:sessions.size,awaitingSetup:states.length-readySessions,sessionCapacity:maxSessions,busy:states.some(state=>state.active>0),cooldownMs:Math.max(0,rateLimitedUntil-now())};
    },
    async close(){
      closed=true;
      for(const state of sessions.values()){state.controller.abort();state.cookies.clear();state.ready=false;}
      sessions.clear();
    },
    async quote(sessionKey,body,{signal}={}) {
      if(closed)throw fail('ABORTED',499);
      if(typeof sessionKey!=='string'|| !/^[\x21-\x7e]{1,128}$/.test(sessionKey))throw fail('INVALID_REQUEST',400);
      let encoded;try{if(!body || typeof body!=='object'||Array.isArray(body))throw Error();encoded=JSON.stringify(body);if(new TextEncoder().encode(encoded).length>65536)throw Error();}catch{throw fail('INVALID_REQUEST',400);}
      if(signal?.aborted)throw fail('ABORTED',499);
      if(rateLimitedUntil>now())throw fail('RATE_LIMITED',429,rateLimitedUntil-now());
      for(const [key,s] of sessions)if(!s.bootstrap && !s.active && now()-s.used>=idleTtlMs && now()>=s.until)sessions.delete(key);
      let state=sessions.get(sessionKey);
      if(!state){if(sessions.size>=maxSessions)throw fail('SESSION_LIMIT',503);state={cookies:new Map(),ready:false,used:now(),until:0,active:0,controller:new AbortController()};sessions.set(sessionKey,state);}
      state.used=now();
      if(state.until>now())throw fail(state.error.code,state.error.status,state.until-now());
      state.active++;
      try {
        if(state.controller.signal.aborted)throw fail('ABORTED',499);

        const pending=(state.quotes??Promise.resolve()).then(async()=>{
          if(signal?.aborted||state.controller.signal.aborted)throw fail('ABORTED',499);
          if(state.until>now())throw fail(state.error.code,state.error.status,state.until-now());
          await ensureGuest(state,signal);
          return request(state,QUOTE,encoded,signal);
        });
        state.quotes=pending.then(()=>undefined,()=>undefined);
        return await waitFor(pending,signal);
      } finally {state.active--;state.used=now();}
    },
    clear(sessionKey){const state=sessions.get(sessionKey);if(state){state.controller.abort();state.cookies.clear();state.ready=false;}sessions.delete(sessionKey);}
  };
}
