import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
const {code}=await transform(await readFile(new URL('../src/adapters/voice.ts',import.meta.url),'utf8'),{loader:'ts',format:'esm'});
const {createVoiceInput}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
function setup(){
 const instances=[],transcripts=[],states=[],errors=[];
 class Recognition {constructor(){instances.push(this);}start(){}abort(){this.onend?.();}}
 globalThis.window={SpeechRecognition:Recognition};
 const input=createVoiceInput({onTranscript:t=>transcripts.push(t),onState:s=>states.push(s),onError:e=>errors.push(e)});
 const result=text=>({results:[{isFinal:true,0:{transcript:text}}]});
 return {input,instances,transcripts,states,errors,result};
}
test('speech ending without a final result gives actionable feedback',()=>{
 const f=setup();f.input.start();f.instances[0].onend();
 assert.match(f.errors[0],/didn.t catch|did not catch|no speech/i);
 assert.equal(f.states.at(-1),false);assert.deepEqual(f.transcripts,[]);
});
test('network error explains browser speech service and does not duplicate no-speech feedback',()=>{
 const f=setup();f.input.start();f.instances[0].onerror({error:'network'});f.instances[0].onend();
 assert.match(f.errors[0],/browser.*speech.*service/i);assert.equal(f.errors.length,1);
});
test('final result submitted once; stopped or replaced session ignores late transcripts',()=>{
 const f=setup();f.input.start();const first=f.instances[0];
 first.onresult(f.result('one American and one cold brew'));first.onresult(f.result('duplicate'));
 assert.deepEqual(f.transcripts,['one American and one cold brew']);
 f.input.start();const second=f.instances[1];f.input.stop();second.onresult(f.result('too late'));
 first.onresult(f.result('old'));assert.equal(f.transcripts.length,1);
 assert.deepEqual(f.errors,[]);
});
test('disposing ignores all future callbacks',()=>{
 const f=setup();f.input.start();const r=f.instances[0];f.input.dispose();r.onresult(f.result('late'));r.onerror({error:'network'});r.onend();
 assert.deepEqual(f.errors,[]);assert.deepEqual(f.transcripts,[]);
});
test('finish requests final speech without cancelling the session',()=>{
 const f=setup();f.input.start();const recognition=f.instances[0];let stops=0;recognition.stop=()=>{stops++;};
 f.input.finish();f.input.finish();assert.equal(stops,1);recognition.onresult(f.result('a latte'));assert.deepEqual(f.transcripts,['a latte']);
 f.input.stop();recognition.onresult(f.result('late'));assert.equal(f.transcripts.length,1);
});
test('optional native timing events are ordered and stale sessions are ignored',()=>{
 const events=[],instances=[];class Recognition{constructor(){instances.push(this);}start(){}abort(){}}globalThis.window={SpeechRecognition:Recognition};
 const input=createVoiceInput({onTranscript(){},onState(){},onError(){},onTiming:event=>events.push(event)});
 input.start();const r=instances[0];r.onaudiostart();r.onspeechend();r.onresult({results:[{isFinal:true,0:{transcript:'a latte'}}]});input.stop();r.onaudiostart();r.onspeechend();
 assert.deepEqual(events,['recognitionStart','audioStart','speechEnd','finalTranscript']);
});
