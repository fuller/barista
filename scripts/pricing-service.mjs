import {existsSync} from 'node:fs';
import http from 'node:http';
import {createPricingServiceHandler} from '../src/services/pricing-api.mjs';
import {createStarbucksGuestSource} from '../src/adapters/starbucks-guest-session.mjs';
if(existsSync('.env'))process.loadEnvFile('.env');
const token=process.env.PRICING_SERVICE_TOKEN;
if(typeof token!=='string'||token.length<32||token.length>512)throw Error('PRICING_SERVICE_TOKEN must contain 32 to 512 characters');
const host=process.env.PRICING_SERVICE_HOST||'127.0.0.1';
const port=Number(process.env.PRICING_SERVICE_PORT||4174);
if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid PRICING_SERVICE_PORT');
if(process.argv.includes('--check')){const response=await fetch(`http://${host}:${port}/status`,{headers:{Authorization:`Bearer ${token}`}});if(!response.ok)throw Error('Pricing service unavailable');const status=await response.json();if(status?.transport!=='http')throw Error('Invalid pricing service status');console.log(JSON.stringify(status));}
else{
 const source=createStarbucksGuestSource();
 const handler=createPricingServiceHandler({token,source});
 const server=http.createServer(async(req,res)=>{
  try{
   const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>65536){res.writeHead(413);res.end();return;}chunks.push(chunk);}
   const request=new Request(`http://localhost${req.url}`,{method:req.method,headers:req.headers,...(req.method==='GET'||req.method==='HEAD'?{}:{body:Buffer.concat(chunks)})});
   const response=await handler(request);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.writeHead(503,{'Content-Type':'application/json'});res.end('{"error":"unavailable"}');}
 });
 server.requestTimeout=80000;server.headersTimeout=10000;server.maxConnections=16;
 server.listen(port,host,()=>console.log(`Pricing service listening on ${host}:${port}.`));
 const stop=()=>{server.close();void source.close().finally(()=>process.exit());};process.once('SIGINT',stop);process.once('SIGTERM',stop);
}
