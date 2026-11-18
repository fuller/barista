import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
const {code}=await transform(await readFile(new URL('../src/ui/local-turn-timing.ts',import.meta.url),'utf8'),{loader:'ts',format:'esm'});
const {createLocalTurnTiming}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
test('durations correlate voice, turn and committed revision without source data',()=>{let now=50;const t=createLocalTurnTiming(()=>now);t.begin(2);now=60;t.mark('finalTranscript');assert.equal(t.bind('turn',2),true);now=70;t.mark('fetchStart','turn');t.mark('fetchStart','turn');now=90;t.mark('nextFrame','turn');assert.deepEqual(t.complete('turn',3),{turnId:'turn',baseRevision:2,committedRevision:3,milestones:{micClick:0,finalTranscript:10,fetchStart:20,nextFrame:40}});assert.equal(t.complete('turn',3),null);});
test('cancelled, replaced and wrong revision samples cannot publish',()=>{const t=createLocalTurnTiming(()=>10);t.begin(2);t.bind('old',2);t.cancel();assert.equal(t.complete('old',3),null);t.begin(3);assert.equal(t.bind('new',2),false);assert.equal(t.complete('new',4),null);t.begin(3);t.bind('new',3);assert.equal(t.complete('old',4),null);assert.equal(t.complete('new',3),null);});

test('prepared timing is isolated until exact turn adoption and discarded branches cannot taint fallback',()=>{
 let now=0;const t=createLocalTurnTiming(()=>now);t.begin(0);const abandoned=t.fork();now=10;abandoned.mark('fetchStart');now=20;t.mark('finalTranscript');t.bind('final',0);now=21;t.mark('fetchStart','final');
 assert.equal(t.complete('final',1).milestones.fetchStart,21);
 t.begin(1);const prepared=t.fork();now=30;prepared.mark('fetchStart');now=40;prepared.mark('responseParsed');now=50;t.mark('finalTranscript');t.bind('prepared',1);prepared.adopt('wrong');prepared.adopt('prepared');now=60;t.mark('commandsApplied','prepared');
 const sample=t.complete('prepared',2);assert.equal(sample.milestones.fetchStart,9);assert.equal(sample.milestones.responseParsed,19);assert.equal(sample.milestones.finalTranscript,29);
});
test('old prepared recorder cannot write into replacement voice sample',()=>{
 let now=0;const t=createLocalTurnTiming(()=>now);t.begin(0);const old=t.fork();now=10;old.mark('fetchStart');t.cancel();now=20;t.begin(0);old.mark('responseParsed');t.bind('new',0);old.adopt('new');assert.deepEqual(t.complete('new',1).milestones,{micClick:0});
});

test('adopted pending request continues to record response timing for that turn',()=>{
 let now=0;const t=createLocalTurnTiming(()=>now);t.begin(0);const pending=t.fork();now=10;pending.mark('fetchStart');now=20;t.mark('finalTranscript');t.bind('turn',0);pending.adopt('turn');now=30;pending.mark('responseParsed');
 const sample=t.complete('turn',1);assert.equal(sample.milestones.fetchStart,10);assert.equal(sample.milestones.responseParsed,30);
});
