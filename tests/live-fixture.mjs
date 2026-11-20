/** Test-server-only deterministic fixture. Never imported by production entries. */
import {createDemoAdapter as createDeterministicFixtureAdapter} from './support/demo.mjs';
import {interpretInput} from '../src/application/turns.mjs';
import {applyCommands} from '../src/domain/order.mjs';
import {validateTurnInput} from '../src/server/api.mjs';
import {fixtureStores} from './store-fixture-data.mjs';
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export function createLiveFixtureHandler(){
 const adapter=createDeterministicFixtureAdapter();
 return async request=>{
  const path=new URL(request.url).pathname;
  if(path==='/api/stores'&&request.method==='GET')return json({stores:fixtureStores});
  if(path==='/api/config'&&request.method==='GET')return json({provider:'test-fixture',model:'deterministic-test-only',liveAvailable:true,pricing:{zip:'11201',estimated:true,taxCalculated:false}});
  if(path!=='/api/turn')return null;
  if(request.method!=='POST')return json({error:'Method not allowed'},405);
  const origin=request.headers.get('Origin');if(origin&&origin!==new URL(request.url).origin)return json({error:'Origin not allowed'},403);
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'Use application/json'},415);
  try{
   const input=validateTurnInput(await request.json());
   const result=await interpretInput(input,adapter,{signal:request.signal});
   if(result.commands.length)applyCommands(input.order,result.commands);
   return json({turnId:input.turnId,baseRevision:input.baseRevision,...result,source:'test-fixture'});
  }catch(error){return json({error:error.status===409?error.message:'Test fixture could not interpret request'},error.status??400);}
 };
}
