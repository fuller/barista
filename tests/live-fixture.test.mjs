import test from 'node:test';import assert from 'node:assert/strict';
import {createLiveFixtureHandler} from './live-fixture.mjs';
import {createOrder,applyCommands} from '../src/domain/order.mjs';
const request=body=>new Request('https://fixture.test/api/turn',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
test('explicit test-only fixture provides live-shaped config and correlated validated no-mode turn',async()=>{
 const fixture=createLiveFixtureHandler();assert.equal((await(await fixture(new Request('https://fixture.test/api/config'))).json()).liveAvailable,true);
 const result=await(await fixture(request({turnId:'fixture',baseRevision:0,text:'a grande iced latte with oat milk',order:createOrder()}))).json();assert.equal(result.turnId,'fixture');assert.equal(result.baseRevision,0);assert.equal(result.source,'test-fixture');assert.equal(applyCommands(createOrder(),result.commands).items[0].milk,'oat');
});
test('fixture rejects obsolete demo mode and invalid revisions through same validation',async()=>{
 const fixture=createLiveFixtureHandler(),body={turnId:'fixture',baseRevision:0,text:'a latte',order:createOrder()};assert.equal((await fixture(request({...body,mode:'demo'}))).status,400);assert.equal((await fixture(request({...body,baseRevision:9}))).status,400);
});
