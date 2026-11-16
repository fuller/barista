import test from 'node:test';import assert from 'node:assert/strict';
import {sanitizeDiagnostics} from '../src/server/metrics.mjs';
const valid={policy:'baseline',stage:'extraction',reason:'extract_incomplete_coverage',mode:'retry',attempts:1,clauseIndex:0,uncoveredSpans:[[16,27]],catalogVersion:'legacy-sample-v1'};
test('diagnostics expose only safe known fields',()=>{assert.deepEqual(sanitizeDiagnostics({...valid,apiKey:'secret',text:'private',probabilities:{x:1},response:'private'}),valid);});
test('unknown diagnostic enums never escape the boundary',()=>{for(const x of [null,{}, {...valid,policy:'private-key'},{...valid,stage:'private'}, {...valid,reason:'private'},{...valid,mode:'private'}])assert.equal(sanitizeDiagnostics(x),undefined);});
test('diagnostic optional values are bounded and allowlisted',()=>{const result=sanitizeDiagnostics({...valid,field:'private-key',catalogVersion:'private-key',attempts:999,clauseIndex:10,uncoveredSpans:[[0,99999]]});assert.deepEqual(result,{policy:'baseline',stage:'extraction',reason:'extract_incomplete_coverage',mode:'retry'});assert.equal(sanitizeDiagnostics({...valid,field:'milk'}).field,'milk');});

test('generated clear and side question keys remain observable',()=>{for(const field of ['clear__syrups','clear__sauces','clear__sweeteners','clear__inclusions','side__milk','side__coldFoam'])assert.equal(sanitizeDiagnostics({...valid,field}).field,field);});
