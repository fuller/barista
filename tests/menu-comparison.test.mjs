import test from 'node:test';
import assert from 'node:assert/strict';
import {compareMenuEvaluations} from '../src/evals/menu-comparison.mjs';
function report({profile='baseline',passes=[true,true],tokens=100,unknown=false,requests=1}={}){
 return {schemaVersion:1,manifest:{corpusSHA:'corpus',graderSHA:'grader',menuVersion:'menu',model:'model',caseIds:['a','b'],repeats:1,profile,sourceSHA:'source-'+profile,harnessSHA:'harness-'+profile,sourceChangedDuringRun:false},summary:{unsafeMutations:0,requests:2*requests},results:passes.map((pass,i)=>({caseId:['a','b'][i],repeat:0,status:'completed',pass,unsafeMutation:false,expectedOutcome:'commit',requestCount:requests,requests:Array.from({length:requests},()=>({usage:{available:!unknown,promptTokens:unknown?null:tokens,completionTokens:unknown?null:10,totalTokens:null,costUSD:0}}))}))};
}
test('equal paired quality with real prompt-token savings passes and reports request increases',()=>{
 const comparison=compareMenuEvaluations(report({tokens:100}),report({profile:'lean-v5',tokens:20,requests:2}));assert.equal(comparison.pass,true);assert.equal(comparison.changes.requestDelta,2);assert.equal(comparison.tokens.promptTokens.baseline,200);assert.equal(comparison.tokens.promptTokens.candidate,80);assert.equal(comparison.tokens.promptTokens.reductionRatio,.6);assert.equal(comparison.tokens.totalTokens.reductionRatio,null);assert.equal(comparison.provenance.sourceSHA.matching,false);assert.equal(comparison.provenance.harnessSHA.matching,false);
});
test('paired baseline regression fails even with equal aggregate pass count and fewer tokens',()=>{
 const comparison=compareMenuEvaluations(report({passes:[true,false]}),report({profile:'lean-v5',passes:[false,true],tokens:1}));assert.equal(comparison.pass,false);assert.ok(comparison.reasons.some(r=>r.code==='paired_regression'));assert.deepEqual(comparison.paired.regressions,['a:0']);
});
test('lower aggregate quality fails and unsafe candidates fail',()=>{
 const lower=compareMenuEvaluations(report(),report({passes:[true,false]}));assert.ok(lower.reasons.some(r=>r.code==='lower_aggregate_quality'));const candidate=report();candidate.results[0].unsafeMutation=true;assert.equal(compareMenuEvaluations(report(),candidate).pass,false);
});
for(const field of ['corpusSHA','graderSHA','menuVersion','model'])test('mismatched '+field+' is not comparable',()=>{const candidate=report();candidate.manifest[field]='different';const comparison=compareMenuEvaluations(report(),candidate);assert.equal(comparison.pass,false);assert.ok(comparison.reasons.some(r=>r.code==='mismatched_'+field));});
test('missing coverage, duplicate rows, changed source and incomplete cases fail closed',()=>{
 for(const mutate of [r=>r.results.pop(),r=>{r.results[1]={...r.results[0]};},r=>{r.manifest.sourceChangedDuringRun=true;},r=>{delete r.manifest.sourceChangedDuringRun;},r=>{r.results[0].status='error';},r=>{r.results[0].status='not_run_budget';}]){const candidate=report();mutate(candidate);assert.equal(compareMenuEvaluations(report(),candidate).pass,false);}
});
test('unknown usage stays null rather than becoming a zero-token saving',()=>{
 const comparison=compareMenuEvaluations(report(),report({unknown:true}));assert.equal(comparison.pass,false);assert.equal(comparison.qualityPass,true);assert.equal(comparison.efficiencyVerified,false);assert.equal(comparison.tokens.promptTokens.candidate,null);assert.equal(comparison.tokens.promptTokens.saved,null);assert.equal(comparison.tokens.promptTokens.reductionRatio,null);
});
test('actual provider zero tokens remain known but zero baseline has no reduction ratio',()=>{
 const comparison=compareMenuEvaluations(report({tokens:0}),report({tokens:0}));assert.equal(comparison.tokens.promptTokens.baseline,0);assert.equal(comparison.tokens.promptTokens.saved,0);assert.equal(comparison.tokens.promptTokens.reductionRatio,null);
});
test('request accounting mismatch rejects comparison',()=>{const candidate=report();candidate.summary.requests=99;const result=compareMenuEvaluations(report(),candidate);assert.equal(result.pass,false);assert.ok(result.reasons.some(r=>r.code==='invalid_request_accounting'));});
test('saved-report CLI exits nonzero for a failed quality gate',async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path'),{spawnSync}=await import('node:child_process');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'menu-compare-'));
 try{const a=path.join(dir,'baseline.json'),b=path.join(dir,'candidate.json');await fs.writeFile(a,JSON.stringify(report()));await fs.writeFile(b,JSON.stringify(report({passes:[false,true]})));const result=spawnSync(process.execPath,[new URL('../scripts/compare-menu-evals.mjs',import.meta.url).pathname,a,b],{encoding:'utf8'});assert.equal(result.status,1);assert.equal(JSON.parse(result.stdout).pass,false);}finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('equal or worse measured input tokens never pass promotion despite unchanged quality',()=>{
 for(const tokens of [100,120]){const comparison=compareMenuEvaluations(report({tokens:100}),report({tokens}));assert.equal(comparison.qualityPass,true);assert.equal(comparison.efficiencyVerified,true);assert.equal(comparison.pass,false);assert.ok(comparison.reasons.some(r=>r.code==='no_prompt_token_saving'));}
 const improved=compareMenuEvaluations(report({tokens:100}),report({tokens:50}));assert.equal(improved.qualityPass,true);assert.equal(improved.efficiencyVerified,true);assert.equal(improved.pass,true);
});
