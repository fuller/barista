import test from 'node:test';
import assert from 'node:assert/strict';
import {parseLatencyArgs,runLatencyBenchmark,mainLatencyBenchmark} from '../scripts/benchmark-menu-latency.mjs';
import corpus from '../evals/menu-selection-dev.json' with {type:'json'};
test('dry defaults prohibit accidental inference and bounds exceed neither 250 requests nor three workers',()=>{
 assert.equal(parseLatencyArgs([]).live,false);
 for(const args of [['--max-requests','251'],['--concurrency','4'],['--split','unknown']])assert.throws(()=>parseLatencyArgs(args));
});
test('dry invocation never loads credentials or creates provider adapter',async()=>{
 const r=await mainLatencyBenchmark([]);assert.equal(r.inferenceCalls,0);assert.equal(r.selectedCases,27);
});
test('three conditions use one shared cold/warm cache, exact seeded carts and a global wire cap',async()=>{
 const seen=[],cache=new Map();let wires=0;
 const r=await runLatencyBenchmark(corpus.cases.slice(0,1),{apiKey:'test-secret',maxRequests:3,concurrency:1,createCache:()=>cache,adapterFactory:({fetchImpl,cache:suppliedCache})=>({async interpretTurn(input){seen.push({cache:suppliedCache,text:input.text,order:structuredClone(input.order)});const k=input.text;if(!suppliedCache?.has(k)){await fetchImpl('https://example.test/decisions',{body:'{}'});suppliedCache?.set(k,true);}return {commands:[],clarification:'test'};}}),fetchImpl:async()=>{wires++;return new Response('{}',{status:200});}});
 assert.deepEqual(r.conditions.map(c=>c.condition),['control','cold','warm']);assert.equal(seen[0].cache,undefined);assert.equal(seen[1].cache,cache);assert.equal(seen[2].cache,cache);assert.deepEqual(seen[1].order,seen[2].order);assert.equal(wires,2);assert.equal(r.totalRequests,2);assert.equal(r.conditions[2].report.summary.requests,0);assert.equal(r.pass,false);
});
test('budget blocks wire calls across condition boundaries and reports incomplete work',async()=>{
 let wires=0;const r=await runLatencyBenchmark(corpus.cases.slice(0,1),{apiKey:'test',maxRequests:1,createCache:()=>new Map(),adapterFactory:({fetchImpl})=>({async interpretTurn(){await fetchImpl('https://example.test/decisions',{body:'{}'});return {commands:[],clarification:'test'};}}),fetchImpl:async()=>{wires++;return new Response('{}');}});
 assert.equal(wires,1);assert.equal(r.totalRequests,1);assert.equal(r.pass,false);assert.equal(r.conditions[1].report.summary.notRun,1);
});
test('strict expected clarification can pass all conditions without invented wire usage',async()=>{
 const c=corpus.cases.find(c=>c.id==='unknown-base-product');
 const r=await runLatencyBenchmark([c],{createCache:()=>new Map(),adapterFactory:()=>({async interpretTurn(){return {commands:[],clarification:'Please identify the product.'};}})});
 assert.equal(r.pass,true);assert.equal(r.totalRequests,0);assert.ok(r.conditions.every(c=>c.report.summary.passed===1&&c.report.summary.usage.promptTokens===null));
});
test('scheduling opt-in stamps and passes candidate only to cold/warm',async()=>{
 assert.equal(parseLatencyArgs([]).scheduling,'sequential');assert.equal(parseLatencyArgs(['--scheduling','guarded-overlap']).scheduling,'guarded-overlap');assert.throws(()=>parseLatencyArgs(['--scheduling','unknown']));
 const schedules=[];const c=corpus.cases.find(c=>c.id==='unknown-base-product');
 const r=await runLatencyBenchmark([c],{scheduling:'guarded-overlap',createCache:()=>new Map(),adapterFactory:({scheduling})=>{schedules.push(scheduling);return {async interpretTurn(){return {commands:[],clarification:'Please identify the product.'};}};}});
 assert.deepEqual(schedules,['sequential','guarded-overlap','guarded-overlap']);assert.deepEqual(r.conditions.map(c=>c.scheduling),schedules);
});
test('holdout selection is explicitly consumed regression, bounded150 and never blind evidence',async()=>{
 const options=parseLatencyArgs(['--split','holdout']);assert.equal(options.maxRequests,150);assert.equal(options.scheduling,'guarded-overlap');assert.throws(()=>parseLatencyArgs(['--split','holdout','--max-requests','151']));
 const report=await mainLatencyBenchmark(['--split','holdout']);assert.equal(report.selectedCases,12);assert.equal(report.evidenceClass,'consumed-holdout-regression');assert.equal(report.blindHoldout,false);assert.equal(report.inferenceCalls,0);
});
test('candidate and control profiles are independently selectable and stamped',async()=>{
 assert.equal(parseLatencyArgs([]).profile,'lean-v9');assert.equal(parseLatencyArgs([]).controlProfile,'lean-v9');
 assert.equal(parseLatencyArgs(['--profile','lean-v8']).controlProfile,'lean-v8');
 assert.throws(()=>parseLatencyArgs(['--profile','unknown']));assert.throws(()=>parseLatencyArgs(['--control-profile','unknown']));
 const profiles=[];const c=corpus.cases.find(c=>c.id==='unknown-base-product');
 const report=await runLatencyBenchmark([c],{profile:'lean-v8',controlProfile:'lean-v8',createCache:()=>new Map(),adapterFactory:({questionProfile})=>{profiles.push(questionProfile);return {interpretTurn:async()=>({commands:[],clarification:'Please identify the product.'})};}});
 assert.deepEqual(profiles,['lean-v8','lean-v8','lean-v8']);assert.deepEqual(report.conditions.map(c=>c.profile),profiles);assert.equal(report.profile,'lean-v8');assert.equal(report.controlProfile,'lean-v8');
 const dry=await mainLatencyBenchmark(['--profile','lean-v8','--control-profile','lean-v8']);assert.equal(dry.profile,'lean-v8');assert.equal(dry.controlProfile,'lean-v8');
});
test('control scheduling is independently selectable, validated and stamped',async()=>{
 assert.equal(parseLatencyArgs([]).controlScheduling,'sequential');
 assert.throws(()=>parseLatencyArgs(['--control-scheduling','unknown']));
 const args=['--profile','lean-v9','--control-profile','lean-v8','--scheduling','guarded-overlap','--control-scheduling','guarded-overlap'];
 assert.equal(parseLatencyArgs(args).controlScheduling,'guarded-overlap');
 const schedules=[],c=corpus.cases.find(c=>c.id==='unknown-base-product');
 const report=await runLatencyBenchmark([c],{profile:'lean-v9',controlProfile:'lean-v8',scheduling:'guarded-overlap',controlScheduling:'guarded-overlap',createCache:()=>new Map(),adapterFactory:({scheduling})=>{schedules.push(scheduling);return {interpretTurn:async()=>({commands:[],clarification:'Please identify the product.'})};}});
 assert.deepEqual(schedules,['guarded-overlap','guarded-overlap','guarded-overlap']);assert.equal(report.controlScheduling,'guarded-overlap');assert.deepEqual(report.conditions.map(c=>c.scheduling),schedules);
 await assert.rejects(runLatencyBenchmark([c],{controlScheduling:'unknown',createCache:()=>new Map()}));
 const dry=await mainLatencyBenchmark(args);assert.equal(dry.controlScheduling,'guarded-overlap');
});
