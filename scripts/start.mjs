import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
const {default:worker}=await import(pathToFileURL(`${process.cwd()}/dist/server/index.js`));
const port=Number(process.env.PORT||4173);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT must be between 1 and 65535');
const server=createServer(async(req,res)=>{try{
 const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>65536){res.writeHead(413);res.end('Request too large');return;}chunks.push(chunk);}
 const request=new Request(`http://${req.headers.host}${req.url}`,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})});
 const response=await worker.fetch(request,process.env,{});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
}catch{res.writeHead(500);res.end('Server error');}});
server.listen(port,process.env.HOST||'127.0.0.1',()=>console.log(`Listening: http://${process.env.HOST||'127.0.0.1'}:${port}`));
for(const event of ['SIGINT','SIGTERM'])process.on(event,()=>server.close(()=>process.exit(0)));
