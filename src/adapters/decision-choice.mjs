const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
/** Strict Decisions choice protocol, shared without changing selection thresholds. */
export function readDecisionChoice(answer,question,{threshold=.85,margin=.15}={}){
 if(answer?.type==='refusal')return null;
 if(answer?.type!=='choice'||typeof answer.choice!=='string'||!Object.hasOwn(question.criteria,answer.choice)||!record(answer.probabilities))throw new Error('Invalid decision answer');
 const keys=Object.keys(question.criteria),p=answer.probabilities;
 if(Object.keys(p).length!==keys.length||keys.some(k=>!Number.isFinite(p[k])||p[k]<0||p[k]>1))throw new Error('Invalid decision probabilities');
 const ranked=keys.map(k=>[k,p[k]]).sort((a,b)=>b[1]-a[1]);
 if(Math.abs(ranked.reduce((n,[,v])=>n+v,0)-1)>.05||ranked[0][0]!==answer.choice)throw new Error('Invalid decision distribution');
 return ranked[0][1]>=threshold&&ranked[0][1]-(ranked[1]?.[1]??0)>=margin?answer.choice:null;
}
