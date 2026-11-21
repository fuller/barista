export const CLARIFICATION_STAGES=Object.freeze(['extraction','decision','compile','catalog','conversation']);
export const CLARIFICATION_REASONS=Object.freeze(['extract_null','extract_incomplete_coverage','extract_low_confidence','input_truncated','decision_low_confidence','field_unrepresented','unsupported_catalog_choice','ambiguous_target','ambiguous_ingredient','provider_refusal','invalid_provider_response','conflicting_instructions','request_budget_exhausted','detail_budget_exceeded']);

export function clarification(message,{mode,stage,reason,policy='baseline',field,clauseIndex,uncoveredSpans,catalogVersion,attempts}={}){
 if(!['baseline','list-v1','repair-v1','slots-v1','explicit-add-v1','applicability-v1'].includes(policy)||!['retry','slot'].includes(mode)||!CLARIFICATION_STAGES.includes(stage)||!CLARIFICATION_REASONS.includes(reason))throw new Error('Invalid clarification contract');
 const diagnostics={policy,stage,reason,mode};
 if(typeof field==='string'&&/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(field))diagnostics.field=field;
 if(Number.isInteger(clauseIndex)&&clauseIndex>=0)diagnostics.clauseIndex=clauseIndex;
 if(Array.isArray(uncoveredSpans)&&uncoveredSpans.every(s=>Array.isArray(s)&&s.length===2&&s.every(Number.isInteger)&&s[0]>=0&&s[1]>s[0]))diagnostics.uncoveredSpans=uncoveredSpans.map(s=>[...s]);
 if(typeof catalogVersion==='string'&&/^[a-zA-Z0-9._:-]{1,160}$/.test(catalogVersion))diagnostics.catalogVersion=catalogVersion;
 if(Number.isInteger(attempts)&&attempts>=0)diagnostics.attempts=attempts;
 return {commands:[],clarification:message,clarificationMode:mode,source:'decider',diagnostics};
}
