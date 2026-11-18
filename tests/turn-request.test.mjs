import test from 'node:test';
import assert from 'node:assert/strict';
import {createOrder,applyCommands} from '../src/domain/order.mjs';
import {validateTurnInput} from '../src/server/api.mjs';
import {buildTurnRequest} from '../src/application/turn-request.mjs';
const notes=['  Warm it, exactly as written  ','No lid ☕; keep "quotes" & <tags>'];
function longOrder(){
 let order=applyCommands(createOrder(),[{type:'add',productId:'latte'},{type:'add-menu',identity:'407:Hot',instructions:notes}]);
 for(let i=0;i<125;i++){
  order=applyCommands(order,[{type:'update-menu',itemId:order.menuItems[0].id,changes:{quantity:i%2+1}}]);
  if(i%25===0){order=applyCommands(order,[{type:'clear'}]);order=applyCommands(order,[{type:'add',productId:'latte'},{type:'add-menu',identity:'407:Hot',instructions:notes}]);}
 }
 return order;
}
test('long mixed cart transport retains current state and latest undo snapshot without mutating local history',()=>{
 const order=longOrder(),before=structuredClone(order),pending={originalText:'original',question:'Which?',revision:order.revision,answers:['yes'],targetIds:[order.menuItems[0].id]};
 const request=buildTurnRequest({turnId:'compact',text:'undo',order,pending,activeItemId:order.menuItems[0].id,mode:'live'});
 assert.ok(order.history.length>120);assert.deepEqual(order,before);
 assert.deepEqual(request,{turnId:'compact',baseRevision:order.revision,text:'undo',order:{...before,history:before.history.slice(-1)},pending,activeItemId:order.menuItems[0].id,mode:'live'});
 assert.deepEqual(request.order.menuItems[0].instructions,notes);
 assert.doesNotThrow(()=>validateTurnInput(JSON.parse(JSON.stringify(request))));
 request.order.menuItems[0].instructions.push('mutated');request.order.history[0].items.length=0;request.pending.answers.push('mutated');
 assert.deepEqual(order,before);assert.deepEqual(pending.answers,['yes']);
});
test('sending before every repeated undo preserves the complete client undo sequence',()=>{
 let order=longOrder(),count=order.history.length;
 while(order.history.length){
  const request=buildTurnRequest({turnId:'undo',text:'undo',order});
  validateTurnInput(request);
  const expected=order.history.at(-1),serverNext=applyCommands(request.order,[{type:'undo'}]);
  order=applyCommands(order,[{type:'undo'}]);
  assert.deepEqual(order.items,expected.items);assert.deepEqual(order.menuItems,expected.menuItems);
  assert.deepEqual(serverNext.items,order.items);assert.deepEqual(serverNext.menuItems,order.menuItems);
  assert.equal(order.history.length,--count);
 }
 assert.deepEqual(buildTurnRequest({turnId:'empty',text:'hello',order}).order.history,[]);
});
test('malformed discarded history and current cart are rejected before compaction',()=>{
 for(const mutate of [o=>{o.history[0].confirmed='invalid';},o=>{o.menuItems[0].quantity=0;},o=>{o.history=null;}]){
  const order=longOrder();mutate(order);assert.throws(()=>buildTurnRequest({turnId:'invalid',text:'hello',order}));
 }
});
test('request builder does not silently repair a mismatched explicit base revision',()=>{
 const order=createOrder();assert.throws(()=>buildTurnRequest({turnId:'invalid',baseRevision:99,text:'hello',order}));
});
