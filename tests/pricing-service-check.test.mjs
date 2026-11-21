import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

const run=(status,httpStatus=200)=>{
 const mock=`globalThis.fetch=async(url,options)=>{if(!url.endsWith('/status')||options.headers.Authorization!=='Bearer '+process.env.PRICING_SERVICE_TOKEN)throw Error('Unexpected health probe');return Response.json(${JSON.stringify(status)},{status:${httpStatus}});};`;
 return spawnSync(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(mock)}`,'scripts/pricing-service.mjs','--check'],{cwd:new URL('..',import.meta.url),env:{...process.env,PRICING_SERVICE_TOKEN:'test-service-health-token-'.repeat(2)},encoding:'utf8',timeout:5000});
};

test('service check succeeds before any HTTP guest session exists',()=>{
 const result=run({transport:'http',ready:false,sessions:0});
 assert.equal(result.status,0,result.stderr);
 assert.deepEqual(JSON.parse(result.stdout),{transport:'http',ready:false,sessions:0});
});

test('service check rejects unauthorized and unsupported service responses',()=>{
 for(const [status,httpStatus] of [[{error:'unauthorized'},401],[{transport:'browser',ready:true},200],[{ready:true},200]]){
  const result=run(status,httpStatus);
  assert.notEqual(result.status,0);
 }
});
