import test from 'node:test';
import assert from 'node:assert/strict';
import {admit,createGateway,createContainerProxy} from '../deploy/browser/gateway.mjs';
const token='test-browser-service-token-'.repeat(3);
const storage=version=>{const values=new Map(version?[['deploymentVersion',version]]:[]);return {get:async key=>values.get(key),put:async(key,value)=>{values.set(key,value);}};};
const request=(path='/quote',options={})=>new Request('https://browser.example'+path,{method:'POST',headers:{Authorization:`Bearer ${token}`},body:'{}',...options});
test('store search is admitted only through the authenticated fixed POST route',()=>{
 assert.equal(admit(request('/stores'),token),null);
 assert.equal(admit(request('/stores',{headers:{}}),token),401);
 assert.equal(admit(new Request('https://browser.example/stores',{headers:{Authorization:`Bearer ${token}`}}),token),404);
});
test('gateway rejects unauthorized and unsupported traffic before accessing containers',async()=>{
 let accessed=0;const gateway=createGateway(),env={BARISTA_BROWSER_TOKEN:token,BROWSER:{getByName(){accessed++;throw Error();}}};
 for(const [req,status] of [[request('/quote',{headers:{}}),401],[request('/quote',{headers:{Authorization:'Bearer wrong'}}),401],[request('/debug'),404],[request('/quote?url=https://evil.example'),404],[request('/quote',{headers:{Authorization:`Bearer ${token}`,'Content-Length':'65537'}}),413]])assert.equal((await gateway.fetch(req,env)).status,status);
 assert.equal(accessed,0);
 assert.equal(admit(request(),''),503);
});
test('gateway forwards authenticated requests only to the fixed singleton and sanitizes faults',async()=>{
 const gateway=createGateway();let selected;
 const env={BARISTA_BROWSER_TOKEN:token,BROWSER:{getByName(name){selected=name;return {fetch:async()=>Response.json({ok:true})};}}};
 assert.deepEqual(await (await gateway.fetch(request(),env)).json(),{ok:true});assert.equal(selected,'pricing');
 env.BROWSER.getByName=()=>{throw Error('private runtime detail');};const res=await gateway.fetch(request(),env);assert.equal(res.status,503);assert.deepEqual(await res.json(),{error:'unavailable'});
});
test('concurrent cold requests share startup, pass secrets only at runtime and treat uninitialized guests as live',async()=>{
 let starts=0,checks=0,forwards=0;const timeouts=[];
 const container={running:false,images:{base:'image-reference'},start(options){starts++;this.running=true;assert.equal(options.image,'image-reference');assert.equal(options.instance,'standard-1');assert.equal(options.enableInternet,true);assert.equal(options.env.BARISTA_BROWSER_TOKEN,token);},async setInactivityTimeout(ms){timeouts.push(ms);},getTcpPort(port){assert.equal(port,4174);return {async fetch(req,init){if(typeof req==='string'){checks++;assert.equal(init.headers.Authorization,`Bearer ${token}`);return Response.json({ready:false,sessions:0});}forwards++;assert.equal(new URL(req.url).host,'container');assert.equal(req.headers.get('host'),null);return Response.json({ok:true});}};}};
 const proxy=createContainerProxy({container,storage:storage('v1')},{BARISTA_BROWSER_TOKEN:token,VERSION:{id:'v1'}});
 const responses=await Promise.all([proxy.fetch(request()),proxy.fetch(request())]);assert.equal(starts,1);assert.equal(checks,1);assert.equal(forwards,2);assert.deepEqual(timeouts,[900000]);for(const r of responses)assert.equal(r.headers.get('cache-control'),'no-store');
 await proxy.fetch(request());assert.equal(starts,1);assert.equal(timeouts.length,2);
});
test('unavailable browser startup is bounded and a later request can recover',async()=>{
 let healthy=false,probes=0;
 const container={running:true,async setInactivityTimeout(){},getTcpPort(){return {async fetch(req){if(typeof req==='string'){probes++;if(!healthy)throw Error('private startup failure');return Response.json({ready:false});}return Response.json({ok:true});}};}};
 const proxy=createContainerProxy({container,storage:storage('v1')},{BARISTA_BROWSER_TOKEN:token,VERSION:{id:'v1'}},{wait:async()=>{}});
 await assert.rejects(proxy.fetch(request()),/Browser startup unavailable/);assert.equal(probes,45);
 healthy=true;assert.equal((await proxy.fetch(request())).status,200);
});
test('first search waits for a sleeping browser container beyond the early startup window',async()=>{
 let probes=0;const pauses=[];
 const container={running:true,async setInactivityTimeout(){},getTcpPort(){return {async fetch(req){if(typeof req==='string'){probes++;if(probes<20)throw Error('starting');return Response.json({ready:false});}return Response.json([]);}};}};
 const proxy=createContainerProxy({container,storage:storage('v1')},{BARISTA_BROWSER_TOKEN:token,VERSION:{id:'v1'}},{wait:async ms=>{pauses.push(ms);}});
 assert.equal((await proxy.fetch(request('/stores'))).status,200);assert.equal(probes,20);
 assert.equal(pauses.length,19);assert.ok(pauses.every(ms=>ms>=0&&ms<=1000));
});

test('deployment rotation destroys once before starting the new image and secret',async()=>{
 const events=[];const persisted=storage('v1');let releaseDestroy;
 const destroyed=new Promise(resolve=>{releaseDestroy=resolve;});
 const container={running:true,images:{base:'new-image'},async destroy(){events.push('destroy');await destroyed;this.running=false;},start(options){events.push('start');assert.equal(this.running,false);assert.equal(options.image,'new-image');assert.equal(options.env.BARISTA_BROWSER_TOKEN,token);this.running=true;},async setInactivityTimeout(){},getTcpPort(){return {async fetch(){return Response.json({ok:true});}};}};
 const proxy=createContainerProxy({container,storage:persisted},{BARISTA_BROWSER_TOKEN:token,VERSION:{id:'v2'}});
 const requests=[proxy.fetch(request()),proxy.fetch(request())];
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(events,['destroy']);assert.equal(await persisted.get('deploymentVersion'),'v1');
 releaseDestroy();await Promise.all(requests);assert.deepEqual(events,['destroy','start']);assert.equal(await persisted.get('deploymentVersion'),'v2');
 await proxy.fetch(request());assert.deepEqual(events,['destroy','start']);
 // A new Durable Object instance on the same deployment reuses the running VM.
 await createContainerProxy({container,storage:persisted},{BARISTA_BROWSER_TOKEN:token,VERSION:{id:'v2'}}).fetch(request());assert.deepEqual(events,['destroy','start']);
 container.running=false;await proxy.fetch(request());assert.deepEqual(events,['destroy','start','start']);
});
test('slow health startup retains the new running VM for the next probe',async()=>{
 let healthy=false,destroys=0,starts=0;const persisted=storage('v1');
 const container={running:true,images:{base:'image'},async destroy(){destroys++;this.running=false;},start(){starts++;this.running=true;},async setInactivityTimeout(){},getTcpPort(){return {async fetch(){if(!healthy)throw Error('not ready');return Response.json({ok:true});}};}};
 const proxy=createContainerProxy({container,storage:persisted},{BARISTA_BROWSER_TOKEN:token,VERSION:{id:'v2'}},{wait:async()=>{}});
 await assert.rejects(proxy.fetch(request()),/startup unavailable/);assert.equal(await persisted.get('deploymentVersion'),'v2');assert.equal(destroys,1);
 healthy=true;await proxy.fetch(request());assert.equal(destroys,1);assert.equal(starts,1);assert.equal(await persisted.get('deploymentVersion'),'v2');
});
test('proxy rejects unauthenticated requests before storage or container access',async()=>{
 const ctx={get container(){throw Error('container accessed');},get storage(){throw Error('storage accessed');}};
 const proxy=createContainerProxy(ctx,{BARISTA_BROWSER_TOKEN:token,VERSION:{id:'v2'}});
 assert.equal((await proxy.fetch(request('/quote',{headers:{}}))).status,401);
});

test('a rejected container start does not persist deployment version',async()=>{
 const persisted=storage('v1');let fails=true,starts=0,destroys=0;
 const container={running:true,images:{base:'image'},async destroy(){destroys++;this.running=false;},start(){starts++;if(fails)throw Error('start rejected');this.running=true;},async setInactivityTimeout(){},getTcpPort(){return {async fetch(){return Response.json({ok:true});}};}};
 const proxy=createContainerProxy({container,storage:persisted},{BARISTA_BROWSER_TOKEN:token,VERSION:{id:'v2'}});
 await assert.rejects(proxy.fetch(request()),/start rejected/);assert.equal(await persisted.get('deploymentVersion'),'v1');
 fails=false;await proxy.fetch(request());assert.equal(await persisted.get('deploymentVersion'),'v2');assert.equal(starts,2);assert.equal(destroys,1);
});
