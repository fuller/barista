import test from 'node:test';
import assert from 'node:assert/strict';
import {QueryClient,isCancelledError} from '@tanstack/react-query';
import {catalogQueryOptions,fetchCatalog} from '../src/ui/catalog-cache.mjs';
import {defaultCatalogService,hasCatalogVersion} from '../src/catalog/service.mjs';
import {createOrder,applyCommands} from '../src/domain/order.mjs';
const snapshot={...defaultCatalogService.getSnapshot(),version:'ui-query-fixture-v1'};
test('catalog queries deduplicate reads and reuse fresh memory cache',async()=>{
 const client=new QueryClient();let calls=0;
 const options=catalogQueryOptions(async()=>{calls++;return Response.json(snapshot);});
 try{await Promise.all([client.fetchQuery(options),client.fetchQuery(options)]);await client.fetchQuery(options);assert.equal(calls,1);assert.equal(options.staleTime,300000);assert.equal(options.gcTime,86400000);assert.equal(options.refetchOnWindowFocus,false);}finally{client.clear();}
});
test('stale refetch failure retains the last good catalog',async()=>{
 const client=new QueryClient();let failed=false,calls=0;
 const options={...catalogQueryOptions(async()=>{calls++;return failed?new Response('unavailable',{status:503}):Response.json(snapshot);}),retryDelay:0,staleTime:0};
 try{await client.fetchQuery(options);failed=true;await assert.rejects(client.fetchQuery(options));assert.equal(calls,3);assert.deepEqual(client.getQueryData(options.queryKey),snapshot);}finally{client.clear();}
});
test('schema mismatch and client errors are never retried',async()=>{
 const client=new QueryClient();let calls=0;
 try{
  await assert.rejects(client.fetchQuery({...catalogQueryOptions(async()=>{calls++;return Response.json({...snapshot,schemaVersion:2});}),retryDelay:0}),/catalog.*schema/i);
  assert.equal(calls,1);client.clear();calls=0;
  await assert.rejects(client.fetchQuery({...catalogQueryOptions(async()=>{calls++;return new Response('bad',{status:404});}),retryDelay:0}));assert.equal(calls,1);
 }finally{client.clear();}
});
test('network failure retries once and forwards cancellation to fetch',async()=>{
 const client=new QueryClient();let calls=0,aborted=false;
 try{
  await assert.rejects(client.fetchQuery({...catalogQueryOptions(async()=>{calls++;throw new TypeError('network');}),retryDelay:0}));assert.equal(calls,2);
  client.clear();
  const options=catalogQueryOptions((_url,{signal})=>new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>{aborted=true;reject(new DOMException('Aborted','AbortError'));},{once:true});}));
  const pending=client.fetchQuery(options);await client.cancelQueries({queryKey:options.queryKey});await assert.rejects(pending,error=>isCancelledError(error));assert.equal(aborted,true);
 }finally{client.clear();}
});
test('catalog fetch rejects malformed products without replacing cache data',async()=>{
 await assert.rejects(fetchCatalog({fetchImpl:async()=>Response.json({...snapshot,supportedProducts:[{id:'latte'}]})}),/catalog.*schema/i);
});
test('refreshed query catalog is registered before callers can adopt its version',async()=>{
 const refreshed={...structuredClone(snapshot),version:'ui-query-refreshed-v1'};
 const result=await fetchCatalog({fetchImpl:async()=>Response.json(refreshed)});
 assert.equal(hasCatalogVersion(result.version),true);
 const order=applyCommands(createOrder(result.version),[{type:'add',productId:'flat-white'}]);
 assert.equal(order.items[0].milk,'whole');assert.equal(order.items[0].shots,3);
});
test('invalid refreshed recipe is rejected and leaves cached facts usable',async()=>{
 const client=new QueryClient(),invalid={...structuredClone(snapshot),version:'ui-query-invalid-v1'};let fail=false;
 invalid.products[0].sizes[0].recipe.defaults.shots='many';
 const options={...catalogQueryOptions(async()=>Response.json(fail?invalid:snapshot)),staleTime:0};
 try{await client.fetchQuery(options);fail=true;await assert.rejects(client.fetchQuery(options),/catalog.*schema/i);assert.equal(hasCatalogVersion(invalid.version),false);assert.deepEqual(client.getQueryData(options.queryKey),snapshot);}finally{client.clear();}
});
