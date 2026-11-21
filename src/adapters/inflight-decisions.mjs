export function createInflightDecisions({maxEntries=128,maxBytes=2097152}={}){
 if(!Number.isSafeInteger(maxEntries)||maxEntries<1||maxEntries>128||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>2097152)throw new Error('Invalid in-flight decision limits');
 const entries=new Map();let totalBytes=0;
 const remove=entry=>{
  if(entry.tracked&&entries.get(entry.key)===entry){entries.delete(entry.key);totalBytes-=entry.bytes;}
 };
 const finish=(entry,value,failed)=>{
  if(entry.settled)return;
  entry.settled=true;remove(entry);
  for(const subscriber of entry.subscribers){
   subscriber.signal?.removeEventListener('abort',subscriber.abort);
   try{const copy=structuredClone(value);if(failed&&value?.evalBudget===true)copy.evalBudget=true;if(failed)subscriber.reject(copy);else subscriber.resolve({value:copy,shared:subscriber.shared});}
   catch(error){subscriber.reject(error);}
  }
  entry.subscribers.clear();
 };
 return {
  async run(key,producer,{signal,bytes=0}={}){
   if(typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key)||typeof producer!=='function'||!Number.isSafeInteger(bytes)||bytes<0)throw new Error('Invalid in-flight decision request');
   signal?.throwIfAborted();
   let entry=entries.get(key);const shared=Boolean(entry);let start=false;
   if(!entry){
    const size=64+bytes,tracked=entries.size<maxEntries&&size<=maxBytes-totalBytes;
    entry={key,bytes:size,tracked,controller:new AbortController(),subscribers:new Set(),settled:false};start=true;
    if(tracked){entries.set(key,entry);totalBytes+=size;}
   }
   const result=new Promise((resolve,reject)=>{
    const subscriber={resolve,reject,signal,shared,abort:null};
    subscriber.abort=()=>{
     if(!entry.subscribers.delete(subscriber))return;
     signal?.removeEventListener('abort',subscriber.abort);reject(signal.reason??new DOMException('Aborted','AbortError'));
     if(entry.subscribers.size===0&&!entry.settled){entry.settled=true;remove(entry);entry.controller.abort(signal.reason);}
    };
    entry.subscribers.add(subscriber);signal?.addEventListener('abort',subscriber.abort,{once:true});
    if(signal?.aborted)subscriber.abort();
   });
   if(start&&!entry.settled){
    try{Promise.resolve(producer({signal:entry.controller.signal})).then(value=>finish(entry,value,false),error=>finish(entry,error,true));}
    catch(error){finish(entry,error,true);}
   }
   return result;
  },
  stats(){return {entries:entries.size,bytes:totalBytes};},
 };
}
