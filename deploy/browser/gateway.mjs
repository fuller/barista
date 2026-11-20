import {timingSafeEqual} from 'node:crypto';
import {Buffer} from 'node:buffer';
const routes=new Map([['/health','GET'],['/status','GET'],['/quote','POST'],['/clear','POST'],['/stores','POST']]);
export function admit(request,token){
 if(typeof token!=='string'||token.length<32||token.length>512)return 503;
 const expected=Buffer.from(`Bearer ${token}`),actual=Buffer.from(request.headers.get('authorization')??'');
 if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return 401;
 const url=new URL(request.url);
 if(url.search||routes.get(url.pathname)!==request.method)return 404;
 if(Number(request.headers.get('content-length'))>65536)return 413;
 return null;
}
export function createGateway(){return {async fetch(request,env){
 const status=admit(request,env.BARISTA_BROWSER_TOKEN);
 if(status)return Response.json({error:status===401?'unauthorized':'unavailable'},{status,headers:{'Cache-Control':'no-store'}});
 try{return await env.BROWSER.getByName('pricing').fetch(request);}catch{return Response.json({error:'unavailable'},{status:503,headers:{'Cache-Control':'no-store'}});}
}};}
export function createContainerProxy(ctx,env,{wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 let starting;
 async function ready(){
  const container=ctx.container;
  const version=env.VERSION?.id;
  if(typeof version!=='string'||!version)throw Error('Browser deployment version unavailable');
  const previousVersion=await ctx.storage.get('deploymentVersion');
  if(previousVersion!==version&&container.running)await container.destroy();
  if(!container.running)container.start({image:container.images.base,instance:'standard-1',enableInternet:true,env:{BARISTA_BROWSER_TOKEN:env.BARISTA_BROWSER_TOKEN,BARISTA_BROWSER_HOST:'0.0.0.0',BARISTA_BROWSER_PORT:'4174'}});
  if(previousVersion!==version)await ctx.storage.put('deploymentVersion',version);
  await container.setInactivityTimeout(15*60*1000);
  const port=container.getTcpPort(4174);
  for(let attempt=0;attempt<45;attempt++){
   const probeStarted=Date.now();
   try{const response=await port.fetch('http://container/health',{headers:{Authorization:`Bearer ${env.BARISTA_BROWSER_TOKEN}`},signal:AbortSignal.timeout(1000)});await response.body?.cancel();if(response.ok)return port;}catch{}
   await wait(Math.max(0,1000-(Date.now()-probeStarted)));
  }
  throw Error('Browser startup unavailable');
 }
 return {async fetch(request){
  const status=admit(request,env.BARISTA_BROWSER_TOKEN);if(status)return Response.json({error:'unavailable'},{status});
  starting??=ready().finally(()=>{starting=undefined;});
  const port=await starting;
  const url=new URL(request.url);url.protocol='http:';url.host='container';
  const forwarded=new Request(url,request);forwarded.headers.delete('host');
  const response=await port.fetch(forwarded);
  const headers=new Headers(response.headers);headers.set('Cache-Control','no-store');
  return new Response(response.body,{status:response.status,headers});
 }};
}
