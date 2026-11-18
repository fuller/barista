import {pathToFileURL} from 'node:url';
import {createStarbucksGuestSource} from '../src/adapters/starbucks-guest-session.mjs';
import {buildStarbucksQuoteRequest,normalizeStarbucksQuote} from '../src/adapters/starbucks-quote-protocol.mjs';

const reasons=new Set(['RATE_LIMITED','UNAVAILABLE','TIMEOUT','ABORTED','INVALID_REQUEST','INVALID_RESPONSE','SESSION_LIMIT']);
/** One opt-in ordinary backend bootstrap and quote; never imports browser cookies. */
export async function probeGuestPricing({source=createStarbucksGuestSource({maxSessions:1})}={}){
 const sessionKey=crypto.randomUUID();
 try{
  const prepared=buildStarbucksQuoteRequest({storeNumber:'85278-313836',items:[{itemId:'probe',sku:'11183225',quantity:1}]});
  const envelope=await source.quote(sessionKey,prepared.body);
  const quote=normalizeStarbucksQuote(envelope,prepared);
  return {status:'available',storeNumber:quote.storeNumber,currency:quote.currency,subtotalCents:quote.subtotalCents,taxCents:quote.taxCents,totalCents:quote.totalCents};
 }catch(error){
  return {status:'unavailable',reason:reasons.has(error?.code)?error.code:'UNAVAILABLE',
   ...(Number.isInteger(error?.status)&&error.status>=400&&error.status<=599?{httpStatus:error.status}:{}),
   ...(Number.isSafeInteger(error?.retryAfterMs)&&error.retryAfterMs>=0&&error.retryAfterMs<=3600000?{retryAfterMs:error.retryAfterMs}:{})};
 }finally{try{source.clear(sessionKey);}catch{}}
}
export async function main(args=process.argv.slice(2),{probe=probeGuestPricing,output=console.log}={}){
 if(args.length!==1||args[0]!=='--live'){output('Usage: npm run pricing:probe -- --live (one real backend guest/quote attempt)');return 1;}
 const result=await probe();output(JSON.stringify(result,null,2));return result.status==='available'?0:2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)process.exitCode=await main();
