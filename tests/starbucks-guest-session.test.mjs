import test from 'node:test';
import assert from 'node:assert/strict';
import {createStarbucksGuestSource, StarbucksGuestError} from '../src/adapters/starbucks-guest-session.mjs';
const ok=(cookies=['sid=test; Path=/'])=>new Response('{}',{headers:cookies.map(c=>['set-cookie',c])});
const code=c=>e=>e instanceof StarbucksGuestError && e.code===c;
test('HTTP transport status reports safe counts without guest credentials',async()=>{
 let time=0;const source=createStarbucksGuestSource({now:()=>time,fetchImpl:async url=>url.endsWith('/guest')?ok(['sid=secret; Path=/; Max-Age=1']):new Response('{}')});
 assert.equal(source.status().transport,'http');assert.equal(source.status().sessions,0);
 await source.quote('private-caller',{});assert.equal(source.status().ready,true);assert.equal(source.status().sessions,1);
 assert.doesNotMatch(JSON.stringify(source.status()),/secret|private-caller|sid=/);
 time=1001;assert.equal(source.status().ready,false);
});
test('closing HTTP transport aborts pending sessions and prevents new requests',async()=>{
 let started=0;const source=createStarbucksGuestSource({fetchImpl:async()=>{started++;return new Promise(()=>{});}});
 const pending=source.quote('caller',{});await new Promise(resolve=>setImmediate(resolve));await source.close();
 await assert.rejects(pending,code('ABORTED'));await assert.rejects(source.quote('another',{}),code('ABORTED'));
 assert.equal(started,1);assert.equal(source.status().sessions,0);
});
test('expired-cookie bootstrap waits for the earlier quote to finish',async()=>{
 let time=0,boots=0,quotes=0,release;const gate=new Promise(resolve=>{release=resolve;});
 const source=createStarbucksGuestSource({now:()=>time,fetchImpl:async url=>{
  if(url.endsWith('/guest')){boots++;return ok([`sid=${boots}; Path=/; Max-Age=1`]);}
  quotes++;if(quotes===1)await gate;return new Response('{}');
 }});
 const first=source.quote('caller',{cart:1});await new Promise(resolve=>setImmediate(resolve));time=2000;
 const second=source.quote('caller',{cart:2});
 try{await new Promise(resolve=>setImmediate(resolve));assert.equal(boots,1);}finally{release();}
 await Promise.all([first,second]);assert.equal(boots,2);
});
test('a cookie that expires in the quote queue is renewed before dispatch',async()=>{
 let time=0,boots=0,quotes=0,release;const gate=new Promise(resolve=>{release=resolve;});const sent=[];
 const source=createStarbucksGuestSource({now:()=>time,fetchImpl:async(url,init)=>{
  if(url.endsWith('/guest')){boots++;return ok([`sid=${boots}; Path=/; Max-Age=1`]);}
  quotes++;sent.push(init.headers.Cookie);if(quotes===1)await gate;return new Response('{}');
 }});
 const first=source.quote('caller',{cart:1}),second=source.quote('caller',{cart:2});
 await new Promise(resolve=>setImmediate(resolve));time=2000;release();await Promise.all([first,second]);
 assert.equal(boots,2);assert.deepEqual(sent,['sid=1','sid=2']);
});
test('different quotes share one bootstrap and serialize cookie updates within a caller',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;});let boots=0,quotes=0,active=0,peak=0;
 const sent=[];const source=createStarbucksGuestSource({fetchImpl:async(url,init)=>{
  if(url.endsWith('/guest')){boots++;return ok(['sid=initial; Path=/']);}
  quotes++;active++;peak=Math.max(peak,active);sent.push(init.headers.Cookie);
  if(quotes===1)await gate;active--;return new Response('{}',{headers:{'Set-Cookie':'sid=updated; Path=/'}});
 }});
 const first=source.quote('caller',{cart:1}),second=source.quote('caller',{cart:2});
 try{await new Promise(resolve=>setImmediate(resolve));assert.equal(quotes,1);assert.equal(peak,1);}finally{release();}
 await Promise.all([first,second]);assert.equal(boots,1);assert.deepEqual(sent,['sid=initial','sid=updated']);
});
test('a cancelled queued quote sends no request and does not release the following quote early',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;});let quotes=0;
 const source=createStarbucksGuestSource({fetchImpl:async url=>{if(url.endsWith('/guest'))return ok();quotes++;if(quotes===1)await gate;return new Response('{}');}});
 const first=source.quote('caller',{cart:1});await new Promise(resolve=>setImmediate(resolve));
 const controller=new AbortController();const cancelled=source.quote('caller',{cart:2},{signal:controller.signal});const third=source.quote('caller',{cart:3});controller.abort();
 try{await assert.rejects(cancelled,code('ABORTED'));assert.equal(quotes,1);}finally{release();}
 await Promise.all([first,third]);assert.equal(quotes,2);
});
test('a queued quote observes rate limiting without a second upstream call',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;});let quotes=0;
 const source=createStarbucksGuestSource({fetchImpl:async url=>{if(url.endsWith('/guest'))return ok();quotes++;await gate;return new Response(null,{status:429,headers:{'Retry-After':'60'}});}});
 const first=source.quote('caller',{cart:1}),second=source.quote('caller',{cart:2});
 const done=Promise.all([assert.rejects(first,code('RATE_LIMITED')),assert.rejects(second,code('RATE_LIMITED'))]);
 await new Promise(resolve=>setImmediate(resolve));release();await done;assert.equal(quotes,1);
});
test('reuses private cookies only within caller session and fixed endpoints',async()=>{
 const calls=[]; const source=createStarbucksGuestSource({fetchImpl:async(url,init)=>{calls.push({url,...init});return url.endsWith('/guest')?ok(['sid=private; Path=/; Secure; HttpOnly']):new Response('{"result":1}');}});
 assert.deepEqual(await source.quote('alice',{}),{result:1});await source.quote('alice',{});await source.quote('bob',{});
 assert.equal(calls.length,5);assert.equal(calls[1].headers.Cookie,'sid=private');assert.equal(calls[3].headers.Cookie,undefined);
 for(const c of calls){assert.ok(c.url.startsWith('https://www.starbucks.com/apiproxy/v1/'));assert.equal(c.redirect,'manual');}
});
test('expires idle sessions and bounds session capacity',async()=>{
 let time=0,boots=0;const source=createStarbucksGuestSource({now:()=>time,maxSessions:1,idleTtlMs:10,fetchImpl:async u=>{if(u.endsWith('/guest'))boots++;return ok();}});
 await source.quote('a',{});await assert.rejects(source.quote('b',{}),code('SESSION_LIMIT'));time=11;await source.quote('b',{});assert.equal(boots,2);
});
test('429 honors bounded cooldown without retry or leaking upstream content',async()=>{
 let calls=0,time=0;const source=createStarbucksGuestSource({now:()=>time,fetchImpl:async()=>{calls++;return new Response('secret cookies',{status:429,headers:{'Retry-After':'2','set-cookie':'sid=secret'}});}});
 await assert.rejects(source.quote('a',{}),e=>code('RATE_LIMITED')(e)&&e.retryAfterMs===2000&&!JSON.stringify(e).includes('secret'));
 await assert.rejects(source.quote('a',{}),code('RATE_LIMITED'));assert.equal(calls,1);time=2001;await assert.rejects(source.quote('a',{}),code('RATE_LIMITED'));assert.equal(calls,2);
});
test('shared bootstrap survives one waiter cancellation',async()=>{
 let finish,boots=0;const gate=new Promise(r=>finish=r);const source=createStarbucksGuestSource({fetchImpl:async u=>{if(u.endsWith('/guest')){boots++;await gate;}return ok();}});
 const controller=new AbortController();const a=source.quote('a',{}, {signal:controller.signal});const b=source.quote('a',{});controller.abort();await assert.rejects(a,code('ABORTED'));finish();await b;assert.equal(boots,1);
});
test('timeouts bound uncooperative fetch producers',async()=>{const s=createStarbucksGuestSource({timeoutMs:10,fetchImpl:()=>new Promise(()=>{})});await assert.rejects(s.quote('a',{}),code('TIMEOUT'));});
test('cookie scope, deletion and expiry are enforced',async()=>{
 let time=0;const headers=[];let n=0;const s=createStarbucksGuestSource({now:()=>time,fetchImpl:async(u,i)=>{if(u.endsWith('/guest'))return ok(['good=x; Domain=.starbucks.com; Path=/apiproxy; Max-Age=1; Secure','evil=x; Domain=evil.com','wrong=x; Path=/other','gone=x; Max-Age=0']);headers.push(i.headers.Cookie);n++;return ok([]);}});
 await s.quote('a',{});time=1001;await s.quote('a',{});assert.equal(headers[0],'good=x');assert.equal(headers[1],'good=x');
});
test('quote auth errors invalidate cookies and enforce cooldown',async()=>{
 let calls=0,time=0;const s=createStarbucksGuestSource({now:()=>time,backoffMs:20,fetchImpl:async u=>{calls++;return u.endsWith('/guest')?ok(['sid=x; Path=/']):new Response('secret',{status:403});}});
 await assert.rejects(s.quote('a',{}),code('UNAVAILABLE'));await assert.rejects(s.quote('a',{}),code('UNAVAILABLE'));assert.equal(calls,2);time=21;await assert.rejects(s.quote('a',{}),code('UNAVAILABLE'));assert.equal(calls,4);
});
test('rejects unsafe inputs and oversized or invalid envelopes',async()=>{
 let calls=0;const s=createStarbucksGuestSource({fetchImpl:async()=>{calls++;return ok();}});for(const key of ['',{},'x'.repeat(129),'a\n'])await assert.rejects(s.quote(key,{}),code('INVALID_REQUEST'));
 await assert.rejects(s.quote('a',{x:'x'.repeat(65536)}),code('INVALID_REQUEST'));assert.equal(calls,0);
 for(const body of ['invalid','[]','"secret"','x'.repeat(1048577)]){let n=0;const s=createStarbucksGuestSource({fetchImpl:async()=>++n===1?ok():new Response(body)});await assert.rejects(s.quote('a',{}),code('INVALID_RESPONSE'));}
});
test('failed bootstrap never retains error cookies and clear starts a new session',async()=>{
 let time=0,calls=0;const cookies=[];const s=createStarbucksGuestSource({now:()=>time,backoffMs:1,fetchImpl:async(u,i)=>{calls++;cookies.push(i.headers.Cookie);if(calls===1)return new Response('secret',{status:500,headers:{'set-cookie':'bad=secret; Path=/'}});return ok(['good=x; Path=/']);}});
 await assert.rejects(s.quote('a',{}),code('UNAVAILABLE'));time=2;await s.quote('a',{});assert.equal(cookies[1],undefined);assert.equal(cookies[2],'good=x');s.clear('a');await s.quote('a',{});assert.equal(cookies[3],undefined);
});
test('request rejects unbounded outgoing cookie header',async()=>{
 const cookieLines=Array.from({length:20},(_,i)=>`large${i}=${'x'.repeat(4000)}; Path=/`);let calls=0;
 const s=createStarbucksGuestSource({fetchImpl:async()=>{calls++;return ok(cookieLines);}});
 await assert.rejects(s.quote('a',{}),code('UNAVAILABLE'));assert.equal(calls,1);
});
test('aborted quote stops its producer deadline and sends no request after shared bootstrap',async()=>{
 let finish,calls=0;const gate=new Promise(r=>finish=r);const controller=new AbortController();
 const s=createStarbucksGuestSource({timeoutMs:30,fetchImpl:async(u,i)=>{calls++;if(u.endsWith('/guest')){await gate;return ok();}controller.abort();return new Promise(()=>{});}});
 const pending=s.quote('a',{}, {signal:controller.signal});finish();await assert.rejects(pending,code('ABORTED'));assert.equal(calls,2);
});
test('accepts empty bootstrap with cookies and sends verified quote header',async()=>{
 const s=createStarbucksGuestSource({fetchImpl:async(u,i)=>{if(u.endsWith('/guest'))return new Response(null,{headers:{'set-cookie':'sid=x; Path=/'}});assert.equal(i.headers['X-Requested-With'],'XMLHttpRequest');return new Response('{"priced":true}');}});
 assert.deepEqual(await s.quote('a',{}),{priced:true});
});
test('bootstrap without a quote-scoped cookie fails closed and cools down',async()=>{
 let calls=0;const s=createStarbucksGuestSource({fetchImpl:async()=>{calls++;return ok(['sid=x; Path=/wrong']);}});
 await assert.rejects(s.quote('a',{}),code('UNAVAILABLE'));await assert.rejects(s.quote('a',{}),code('UNAVAILABLE'));assert.equal(calls,1);
});
test('429 blocks new session keys and survives session clear',async()=>{
 let calls=0;const s=createStarbucksGuestSource({fetchImpl:async()=>{calls++;return new Response(null,{status:429});}});
 await assert.rejects(s.quote('a',{}),code('RATE_LIMITED'));s.clear('a');await assert.rejects(s.quote('b',{}),code('RATE_LIMITED'));assert.equal(calls,1);
});
test('network, invalid response and timeout failures cool down instead of repeating',async()=>{
 for(const kind of ['network','invalid','timeout']){let calls=0;const s=createStarbucksGuestSource({timeoutMs:5,fetchImpl:async u=>{calls++;if(kind==='network')throw Error('secret');if(kind==='timeout')return new Promise(()=>{});return u.endsWith('/guest')?ok(['sid=x; Path=/']):new Response('bad');}});const wanted={network:'UNAVAILABLE',invalid:'INVALID_RESPONSE',timeout:'TIMEOUT'}[kind];await assert.rejects(s.quote('a',{}),code(wanted));const before=calls;await assert.rejects(s.quote('a',{}),code(wanted));assert.equal(calls,before);}
});
test('clear orphans pending bootstrap and prevents old quote from starting',async()=>{
 let finish,calls=0;const gate=new Promise(r=>finish=r);const s=createStarbucksGuestSource({fetchImpl:async()=>{calls++;await gate;return ok(['sid=x; Path=/']);}});
 const pending=s.quote('a',{});await new Promise(resolve=>setImmediate(resolve));s.clear('a');finish();await assert.rejects(pending,code('ABORTED'));assert.equal(calls,1);
});
test('missing or whitespace Retry-After uses configured backoff',async()=>{
 for(const raw of [undefined,'','   ']){const headers=raw===undefined?{}:{'Retry-After':raw};const s=createStarbucksGuestSource({backoffMs:60000,fetchImpl:async()=>new Response(null,{status:429,headers})});await assert.rejects(s.quote('a',{}),e=>code('RATE_LIMITED')(e)&&e.retryAfterMs===60000);}
});
test('works in Worker runtimes that support manual but reject error redirect mode',async()=>{
 const s=createStarbucksGuestSource({fetchImpl:async(u,i)=>{if(i.redirect==='error')throw TypeError('Unsupported redirect option');return u.endsWith('/guest')?ok(['sid=x; Path=/']):new Response('{"priced":true}');}});
 assert.deepEqual(await s.quote('a',{}),{priced:true});
});
test('redirect response is never followed and its cookies never survive cooldown',async()=>{
 let calls=0,time=0;const cookies=[];const s=createStarbucksGuestSource({now:()=>time,backoffMs:10,fetchImpl:async(u,i)=>{calls++;cookies.push(i.headers.Cookie);if(calls===1)return new Response(null,{status:302,headers:{Location:'https://evil.example/steal','set-cookie':'redirect=secret; Path=/'}});assert.ok(u.startsWith('https://www.starbucks.com/'));return ok(['sid=x; Path=/']);}});
 await assert.rejects(s.quote('a',{}),code('UNAVAILABLE'));await assert.rejects(s.quote('a',{}),code('UNAVAILABLE'));assert.equal(calls,1);time=11;await s.quote('a',{});assert.equal(calls,3);assert.equal(cookies[1],undefined);assert.equal(cookies[2],'sid=x');
});
test('bootstrap sends the same verified API request header as quote',async()=>{
 const s=createStarbucksGuestSource({fetchImpl:async(u,i)=>{assert.equal(i.headers['X-Requested-With'],'XMLHttpRequest');return ok(['sid=x; Path=/']);}});
 await s.quote('a',{});
});
