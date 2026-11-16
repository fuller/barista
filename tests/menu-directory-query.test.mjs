import test from 'node:test';
import assert from 'node:assert/strict';
import directory from '../src/catalog/data/starbucks-menu-directory.json' with {type:'json'};
import {fetchMenuDirectory,menuDirectoryQueryOptions} from '../src/ui/menu-directory-cache.mjs';
test('full menu fetch validates every listing, uses abort signal and cacheable GET',async()=>{
 const controller=new AbortController();
 const result=await fetchMenuDirectory({signal:controller.signal,fetchImpl:async(url,options)=>{
  assert.equal(url,'/api/menu-directory');assert.equal(options.signal,controller.signal);
  assert.equal(options.headers.Accept,'application/json');
  return Response.json(directory);
 }});
 assert.equal(result.products.length,313);
});
test('invalid menu never replaces last good query value',async()=>{
 await assert.rejects(fetchMenuDirectory({fetchImpl:async()=>Response.json({...directory,products:[]})}),/Invalid menu directory/);
});
test('menu retries transient failures only, deduplicates for five minutes, retains for one day',async()=>{
 const options=menuDirectoryQueryOptions();
 assert.equal(options.staleTime,300000);assert.equal(options.gcTime,86400000);
 assert.equal(options.refetchOnWindowFocus,false);
 assert.equal(options.retry(0,new TypeError('Network')),true);
 assert.equal(options.retry(1,new TypeError('Network')),false);
 assert.equal(options.retry(0,new Error('Invalid menu directory')),false);
 let error;try{await fetchMenuDirectory({fetchImpl:async()=>new Response('',{status:503})});}catch(e){error=e;}
 assert.equal(options.retry(0,error),true);
});
