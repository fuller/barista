import {existsSync} from 'node:fs';
import http from 'node:http';
import {createBrowserPricingHandler} from '../src/browser/pricing-service.mjs';
import {createHeadedTransport} from '../src/browser/headed-transport.mjs';
if(existsSync('.env'))process.loadEnvFile('.env');
const token=process.env.BARISTA_BROWSER_TOKEN;
if(typeof token!=='string'||token.length<32)throw Error('BARISTA_BROWSER_TOKEN must contain at least 32 characters');
const host=process.env.BARISTA_BROWSER_HOST||'127.0.0.1';
const port=Number(process.env.BARISTA_BROWSER_PORT||4174);
if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid BARISTA_BROWSER_PORT');
if(process.argv.includes('--check')){const response=await fetch(`http://${host}:${port}/status`,{headers:{Authorization:`Bearer ${token}`}});if(!response.ok)throw Error('Browser service unavailable');const status=await response.json();console.log(JSON.stringify(status));process.exitCode=status.ready?0:2;}
else{
 const transport=await createHeadedTransport();
 const handler=createBrowserPricingHandler({token,transport});
 const server=http.createServer(async(req,res)=>{
  try{
   const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>65536){res.writeHead(413);res.end();return;}chunks.push(chunk);}
   const request=new Request(`http://localhost${req.url}`,{method:req.method,headers:req.headers,...(req.method==='GET'||req.method==='HEAD'?{}:{body:Buffer.concat(chunks)})});
   const response=await handler(request);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.writeHead(503,{'Content-Type':'application/json'});res.end('{"error":"unavailable"}');}
 });
 server.requestTimeout=80000;server.headersTimeout=10000;server.maxConnections=16;
 server.listen(port,host,()=>console.log(`Browser pricing listening on ${host}:${port}. Guest UI setup required; authenticated GET /status reports readiness.`));
 const stop=()=>{server.close();void transport.close().finally(()=>process.exit());};process.once('SIGINT',stop);process.once('SIGTERM',stop);
}
