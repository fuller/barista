import test from 'node:test';
import assert from 'node:assert/strict';
import {createStarbucksBrowserSource,browserPricingConfigured} from '../src/adapters/starbucks-browser-source.mjs';
const token='test-browser-token-'.repeat(3);
test('store lookup uses only the authenticated fixed route and bounded query',async()=>{
 let sent,calls=0;const stores=[{store:{id:'8527800'}}];
 const source=createStarbucksBrowserSource({url:'https://service.example',token,fetchImpl:async(url,init)=>{calls++;sent={url,...init};return Response.json(stores);}});
 assert.deepEqual(await source.searchStores('11201'),stores);
 assert.equal(sent.url,'https://service.example/stores');assert.deepEqual(JSON.parse(sent.body),{query:'11201'});assert.equal(sent.headers.Authorization,`Bearer ${token}`);
 for(const q of ['', 'x'.repeat(121), 'bad\nquery'])await assert.rejects(source.searchStores(q));
 assert.equal(calls,1);
});
test('only HTTPS or loopback HTTP service origins are accepted',()=>{
 for(const url of ['http://evil.example','https://u:p@service.example','https://service.example/arbitrary','https://service.example?token=x'])assert.throws(()=>createStarbucksBrowserSource({url,token}));
 assert.equal(browserPricingConfigured({STARBUCKS_BROWSER_URL:'http://127.0.0.1:4174',BARISTA_BROWSER_TOKEN:token}),true);
 assert.equal(browserPricingConfigured({STARBUCKS_BROWSER_URL:'https://service.example',BARISTA_BROWSER_TOKEN:'short'}),false);
});
test('fixed quote route carries private credentials only server to service',async()=>{
 let sent;const source=createStarbucksBrowserSource({url:'http://127.0.0.1:4174',token,fetchImpl:async(url,init)=>{sent={url,...init};return Response.json({data:{priceOrder:{__typename:'PricedOrderV2'}}});}});
 const result=await source.quote('private-session',{variables:{}},{selectedStore:{storeId:'s',selectionToken:'private-selection'}});
 assert.equal(sent.url,'http://127.0.0.1:4174/quote');assert.equal(sent.headers.Authorization,`Bearer ${token}`);assert.equal(sent.redirect,'manual');
 assert.deepEqual(JSON.parse(sent.body),{sessionKey:'private-session',body:{variables:{}},selectedStore:{storeId:'s'}});assert.equal(result.data.priceOrder.__typename,'PricedOrderV2');
});
test('remote errors and redirects stay sanitized and rate limits retain safe metadata',async()=>{
 for(const status of [302,401,403,500]){
  const source=createStarbucksBrowserSource({url:'https://service.example',token,fetchImpl:async()=>new Response('secret provider response',{status})});
  await assert.rejects(source.quote('session',{}),error=>error.code==='UNAVAILABLE'&&!error.message.includes('secret'));
 }
 const source=createStarbucksBrowserSource({url:'https://service.example',token,fetchImpl:async()=>new Response('secret',{status:429,headers:{'Retry-After':'60'}})});
 await assert.rejects(source.quote('session',{}),error=>error.code==='RATE_LIMITED'&&error.retryAfterMs===60000);
});
test('oversized, malformed and aborted quotes never escape the transport',async()=>{
 for(const response of [()=>Response.json({payload:'x'.repeat(270000)}),()=>new Response('{',{headers:{'Content-Type':'application/json'}}),()=>new Response('html')]){
  const source=createStarbucksBrowserSource({url:'https://service.example',token,fetchImpl:async()=>response()});await assert.rejects(source.quote('session',{}),error=>error.code==='UNAVAILABLE');
 }
 const controller=new AbortController();controller.abort();let called=false;
 const source=createStarbucksBrowserSource({url:'https://service.example',token,fetchImpl:async()=>{called=true;}});await assert.rejects(source.quote('session',{}, {signal:controller.signal}));assert.equal(called,false);
});
test('browser lookup normalizes coordinates and rejects unbounded or extra fields',async()=>{let calls=0;const source=createStarbucksBrowserSource({url:'https://service.example',token,fetchImpl:async(url,init)=>{calls++;assert.deepEqual(JSON.parse(init.body),{query:{latitude:0,longitude:-73.9869}});return Response.json([]);}});await source.searchStores({latitude:0,longitude:-73.986861});for(const query of [{latitude:91,longitude:0},{latitude:0,longitude:Infinity},{latitude:'0',longitude:0},{latitude:0,longitude:0,url:'https://bad.example'},null,[]])await assert.rejects(source.searchStores(query));assert.equal(calls,1);});
