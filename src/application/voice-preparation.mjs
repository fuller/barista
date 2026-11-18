/**
 * One speculative request per voice session. Taking work transfers ownership to submit.
 * @param {{request: (input: any) => any, onPreview?: (response: any, candidate?: any) => void,
 * onEvent?: (event: string, candidate?: any) => void, setTimer?: (callback: () => void, delay: number) => any,
 * clearTimer?: (timer: any) => void, makeId?: () => string, delayMs?: number}} options
 */
export function createVoicePreparation({request,onPreview=()=>{},onEvent=()=>{},setTimer=setTimeout,clearTimer=clearTimeout,makeId=()=>crypto.randomUUID(),delayMs=650}){
 let session=null;
 const clearDebounce=current=>{if(current.timer!==null){clearTimer(current.timer);current.timer=null;}};
 const invalidate=current=>{
  clearDebounce(current);
  const candidate=current.candidate;current.candidate=null;
  if(candidate){candidate.controller.abort();onPreview(null,candidate);}
 };
 const cancel=()=>{
  const current=session,hadCandidate=Boolean(current?.candidate);session=null;
  if(current)invalidate(current);
  if(!hadCandidate)onPreview(null);
 };
 const currentCandidate=(current,candidate)=>session===current&&current.candidate===candidate&&!candidate.controller.signal.aborted;
 const dispatch=current=>{
  current.timer=null;
  if(session!==current||current.dispatched||!current.text)return;
  current.dispatched=true;
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  const candidate={turnId:makeId(),revision:current.snapshot.revision,text:current.text,controller:new AbortController(),promise};
  current.candidate=candidate;
  // Observe failure without replacing the promise adopted by the final submission.
  promise.then(response=>{
   if(!currentCandidate(current,candidate))return;
   onEvent('preparationReady',candidate);
   if(currentCandidate(current,candidate))onPreview(response,candidate);
  },()=>{current.failed=true;if(currentCandidate(current,candidate))onPreview(null,candidate);}).catch(()=>{});
  onEvent('preparationStarted',candidate);
  try{resolve(request({...current.snapshot,text:candidate.text,turnId:candidate.turnId,signal:candidate.controller.signal}));}
  catch(error){current.failed=true;reject(error);}
 };
 return {
  begin(snapshot){cancel();session={snapshot:structuredClone(snapshot),text:'',timer:null,dispatched:false,failed:false,candidate:null};},
  update(text){
   const current=session;if(!current)return;
   const normalized=typeof text==='string'?text.trim():'';
   const next=normalized.length<=600?normalized:'';
   if(next===current.text)return;
   current.text=next;
   if(current.dispatched){invalidate(current);return;}
   clearDebounce(current);
   if(next)current.timer=setTimer(()=>dispatch(current),delayMs);
  },
  take(text,revision){
   const current=session,candidate=current?.candidate;
   const normalized=typeof text==='string'?text.trim():'';
   if(!candidate||current.failed||candidate.controller.signal.aborted||candidate.text!==normalized||candidate.revision!==revision){cancel();return null;}
   clearDebounce(current);current.candidate=null;session=null;
   onPreview(null,candidate);onEvent('preparationReused',candidate);return candidate;
  },
  cancel,
 };
}
