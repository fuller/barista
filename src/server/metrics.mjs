/** Only safe aggregate measurements may cross the HTTP boundary. */
export function sanitizeMetrics(metrics){
 if(!metrics||typeof metrics!=='object')return undefined;
 const counts=['extractionRequests','decisionRequests','totalRequests','clauseCount'];
 const times=['extractionMs','decisionMs','totalMs'];
 if(counts.some(k=>!Number.isSafeInteger(metrics[k])||metrics[k]<0)||times.some(k=>!Number.isFinite(metrics[k])||metrics[k]<0)||!['single','batch','sequential'].includes(metrics.strategy)||metrics.totalRequests!==metrics.extractionRequests+metrics.decisionRequests)return undefined;
 const result=Object.fromEntries([...counts,'strategy',...times].map(k=>[k,metrics[k]]));
 if(Number.isSafeInteger(metrics.cacheHits)&&metrics.cacheHits>=0)result.cacheHits=metrics.cacheHits;
 if(Array.isArray(metrics.extractionFailures)&&metrics.extractionFailures.length<=2&&metrics.extractionFailures.every(r=>CLARIFICATION_REASONS.includes(r)))result.extractionFailures=[...metrics.extractionFailures];
 return result;
}

import {CLARIFICATION_REASONS,CLARIFICATION_STAGES} from '../adapters/clarification.mjs';
import {hasCatalogVersion} from '../catalog/service.mjs';
import {MODIFIER_DEFINITIONS,INGREDIENTS} from '../domain/modifiers.mjs';
const fields=new Set([...'syrups sauces sweeteners inclusions'.split(' ').map(group=>'clear__'+group),...MODIFIER_DEFINITIONS.find(d=>d.id==='onSide').options.map(id=>'side__'+id),'supported','action','target','productId','syrup','pumps','decaf','whip','coldFoamId','coldFoamAmount',...MODIFIER_DEFINITIONS.map(d=>d.id),...Object.entries(INGREDIENTS).flatMap(([group,items])=>items.map(i=>group+'__'+i.id))]);
/** Diagnostics contain enum reasons and numeric bounds, never provider bodies or utterances. */
export function sanitizeDiagnostics(value){
 if(!value||!['baseline','list-v1','repair-v1','slots-v1','explicit-add-v1','applicability-v1'].includes(value.policy)||!CLARIFICATION_STAGES.includes(value.stage)||!CLARIFICATION_REASONS.includes(value.reason)||!['retry','slot'].includes(value.mode))return undefined;
 const result=Object.fromEntries(['policy','stage','reason','mode'].map(k=>[k,value[k]]));
 if(fields.has(value.field))result.field=value.field;
 if(Number.isSafeInteger(value.attempts)&&value.attempts>=0&&value.attempts<=8)result.attempts=value.attempts;
 if(Number.isSafeInteger(value.clauseIndex)&&value.clauseIndex>=0&&value.clauseIndex<6)result.clauseIndex=value.clauseIndex;
 if(typeof value.catalogVersion==='string'&&hasCatalogVersion(value.catalogVersion))result.catalogVersion=value.catalogVersion;
 if(Array.isArray(value.uncoveredSpans)&&value.uncoveredSpans.length<=64&&value.uncoveredSpans.every((span,i)=>Array.isArray(span)&&span.length===2&&span.every(Number.isSafeInteger)&&span[0]>=0&&span[1]>span[0]&&span[1]<=600&&(!i||span[0]>=value.uncoveredSpans[i-1][1])))result.uncoveredSpans=value.uncoveredSpans.map(s=>[...s]);
 return result;
}
