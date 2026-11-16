import test from 'node:test';import assert from 'node:assert/strict';
import {createRegistry} from '../src/adapters/registry.mjs';
test('production registry defaults to decider only and cannot resolve demo',()=>{
 const registry=createRegistry();assert.equal(registry.has('decider'),true);assert.equal(registry.has('demo'),false);assert.throws(()=>registry.resolve('demo',{apiKey:'fake'}),/Unknown decision provider/);
});
test('explicit provider factories remain replaceable without a local fallback',async()=>{
 const registry=createRegistry({fixture:()=>({interpretTurn:async()=>({commands:[],source:'fixture'})})});assert.equal((await registry.resolve('fixture',{}).interpretTurn()).source,'fixture');assert.equal(registry.has('demo'),false);
});

test('default registry uses full menu v9 and rejects retired question profiles',()=>{
 const registry=createRegistry();assert.ok(registry.resolve('decider',{apiKey:'fixture-key'}).interpretTurn);
 for(const questionProfile of ['baseline','lean-v1','lean-v2','lean-v3','lean-v4','lean-v5','lean-v6','lean-v7'])assert.throws(()=>registry.resolve('decider',{apiKey:'fixture-key',questionProfile}),/Invalid menu question profile/);
 for(const questionProfile of ['lean-v8','lean-v9'])assert.ok(registry.resolve('decider',{apiKey:'fixture-key',questionProfile}).interpretTurn);
});
