import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {resolveReportOutput,preflightReportOutput} from '../scripts/report-output.mjs';
import {mainMenuEvaluation} from '../scripts/evaluate-menu.mjs';
import {mainLatencyBenchmark} from '../scripts/benchmark-menu-latency.mjs';
test('default reports stay inside repository work directory and explicit paths retain cwd semantics',()=>{
 assert.equal(resolveReportOutput('/opt/barista',undefined,'menu.json'),'/opt/barista/work/menu-evals/menu.json');
 assert.equal(resolveReportOutput('/opt/barista','custom/menu.json','unused.json'),path.resolve('custom/menu.json'));
 assert.equal(resolveReportOutput('/opt/barista','/tmp/menu.json','unused.json'),'/tmp/menu.json');
});
test('output preflight creates usable parent, leaves no probe and rejects existing or invalid paths',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'barista-output-'));
 try{const output=path.join(dir,'nested','report.json');await preflightReportOutput(output);assert.deepEqual(await fs.readdir(path.dirname(output)),[]);await fs.writeFile(output,'keep');await assert.rejects(()=>preflightReportOutput(output),/already exists/);assert.equal(await fs.readFile(output,'utf8'),'keep');await assert.rejects(()=>preflightReportOutput(path.join(output,'child.json')));}
 finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('live harnesses reject existing output before credentials or provider dispatch',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'barista-output-'));const output=path.join(dir,'existing.json');await fs.writeFile(output,'keep');const previous=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('must not dispatch');};
 try{for(const main of [mainMenuEvaluation,mainLatencyBenchmark])await assert.rejects(()=>main(['--live','--output',output]),/already exists/);assert.equal(calls,0);assert.equal(await fs.readFile(output,'utf8'),'keep');}
 finally{globalThis.fetch=previous;await fs.rm(dir,{recursive:true,force:true});}
});
