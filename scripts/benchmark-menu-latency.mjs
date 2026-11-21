import {resolveReportOutput,preflightReportOutput} from './report-output.mjs';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {validateMenuCases,runMenuEvaluation,menuHash} from '../src/evals/menu-runner.mjs';
import {createMenuDeciderAdapter} from '../src/adapters/menu-decider.mjs';
import {DEFAULT_MODEL,DEFAULT_MENU_PROFILE} from '../src/adapters/config.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export function parseLatencyArgs(args){
 const options={live:false,maxRequests:250,concurrency:3,controlScheduling:'sequential',scheduling:'sequential',split:'dev',profile:DEFAULT_MENU_PROFILE};const fields={'--max-requests':'maxRequests','--concurrency':'concurrency','--output':'output','--model':'model','--scheduling':'scheduling','--split':'split','--profile':'profile','--control-profile':'controlProfile','--control-scheduling':'controlScheduling'};
 for(let i=0;i<args.length;i++){if(args[i]==='--live'){options.live=true;continue;}const field=fields[args[i]],value=args[++i];if(!field||!value||value.startsWith('--'))throw new Error('Invalid latency benchmark arguments');options[field]=['maxRequests','concurrency'].includes(field)?Number(value):value;}
 options.controlProfile??=options.profile;
 if(options.split==='holdout'){if(!args.includes('--max-requests'))options.maxRequests=150;if(!args.includes('--scheduling'))options.scheduling='guarded-overlap';}
 if(!['lean-v8','lean-v9','lean-v10'].includes(options.profile)||!['lean-v8','lean-v9','lean-v10'].includes(options.controlProfile)||!['dev','holdout'].includes(options.split)||options.split==='holdout'&&options.maxRequests>150||!['sequential','guarded-overlap'].includes(options.scheduling)||!['sequential','guarded-overlap'].includes(options.controlScheduling)||!Number.isInteger(options.maxRequests)||options.maxRequests<1||options.maxRequests>250||!Number.isInteger(options.concurrency)||options.concurrency<1||options.concurrency>3||options.model!==undefined&&!/^[\w./:-]{1,160}$/.test(options.model))throw new Error('Invalid latency benchmark bounds');return options;
}

export async function runLatencyBenchmark(cases,{apiKey,model=DEFAULT_MODEL,maxRequests=250,concurrency=3,controlScheduling='sequential',scheduling='sequential',profile=DEFAULT_MENU_PROFILE,controlProfile=profile,createCache,adapterFactory=createMenuDeciderAdapter,fetchImpl=fetch,corpusSHA}={}){
 parseLatencyArgs(['--max-requests',String(maxRequests),'--concurrency',String(concurrency),'--scheduling',scheduling,'--profile',profile,'--control-profile',controlProfile,'--control-scheduling',controlScheduling]);
 if(typeof createCache!=='function')throw new Error('Cache factory required');
 const cache=createCache(),conditions=[];let totalRequests=0;
 for(const condition of ['control','cold','warm']){
  const conditionProfile=condition==='control'?controlProfile:profile;
  const conditionScheduling=condition==='control'?controlScheduling:scheduling;
  const suppliedCache=condition==='control'?undefined:cache,cacheBefore=suppliedCache?.stats?.()??null;
  const report=await runMenuEvaluation(cases,{apiKey,model,profile:conditionProfile,repeats:1,maxRequests:maxRequests-totalRequests,concurrency,fetchImpl,corpusSHA,adapterFactory:options=>adapterFactory({...options,cache:suppliedCache,scheduling:conditionScheduling})});
  totalRequests+=report.summary.requests;
  conditions.push({condition,profile:conditionProfile,scheduling:conditionScheduling,cache:{enabled:!!suppliedCache,initialState:condition==='control'?'disabled':condition==='cold'?'empty':'primed-by-cold',before:cacheBefore,after:suppliedCache?.stats?.()??null},report});
 }
 return {schemaVersion:1,measurement:'model-through-atomic-cart-application; excludes microphone and browser paint',profile,controlProfile,controlScheduling,scheduling,maxRequests,concurrency,totalRequests,pass:conditions.every(c=>c.report.summary.failed===0&&c.report.summary.notRun===0&&c.report.summary.unsafeMutations===0),conditions};
}
async function fingerprint(){
 const files=['scripts/report-output.mjs','scripts/benchmark-menu-latency.mjs','src/adapters/menu-decider.mjs','src/adapters/config.mjs','src/adapters/menu-identity.mjs','src/adapters/decision-cache.mjs','src/adapters/menu-boundary-locator.mjs','src/adapters/menu-add-batch.mjs','src/adapters/decision-choice.mjs','src/domain/order.mjs','src/catalog/data/starbucks-menu-directory.json','src/evals/menu-runner.mjs'];
 const adapterFiles=(await fs.readdir(path.join(root,'src/adapters'))).filter(file=>file.endsWith('.mjs')).map(file=>'src/adapters/'+file);
 const allFiles=[...new Set([...files,...adapterFiles])].sort();
 return menuHash(await Promise.all(allFiles.map(async file=>[file,await fs.readFile(path.join(root,file),'utf8')])));
}
export async function mainLatencyBenchmark(args=process.argv.slice(2)){
 const options=parseLatencyArgs(args),corpusPath=path.join(root,`evals/menu-selection-${options.split}.json`),bytes=await fs.readFile(corpusPath,'utf8'),validation=validateMenuCases(JSON.parse(bytes)),cases=validation.cases.filter(c=>c.split===options.split),evidence={split:options.split,evidenceClass:options.split==='holdout'?'consumed-holdout-regression':'development-regression',blindHoldout:false};
 if(!options.live){const result={mode:'validation-only',...evidence,profile:options.profile,controlProfile:options.controlProfile,controlScheduling:options.controlScheduling,scheduling:options.scheduling,conditions:['control','cold','warm'],selectedCases:cases.length,corpusSHA:menuHash(bytes),menuVersion:validation.menuVersion,maxRequests:options.maxRequests,concurrency:options.concurrency,inferenceCalls:0};console.log(JSON.stringify(result,null,2));return result;}
 const output=resolveReportOutput(root,options.output,`latency-${options.split}-${Date.now()}-${randomUUID()}.json`);await preflightReportOutput(output);
 const envFile=path.join(root,'.env');if(existsSync(envFile))process.loadEnvFile(envFile);const apiKey=process.env.OPENROUTER_API_KEY;if(!apiKey)throw new Error('Live latency benchmark requires configured credentials');
 const {createDecisionCache}=await import('../src/adapters/decision-cache.mjs');const sourceSHA=await fingerprint(),startedAt=new Date().toISOString();
 const report=await runLatencyBenchmark(cases,{...options,apiKey,model:options.model??process.env.DECISION_MODEL??DEFAULT_MODEL,createCache:createDecisionCache,corpusSHA:menuHash(bytes)});
 Object.assign(report,evidence);
 report.manifest={...evidence,startedAt,finishedAt:new Date().toISOString(),sourceSHA,sourceChangedDuringRun:sourceSHA!==await fingerprint(),corpusSHA:menuHash(bytes),corpusChangedDuringRun:menuHash(bytes)!==menuHash(await fs.readFile(corpusPath,'utf8')),graderSHA:menuHash(await fs.readFile(path.join(root,'src/evals/menu-runner.mjs'),'utf8')),harnessSHA:menuHash(await fs.readFile(fileURLToPath(import.meta.url),'utf8')),menuVersion:validation.menuVersion,runtime:process.version};
 report.pass=report.pass&&!report.manifest.sourceChangedDuringRun&&!report.manifest.corpusChangedDuringRun;
 await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({output,pass:report.pass,manifest:report.manifest,totalRequests:report.totalRequests,conditions:report.conditions.map(({condition,profile,scheduling,cache,report})=>({condition,profile,scheduling,cache,summary:report.summary}))},null,2));process.exitCode=report.pass?0:1;return report;
}
if(process.argv[1]===fileURLToPath(import.meta.url))mainLatencyBenchmark().catch(()=>{console.error('Latency benchmark could not run: check bounds, corpus, output path and live credentials.');process.exitCode=2;});
