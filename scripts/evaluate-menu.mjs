import {resolveReportOutput,preflightReportOutput} from './report-output.mjs';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateMenuCases,runMenuEvaluation,menuHash} from '../src/evals/menu-runner.mjs';
import {DEFAULT_MODEL} from '../src/adapters/config.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export function parseMenuArgs(args){
 const options={live:false,profile:'lean-v9',split:'dev',repeats:1,limit:1000,maxRequests:160,concurrency:3};const fields={'--profile':'profile','--split':'split','--repeat':'repeats','--limit':'limit','--max-requests':'maxRequests','--output':'output','--model':'model','--corpus':'corpus','--concurrency':'concurrency'};
 for(let i=0;i<args.length;i++){if(args[i]==='--live'){options.live=true;continue;}const field=fields[args[i]],value=args[++i];if(!field||value===undefined||value.startsWith('--'))throw new Error('Invalid menu evaluation arguments');options[field]=['repeats','limit','maxRequests','concurrency'].includes(field)?Number(value):value;}
 if(!['lean-v8','lean-v9'].includes(options.profile)||!['dev','holdout'].includes(options.split)||!Number.isInteger(options.repeats)||options.repeats<1||options.repeats>20||!Number.isInteger(options.limit)||options.limit<1||options.limit>1000||!Number.isInteger(options.maxRequests)||options.maxRequests<0||options.maxRequests>5000||!Number.isInteger(options.concurrency)||options.concurrency<1||options.concurrency>3)throw new Error('Invalid menu evaluation arguments');return options;
}
async function fingerprint(){const files=['scripts/report-output.mjs','src/adapters/menu-decider.mjs','src/adapters/config.mjs','src/adapters/decision-cache.mjs','src/adapters/menu-identity.mjs','src/adapters/menu-boundary-locator.mjs','src/adapters/decision-choice.mjs','src/domain/order.mjs','src/catalog/data/starbucks-menu-directory.json','src/evals/menu-runner.mjs','scripts/evaluate-menu.mjs'];return menuHash(await Promise.all(files.map(async file=>[file,await fs.readFile(path.join(root,file),'utf8')])));}
export async function mainMenuEvaluation(args=process.argv.slice(2)){
 const options=parseMenuArgs(args),corpusPath=options.corpus?path.resolve(options.corpus):path.join(root,'evals',`menu-selection-${options.split}.json`),bytes=await fs.readFile(corpusPath,'utf8'),input=JSON.parse(bytes),validation=validateMenuCases(input),selected=validation.cases.filter(c=>c.split===options.split).slice(0,options.limit);if(!selected.length)throw new Error('No menu cases selected');
 if(!options.live){const result={mode:'validation-only',profile:options.profile,split:options.split,validatedCases:validation.caseCount,selectedCases:selected.length,corpusSHA:menuHash(bytes),menuVersion:validation.menuVersion,inferenceCalls:0};console.log(JSON.stringify(result,null,2));return result;}
 const output=resolveReportOutput(root,options.output,`menu-${options.profile}-${options.split}-${Date.now()}.json`);await preflightReportOutput(output);
 const envFile=path.join(root,'.env');if(existsSync(envFile))process.loadEnvFile(envFile);if(!process.env.OPENROUTER_API_KEY)throw new Error('Live menu evaluation requires configured credentials');
 const model=options.model??process.env.DECISION_MODEL??DEFAULT_MODEL,sourceSHA=await fingerprint();
 const report=await runMenuEvaluation(selected,{...options,apiKey:process.env.OPENROUTER_API_KEY,model,corpusSHA:menuHash(bytes)});
 report.manifest.sourceSHA=sourceSHA;report.manifest.sourceChangedDuringRun=sourceSHA!==await fingerprint();report.manifest.graderSHA=menuHash(await fs.readFile(path.join(root,'src/evals/menu-runner.mjs'),'utf8'));report.manifest.harnessSHA=menuHash(await fs.readFile(fileURLToPath(import.meta.url),'utf8'));report.manifest.runtime=process.version;
 await fs.writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({output,manifest:report.manifest,summary:report.summary},null,2));process.exitCode=report.summary.failed||report.manifest.sourceChangedDuringRun?1:0;return report;
}
if(process.argv[1]===fileURLToPath(import.meta.url))mainMenuEvaluation().catch(()=>{console.error('Menu evaluation could not run: check arguments, corpus, output path and live credentials.');process.exitCode=2;});
