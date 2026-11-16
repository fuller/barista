import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {compareMenuEvaluations} from '../src/evals/menu-comparison.mjs';
export async function compareSavedMenuReports(args=process.argv.slice(2)){
 if(args.length!==2||args.some(value=>value.startsWith('--')))throw new Error('Expected baseline and candidate report paths');
 const reports=await Promise.all(args.map(async file=>JSON.parse(await fs.readFile(file,'utf8'))));
 const comparison=compareMenuEvaluations(...reports);console.log(JSON.stringify(comparison,null,2));process.exitCode=comparison.pass?0:1;return comparison;
}
if(process.argv[1]===fileURLToPath(import.meta.url))compareSavedMenuReports().catch(()=>{console.error('Comparison could not run: provide two valid saved menu evaluation reports.');process.exitCode=2;});
