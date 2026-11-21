export function createDecisionCache({ttlMs=300000,maxEntries=128,maxBytes=2*1024*1024,now=()=>Date.now(),clock=now}={}){
 if(!Number.isSafeInteger(ttlMs)||ttlMs<1||ttlMs>300000||!Number.isSafeInteger(maxEntries)||maxEntries<1||maxEntries>128||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>2*1024*1024||typeof clock!=='function')throw new Error('Invalid decision cache limits');
 const entries=new Map(),encoder=new TextEncoder();let bytes=0;
 const remove=key=>{const entry=entries.get(key);if(entry){bytes-=entry.bytes;entries.delete(key);}};
 const prune=()=>{const timestamp=clock();for(const [key,entry] of entries)if(entry.expiresAt<=timestamp)remove(key);};
 return {
  async keyFor(context,{signal}={}){
   signal?.throwIfAborted();
   const digest=await globalThis.crypto.subtle.digest('SHA-256',encoder.encode(JSON.stringify(context)));
   signal?.throwIfAborted();return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
  },
  get(key){
   const entry=entries.get(key);if(!entry)return undefined;
   if(entry.expiresAt<=clock()){remove(key);return undefined;}
   entries.delete(key);entries.set(key,entry);return JSON.parse(entry.serialized);
  },
  set(key,value){
   if(typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key))return false;
   let serialized;try{serialized=JSON.stringify(value);if(typeof serialized!=='string')return false;JSON.parse(serialized);}catch{return false;}
   const size=encoder.encode(key).byteLength+encoder.encode(serialized).byteLength;if(size>maxBytes)return false;
   prune();remove(key);
   while(entries.size>=maxEntries||bytes+size>maxBytes)remove(entries.keys().next().value);
   entries.set(key,{serialized,bytes:size,expiresAt:clock()+ttlMs});bytes+=size;return true;
  },
  delete:remove,
  clear(){entries.clear();bytes=0;},
  stats(){prune();return {entries:entries.size,bytes};},
 };
}
