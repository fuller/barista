import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
const {code}=await transform(await readFile(new URL('../src/ui/local-turn-timing.ts',import.meta.url),'utf8'),{loader:'ts',format:'esm'});
const {createLocalTurnTiming}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
test('durations correlate voice, turn and committed revision without source data',()=>{let now=50;const t=createLocalTurnTiming(()=>now);t.begin(2);now=60;t.mark('finalTranscript');assert.equal(t.bind('turn',2),true);now=70;t.mark('fetchStart','turn');t.mark('fetchStart','turn');now=90;t.mark('nextFrame','turn');assert.deepEqual(t.complete('turn',3),{turnId:'turn',baseRevision:2,committedRevision:3,milestones:{micClick:0,finalTranscript:10,fetchStart:20,nextFrame:40}});assert.equal(t.complete('turn',3),null);});
test('cancelled, replaced and wrong revision samples cannot publish',()=>{const t=createLocalTurnTiming(()=>10);t.begin(2);t.bind('old',2);t.cancel();assert.equal(t.complete('old',3),null);t.begin(3);assert.equal(t.bind('new',2),false);assert.equal(t.complete('new',4),null);t.begin(3);t.bind('new',3);assert.equal(t.complete('old',4),null);assert.equal(t.complete('new',3),null);});
