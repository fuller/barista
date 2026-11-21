import fs from 'node:fs';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
if(fs.existsSync('.env'))process.loadEnvFile('.env');
process.env.REQUIRE_TURN_RATE_LIMIT='false';
if(!process.env.OPENROUTER_API_KEY)throw Error('OPENROUTER_API_KEY is required');
const port=Number(process.env.LIVE_VOICE_PORT??4185);
if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid LIVE_VOICE_PORT');
fs.mkdirSync('work/live-voice-smoke',{recursive:true});
const evidence={model:process.env.DECISION_MODEL??'perplexity/pplx-decider-v1.3:free',maxRequests:60,requestCount:0,budgetExceeded:false,requests:[]};
const output=`work/live-voice-smoke/provider-${Date.now()}-${randomUUID()}.json`,originalFetch=globalThis.fetch;
const save=()=>fs.writeFileSync(output,JSON.stringify(evidence,null,2)+'\n');
globalThis.fetch=async(input,options)=>{
 const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
 if(url.origin!=='https://openrouter.ai')return originalFetch(input,options);
 if(evidence.requestCount>=evidence.maxRequests){evidence.budgetExceeded=true;save();throw new Error('Benchmark provider budget exhausted');}
 const row={number:++evidence.requestCount,route:url.pathname,status:null,headersMs:null,completeMs:null,promptTokens:null,completionTokens:null,cost:null,error:null};
 evidence.requests.push(row);save();const start=performance.now();
 try{
  const response=await originalFetch(input,options);row.status=response.status;row.headersMs=performance.now()-start;save();
  void response.clone().json().then(body=>{
   const usage=body?.usage??body?.data?.usage;
   for(const [field,key] of [['promptTokens','prompt_tokens'],['completionTokens','completion_tokens'],['cost','cost']])if(typeof usage?.[key]==='number'&&Number.isFinite(usage[key])&&usage[key]>=0)row[field]=usage[key];
   row.completeMs=performance.now()-start;save();
  }).catch(()=>{row.completeMs=performance.now()-start;save();});
  return response;
 }catch(error){row.error=['AbortError','TimeoutError'].includes(error?.name)?error.name:'FetchError';row.completeMs=performance.now()-start;save();throw error;}
};
const {default:worker}=await import(pathToFileURL(`${process.cwd()}/dist/server/index.js`));
const server=http.createServer(async(req,res)=>{
 const controller=new AbortController();const abort=()=>{if(!res.writableFinished)controller.abort();};req.once('aborted',abort);res.once('close',abort);
 try{
  if(req.method==='GET'&&req.url==='/_benchmark/status'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({requestCount:evidence.requestCount,maxRequests:evidence.maxRequests,budgetExceeded:evidence.budgetExceeded,model:evidence.model,evidencePath:output}));return;}
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>65536){res.writeHead(413);res.end();return;}chunks.push(chunk);}
  const request=new Request(`http://127.0.0.1:${port}${req.url}`,{method:req.method,headers:req.headers,signal:controller.signal,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})});
  const response=await worker.fetch(request,process.env,{});if(!res.destroyed){res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}
 }catch{if(!res.destroyed){res.writeHead(500);res.end('Benchmark server unavailable');}}finally{req.off('aborted',abort);res.off('close',abort);}
});
server.listen(port,'127.0.0.1',()=>{save();console.log(`Real model benchmark server listening on http://127.0.0.1:${port}; provider evidence: ${output}`);});
for(const event of ['SIGINT','SIGTERM'])process.once(event,()=>server.close(()=>process.exit(0)));
