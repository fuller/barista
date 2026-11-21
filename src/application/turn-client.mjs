import {buildTurnRequest} from './turn-request.mjs';

export async function requestTurn(input,{signal,fetchImpl=fetch,onTiming=()=>{}}={}){
 signal?.throwIfAborted();
 const request=buildTurnRequest(input),body=JSON.stringify(request);
 onTiming('fetchStart');
 const response=await fetchImpl('/api/turn',{method:'POST',headers:{'Content-Type':'application/json'},signal,body});
 signal?.throwIfAborted();onTiming('fetchHeaders');
 const data=await response.json();
 signal?.throwIfAborted();onTiming('responseParsed');
 if(!response.ok||data?.error)throw new Error(data?.error||'Request failed. Please try again.');
 if(data?.turnId!==request.turnId||data?.baseRevision!==request.baseRevision)throw new Error('Response did not match this order. Please try again.');
 if(!Array.isArray(data.commands))throw new Error('Invalid order response. Please try again.');
 return data;
}
