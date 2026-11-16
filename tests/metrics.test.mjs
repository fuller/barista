import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeMetrics} from '../src/server/metrics.mjs';
const valid={extractionRequests:1,decisionRequests:1,totalRequests:2,clauseCount:2,strategy:'batch',extractionMs:10,decisionMs:20,totalMs:31};
test('metrics allowlist excludes provider content and credentials',()=>{assert.deepEqual(sanitizeMetrics({...valid,apiKey:'secret',prompt:'private',response:{secret:true}}),valid);});
test('invalid or missing metrics are omitted',()=>{for(const m of [undefined,null,{}, {...valid,totalRequests:3},{...valid,decisionMs:NaN},{...valid,extractionRequests:-1},{...valid,strategy:'arbitrary'}])assert.equal(sanitizeMetrics(m),undefined);});

test('metrics retain bounded allowlisted extraction failure history only',()=>{assert.deepEqual(sanitizeMetrics({...valid,extractionFailures:['extract_null']}),{...valid,extractionFailures:['extract_null']});assert.equal(sanitizeMetrics({...valid,extractionFailures:['secret']}).extractionFailures,undefined);});
test('optional cache hits expose safe counts only and do not alter wire request totals',()=>{
 assert.equal(sanitizeMetrics({...valid,cacheHits:3}).cacheHits,3);assert.equal(sanitizeMetrics({...valid,cacheHits:3}).totalRequests,2);for(const cacheHits of [-1,1.2,Infinity,'3'])assert.equal(sanitizeMetrics({...valid,cacheHits}).cacheHits,undefined);
});
