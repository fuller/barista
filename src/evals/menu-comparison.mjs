const fields=['corpusSHA','graderSHA','menuVersion','model'];
const key=row=>`${row.caseId}:${row.repeat}`;
const count=value=>Number.isSafeInteger(value)&&value>=0;
const numeric=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
/** Compare saved evidence only. Unknown provider usage never becomes zero. */
export function compareMenuEvaluations(baseline,candidate){
 const reasons=[];const reject=(code,report)=>reasons.push({code,...(report?{report}:{})});
 function inspect(report,label){
  if(report?.schemaVersion!==1||!report.manifest||!Array.isArray(report.results)){reject('invalid_report',label);return {rows:new Map(),passed:0,total:0,requests:null,wire:[]};}
  const manifest=report.manifest,rows=new Map();
  if(manifest.sourceChangedDuringRun!==false)reject('source_changed_or_unverified',label);
  if(!Array.isArray(manifest.caseIds)||!manifest.caseIds.length||manifest.caseIds.some(id=>typeof id!=='string'||!id)||new Set(manifest.caseIds).size!==manifest.caseIds.length||!Number.isInteger(manifest.repeats)||manifest.repeats<1||manifest.repeats>20)reject('invalid_coverage_manifest',label);
  const expected=new Set(Array.isArray(manifest.caseIds)&&Number.isInteger(manifest.repeats)&&manifest.repeats>0&&manifest.repeats<=20?manifest.caseIds.flatMap(id=>Array.from({length:manifest.repeats},(_,i)=>`${id}:${i}`)):[]);
  let requests=0;const wire=[];
  for(const row of report.results){
   if(!row||typeof row.caseId!=='string'||!Number.isInteger(row.repeat)){reject('invalid_result',label);continue;}
   const id=key(row);if(rows.has(id))reject('duplicate_case_coverage',label);rows.set(id,row);
   if(!expected.has(id))reject('unexpected_case_coverage',label);
   if(row.status!=='completed'||typeof row.pass!=='boolean'||row.error)reject('incomplete_or_error_result',label);
   if(typeof row.unsafeMutation!=='boolean')reject('unverified_mutation_state',label);
   if(label==='candidate'&&row.unsafeMutation===true)reject('unsafe_candidate',label);
   if(!count(row.requestCount)||!Array.isArray(row.requests)||row.requests.length!==row.requestCount)reject('invalid_request_accounting',label);
   else{requests+=row.requestCount;wire.push(...row.requests);}
  }
  if(rows.size!==expected.size||[...expected].some(id=>!rows.has(id)))reject('missing_case_coverage',label);
  if(!count(report.summary?.requests)||report.summary.requests!==requests)reject('invalid_request_accounting',label);
  if(label==='candidate'&&(!count(report.summary?.unsafeMutations)||report.summary.unsafeMutations!==0))reject('unsafe_candidate',label);
  return {rows,passed:[...rows.values()].filter(row=>row.pass===true).length,total:expected.size,requests,wire};
 }
 const before=inspect(baseline,'baseline'),after=inspect(candidate,'candidate');
 for(const field of fields)if(typeof baseline?.manifest?.[field]!=='string'||!baseline.manifest[field]||baseline.manifest[field]!==candidate?.manifest?.[field])reject('mismatched_'+field);
 const beforeKeys=[...before.rows.keys()].sort(),afterKeys=[...after.rows.keys()].sort();
 if(JSON.stringify(beforeKeys)!==JSON.stringify(afterKeys))reject('mismatched_case_repeat_coverage');
 const paired=beforeKeys.filter(id=>after.rows.has(id)),regressions=[],improvements=[];
 for(const id of paired){const a=before.rows.get(id),b=after.rows.get(id);if(a.expectedOutcome!==b.expectedOutcome)reject('mismatched_expected_outcome');if(a.pass&&!b.pass)regressions.push(id);if(!a.pass&&b.pass)improvements.push(id);}
 if(regressions.length)reject('paired_regression');
 if(after.passed<before.passed)reject('lower_aggregate_quality');
 function sum(records,field){if(!records.length||records.some(r=>r?.usage?.available!==true||!numeric(r.usage[field])||(field!=='costUSD'&&!count(r.usage[field]))))return null;return records.reduce((n,r)=>n+r.usage[field],0);}
 const tokens=Object.fromEntries(['promptTokens','completionTokens','totalTokens'].map(field=>{const a=sum(before.wire,field),b=sum(after.wire,field);return [field,{baseline:a,candidate:b,saved:a!==null&&b!==null?a-b:null,reductionRatio:a!==null&&b!==null&&a>0?(a-b)/a:null}];}));
 const qualityPass=reasons.length===0;
 const efficiencyVerified=tokens.promptTokens.baseline!==null&&tokens.promptTokens.candidate!==null;
 if(!efficiencyVerified)reject('unverified_prompt_tokens');
 else if(tokens.promptTokens.candidate>=tokens.promptTokens.baseline)reject('no_prompt_token_saving');
 const provenance=Object.fromEntries(['sourceSHA','harnessSHA'].map(field=>[field,{baseline:typeof baseline?.manifest?.[field]==='string'?baseline.manifest[field]:null,candidate:typeof candidate?.manifest?.[field]==='string'?candidate.manifest[field]:null,matching:typeof baseline?.manifest?.[field]==='string'&&baseline.manifest[field]===candidate?.manifest?.[field]}]));
 return {schemaVersion:1,pass:reasons.length===0,qualityPass,efficiencyVerified,reasons,paired:{count:paired.length,regressions,improvements},baseline:{profile:baseline?.manifest?.profile??null,passed:before.passed,total:before.total,requests:before.requests},candidate:{profile:candidate?.manifest?.profile??null,passed:after.passed,total:after.total,requests:after.requests},changes:{passedDelta:after.passed-before.passed,requestDelta:before.requests!==null&&after.requests!==null?after.requests-before.requests:null},tokens,provenance,comparability:Object.fromEntries(fields.map(field=>[field,baseline?.manifest?.[field]??null]))};
}
