import test from 'node:test';import assert from 'node:assert/strict';
import {createMenuDeciderAdapter,buildMenuIdentityGroups} from '../src/adapters/menu-decider.mjs';
import {createOrder,applyCommands} from '../src/domain/order.mjs';
import directory from '../src/catalog/data/starbucks-menu-directory.json' with {type:'json'};
const pick=(name,type)=>directory.products.find(p=>p.name===name&&(!type||p.productType===type));
const pastry=pick('Butter Croissant'),beans=pick('Pike Place® Roast','Coffee'),coffee=pick('Caffè Americano');
function fixture({text,clauses=[text],plans=[],low,extractOverride,decisionOverride,questionProfile='lean-v8',boundaryChoices={}}={}){
 const requests=[];let index=0,currentPlan;
 const adapter=createMenuDeciderAdapter({apiKey:'fake-test-key',questionProfile,fetchImpl:async(url,init)=>{
  assert.equal(init.headers.Authorization,'Bearer fake-test-key');assert.equal(init.method,'POST');assert.equal(init.headers['Content-Type'],'application/json');assert.ok(url.startsWith('https://openrouter.ai/api/alpha/'));const body=JSON.parse(init.body);requests.push({url,body});
  if(url.endsWith('/extractions')){let from=0;const spans=clauses.map(c=>{const start=text.indexOf(c,from);assert.ok(start>=0);from=start+c.length;return [Array.from(text.slice(0,start)).length,Array.from(text.slice(0,from)).length];});return Response.json(extractOverride??{answers:{clauses:{type:'list',value:clauses,spans,confidence:.99}}});}
  if(Object.keys(body.questions).every(key=>/^b\d+$/.test(key))){const answers=Object.fromEntries(Object.entries(body.questions).map(([key,q])=>{const value=boundaryChoices[key]??(clauses.length>1?'split':'continue'),prob=low==='boundary'?.6:.99;return [key,{type:'choice',choice:value,probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k===value?prob:(1-prob)/2]))}];}));return Response.json({answers});}
  const plan=(Object.hasOwn(body.questions,'identity')||!Object.hasOwn(body.questions,'coverage')&&(Object.hasOwn(body.questions,'size')||Object.hasOwn(body.questions,'quantity')))?currentPlan:(currentPlan={coverage:'complete',targetScope:'item',replacementRequested:'absent',action:'add',identity:pastry.identity,target:'none',sizeRequested:'absent',size:'unchanged',quantityRequested:'absent',quantity:'1',singleAddQuantity:'detail',...plans[index++]});
  plan.productGroup=plan.identity==='unchanged'?'unchanged':buildMenuIdentityGroups(directory.products).find(g=>g.products.some(p=>p.identity===plan.identity)).id;
  const answers=Object.fromEntries(Object.entries(body.questions).map(([key,q])=>{const value=plan[key],keys=Object.keys(q.criteria),probability=low===key?.6:.98;assert.ok(keys.includes(value),key+': '+value);return [key,{type:'choice',choice:value,probabilities:Object.fromEntries(keys.map(k=>[k,k===value?probability:(1-probability)/(keys.length-1)]))}];}));
  return Response.json(decisionOverride??{answers});
 }});return {adapter,requests};
}
test('all directory identities offered and food instructions retained verbatim',async()=>{
 const text='Add a Butter Croissant warmed';const f=fixture({text});const before=createOrder(),result=await f.adapter.interpretTurn({text,order:before});const after=applyCommands(before,result.commands);assert.equal(after.menuItems[0].identity,pastry.identity);assert.deepEqual(after.menuItems[0].instructions,[text]);assert.equal(result.metrics.totalRequests,3);assert.ok(f.requests.every(r=>!r.body.questions||Object.values(r.body.questions).every(q=>Object.keys(q.criteria).length<=255)));const selected=f.requests.find(r=>r.body.questions?.identity);assert.ok(Object.hasOwn(selected.body.questions.identity.criteria,pastry.identity));assert.equal(typeof f.requests[0].body.state,'string');assert.equal(before.menuItems?.length??0,0);
});
test('coffee beans and beverage are selectable without profile allowlist',async()=>{
 const text='Pike Place beans and an American with oat milk',clauses=['Pike Place beans','an American with oat milk'];const f=fixture({text,clauses,plans:[{identity:beans.identity},{identity:coffee.identity}]});const before=createOrder(),result=await f.adapter.interpretTurn({text,order:before});const after=applyCommands(before,result.commands);assert.deepEqual(after.menuItems.map(p=>p.identity),[beans.identity,coffee.identity]);assert.deepEqual(after.menuItems[1].instructions,['and '+clauses[1]]);assert.equal(after.revision,before.revision+1);assert.equal(result.metrics.totalRequests,7);
});
test('source sizes and item counts validated independently of modifier quantities',async()=>{
 const text='Two grande Americanos with three pumps vanilla';const f=fixture({text,plans:[{identity:coffee.identity,sizeRequested:'requested',size:coffee.sizes[1].sizeCode,quantityRequested:'requested',quantity:'2'}]});const r=await f.adapter.interpretTurn({text,order:createOrder()});assert.equal(r.commands[0].quantity,2);assert.deepEqual(r.commands[0].instructions,[text]);
});
test('later ambiguous clause returns zero commands for entire utterance',async()=>{
 const text='a croissant and a coffee',f=fixture({text,clauses:['a croissant','a coffee'],plans:[{}, {coverage:'unclear'}]});const r=await f.adapter.interpretTurn({text,order:createOrder()});assert.deepEqual(r.commands,[]);assert.ok(r.clarification);
});
test('low confidence identity cannot mutate or substitute',async()=>{
 const text='a croissant',f=fixture({text,low:'identity'});const r=await f.adapter.interpretTurn({text,order:createOrder()});assert.deepEqual(r.commands,[]);assert.ok(r.clarification);
});
test('invalid source size for selected item is not committed',async()=>{
 const text='a venti croissant',f=fixture({text,plans:[{sizeRequested:'requested',size:'__source_invalid__'}]});const r=await f.adapter.interpretTurn({text,order:createOrder()});assert.deepEqual(r.commands,[]);assert.equal(r.diagnostics.reason,'unsupported_catalog_choice');
});
test('malformed speculative answer remains protocol failure even absent',async()=>{
 const text='a croissant',f=fixture({text,decisionOverride:{answers:{}}});await assert.rejects(()=>f.adapter.interpretTurn({text,order:createOrder()}),/Invalid decision/);
});
test('duplicate retains full requested clause and explicit edits on new menu line',async()=>{
 const order=applyCommands(createOrder(),[{type:'add-menu',identity:coffee.identity,instructions:['original request']}]);const target=order.menuItems[0],text='Duplicate the first item with oat milk';const f=fixture({text,plans:[{action:'duplicate',identity:'unchanged',target:target.id,quantityRequested:'requested',quantity:'2'}]});const r=await f.adapter.interpretTurn({text,order});const after=applyCommands(order,r.commands);assert.equal(after.menuItems.length,2);assert.equal(after.menuItems[1].quantity,2);assert.deepEqual(after.menuItems[1].instructions,['original request',text]);assert.deepEqual(order.menuItems[0].instructions,['original request']);
});
test('update appends literal request; ambiguous target leaves original cart untouched',async()=>{
 const order=applyCommands(createOrder(),[{type:'add-menu',identity:pastry.identity,instructions:['original']}]),target=order.menuItems[0],text='Make the first item warmed';const f=fixture({text,plans:[{action:'update',identity:'unchanged',target:target.id}]});const r=await f.adapter.interpretTurn({text,order});assert.deepEqual(applyCommands(order,r.commands).menuItems[0].instructions,['original',text]);const ambiguous=fixture({text,plans:[{action:'update',identity:'unchanged'}]});assert.deepEqual((await ambiguous.adapter.interpretTurn({text,order})).commands,[]);
});
test('remove supports legacy targets while unsafe legacy update asks for controls',async()=>{
 const order=applyCommands(createOrder(),[{type:'add',productId:'latte'}]),target=order.items[0];for(const action of ['remove','update']){const text=action+' the first item',f=fixture({text,plans:[{action,identity:'unchanged',target:target.id}]});const r=await f.adapter.interpretTurn({text,order});if(action==='remove')assert.equal(applyCommands(order,r.commands).items.length,0);else assert.deepEqual(r.commands,[]);}
});

test('identity hierarchy reaches every source row with bounded choices including future large groups',()=>{for(const rows of [directory.products,Array.from({length:5000},(_,i)=>({identity:String(i),productType:'Beverage'})),Array.from({length:5000},(_,i)=>({identity:String(i),productType:String(i)}))]){const groups=buildMenuIdentityGroups(rows);assert.ok(groups.length+1<=255);assert.ok(groups.every(g=>g.products.length+1<=255));assert.deepEqual(groups.flatMap(g=>g.products.map(p=>p.identity)).sort(),rows.map(p=>p.identity).sort());}});
test('explicit base replacement changes trusted identity while modifier-only updates skip identity packet',async()=>{
 const order=applyCommands(createOrder(),[{type:'add-menu',identity:coffee.identity,size:'Grande',instructions:['original Americano']}]),target=order.menuItems[0];
 const text='Change the first Americano to a Butter Croissant',f=fixture({text,plans:[{action:'update',replacementRequested:'requested',identity:pastry.identity,target:target.id}]});const r=await f.adapter.interpretTurn({text,order});const after=applyCommands(order,r.commands);assert.equal(after.menuItems[0].identity,pastry.identity);assert.equal(after.menuItems[0].name,pastry.name);assert.equal(after.menuItems[0].size,null);assert.deepEqual(after.menuItems[0].instructions,['original Americano',text]);assert.equal(f.requests.filter(r=>r.body.questions?.identity).length,1);
 const modifier='Make the first item with oat milk',g=fixture({text:modifier,plans:[{action:'update',identity:'unchanged',target:target.id}]});assert.equal((await g.adapter.interpretTurn({text:modifier,order})).clarification,null);assert.equal(g.requests.filter(r=>r.body.questions?.identity).length,0);
});
test('nonboolean truncation markers fail protocol before mutation',async()=>{
 const text='a croissant',f=fixture({text,decisionOverride:{truncated:'true',answers:{}}});await assert.rejects(()=>f.adapter.interpretTurn({text,order:createOrder()}),/Invalid decision truncation/);
});
test('new additions use confident default count without an irrelevant count-change gate',async()=>{
 const text='a croissant',f=fixture({text,low:'quantityRequested',plans:[{quantity:'1'}]});const result=await f.adapter.interpretTurn({text,order:createOrder()});assert.equal(result.clarification,null);assert.equal(result.commands[0].quantity,1);
 const bad=fixture({text,low:'quantity',plans:[{quantity:'1'}]});assert.deepEqual((await bad.adapter.interpretTurn({text,order:createOrder()})).commands,[]);
});
test('global or remove actions cannot silently discard explicitly requested edits',async()=>{
 const order=applyCommands(createOrder(),[{type:'add-menu',identity:pastry.identity}]),target=order.menuItems[0];
 for(const action of ['remove','undo','clear','confirm'])for(const field of ['sizeRequested','quantityRequested','replacementRequested']){
  const text=action+' the item but change it',f=fixture({text,plans:[{action,identity:'unchanged',target:target.id,[field]:'requested'}]});const result=await f.adapter.interpretTurn({text,order});assert.deepEqual(result.commands,[]);assert.equal(result.diagnostics.reason,'conflicting_instructions');assert.equal(order.menuItems.length,1);
 }
});
test('uncertain irrelevant gates do not block pure remove/global actions',async()=>{
 const order=applyCommands(createOrder(),[{type:'add-menu',identity:pastry.identity}]),target=order.menuItems[0];for(const action of ['remove','undo','clear','confirm']){
  const text=action+' the item',f=fixture({text,plans:[{action,identity:'unchanged',target:target.id,sizeRequested:'uncertain',quantityRequested:'uncertain',replacementRequested:'uncertain'}]});const result=await f.adapter.interpretTurn({text,order});assert.equal(result.clarification,null);assert.equal(result.commands[0].type,action);
 }
});
test('ingredient removal updates notes without deleting its item',async()=>{
 const order=applyCommands(createOrder(),[{type:'add-menu',identity:coffee.identity,instructions:['with whipped cream']}]),target=order.menuItems[0],text='Remove the whipped cream from the first item';const f=fixture({text,plans:[{action:'update',identity:'unchanged',target:target.id}]});const result=await f.adapter.interpretTurn({text,order});const after=applyCommands(order,result.commands);assert.equal(after.menuItems.length,1);assert.equal(result.commands[0].type,'update-menu');assert.deepEqual(after.menuItems[0].instructions,['with whipped cream',text]);assert.match(f.requests[0].body.questions.action.instructions,/REMOVE means delete the ENTIRE cart item only/);
});
test('spoken trenti selects exact Trenta source size without rewriting source notes',async()=>{
 const cold=directory.products.find(p=>p.knownProductId==='cold-brew'),text='one trenti cold brew';assert.ok(cold);const f=fixture({text,plans:[{identity:cold.identity,sizeRequested:'requested',size:'Trenta',quantity:'1'}]});const result=await f.adapter.interpretTurn({text,order:createOrder()});assert.equal(result.commands[0].size,'Trenta');assert.deepEqual(result.commands[0].instructions,[text]);
});
test('undo decision sees history availability and does not require product or replacement identity',async()=>{
 const order=applyCommands(createOrder(),[{type:'add-menu',identity:pastry.identity}]),text='undo';const f=fixture({text,plans:[{action:'undo',identity:'unchanged',target:'none',replacementRequested:'uncertain'}]});const result=await f.adapter.interpretTurn({text,order});assert.equal(JSON.parse(f.requests[0].body.state).historyAvailable,true);assert.equal(result.commands[0].type,'undo');assert.match(f.requests[0].body.questions.coverage.instructions,/undo is eligible when historyAvailable is true/);assert.equal(applyCommands(order,result.commands).menuItems?.length??0,0);
});
test('removing ice is explicitly a customization update, not base replacement',async()=>{
 const order=applyCommands(createOrder(),[{type:'add-menu',identity:coffee.identity}]),text='remove ice from the first item',f=fixture({text,plans:[{action:'update',identity:'unchanged',target:order.menuItems[0].id}]});const result=await f.adapter.interpretTurn({text,order});assert.equal(result.commands[0].type,'update-menu');assert.equal(f.requests.length,1);assert.match(f.requests[0].body.questions.replacementRequested.instructions,/customization NEVER replaces the base identity/);
});
test('identity leaf sees only its owning clause and branch menu, not other clauses',async()=>{
 const text='Pike Place beans and an American with oat milk',clauses=['Pike Place beans','an American with oat milk'],f=fixture({text,clauses,plans:[{identity:beans.identity},{identity:coffee.identity}]});const result=await f.adapter.interpretTurn({text,order:createOrder()});assert.equal(result.clarification,null);const leaves=f.requests.filter(r=>r.body.questions?.identity);assert.equal(leaves.length,2);for(const [i,request] of leaves.entries()){const state=JSON.parse(request.body.state);assert.equal(state.transcript,i===0?clauses[i]+' ':'and '+clauses[i]);assert.equal(Object.hasOwn(state,'fullTranscript'),false);assert.equal(Object.hasOwn(state,'cart'),false);assert.deepEqual(Object.keys(state).sort(),['transcript']);}
});
test('lean low-confidence identity remains rejected and update instructions stay complete',async()=>{
 const text='a croissant',low=fixture({text,questionProfile:'lean-v8',low:'identity'});assert.deepEqual((await low.adapter.interpretTurn({text,order:createOrder()})).commands,[]);
 const order=applyCommands(createOrder(),[{type:'add-menu',identity:coffee.identity,instructions:['one Americano']}]),target=order.menuItems[0],update='Make the first item with oat milk';const f=fixture({text:update,questionProfile:'lean-v8',plans:[{action:'update',identity:'unchanged',target:target.id}]});const result=await f.adapter.interpretTurn({text:update,order});assert.deepEqual(result.commands[0].changes.instructions,['one Americano',update]);const state=JSON.parse(f.requests[0].body.state);assert.deepEqual(state.cart,[{id:target.id,name:target.name,identity:target.identity,size:target.size,quantity:target.quantity,instructions:target.instructions}]);assert.equal(Object.hasOwn(state,'history'),false);
});
test('question profile rejects unknown values',()=>{
 assert.throws(()=>createMenuDeciderAdapter({apiKey:'fake',questionProfile:'invented'}),/question profile/);
});
test('lean-v8 confidently absent update/duplicate counts preserve copies and skip numeric detail',async()=>{
 const order=applyCommands(createOrder(),[{type:'add-menu',identity:coffee.identity,quantity:3}]),target=order.menuItems[0];for(const action of ['update','duplicate']){const text=action+' the first item with oat milk',f=fixture({text,questionProfile:'lean-v8',plans:[{action,identity:'unchanged',target:target.id,quantityRequested:'absent'}]});const result=await f.adapter.interpretTurn({text,order});assert.equal(result.clarification,null);assert.equal(f.requests.length,1);assert.equal(f.requests.some(r=>r.body.questions?.quantity),false);assert.equal(applyCommands(order,result.commands).menuItems.at(-1).quantity,3);}
});
test('lean-v8 unclear applicability fails atomically and explicit count still requires confident canonical value',async()=>{
 const order=applyCommands(createOrder(),[{type:'add-menu',identity:coffee.identity,quantity:3}]),target=order.menuItems[0];for(const gate of ['uncertain','requested']){const text='make the first item two copies',f=fixture({text,questionProfile:'lean-v8',low:gate==='requested'?'quantity':undefined,plans:[{action:'update',identity:'unchanged',target:target.id,quantityRequested:gate,quantity:'2'}]});const result=await f.adapter.interpretTurn({text,order});assert.deepEqual(result.commands,[]);assert.equal(f.requests.length,gate==='uncertain'?1:2);}
});
test('lean-v8 absent copy count with explicit size resolves size only',async()=>{
 const order=applyCommands(createOrder(),[{type:'add-menu',identity:coffee.identity,quantity:3}]),text='make the first item Tall',f=fixture({text,questionProfile:'lean-v8',plans:[{action:'update',identity:'unchanged',target:order.menuItems[0].id,quantityRequested:'absent',sizeRequested:'requested',size:'Tall'}]});const result=await f.adapter.interpretTurn({text,order});assert.equal(result.clarification,null);assert.equal(f.requests.length,2);assert.deepEqual(Object.keys(f.requests[1].body.questions),['size']);const after=applyCommands(order,result.commands);assert.equal(after.menuItems[0].quantity,3);assert.equal(after.menuItems[0].size,'Tall');
});
test('lean-v8 requested mixed relative copies remain unsupported and contradictory preserve answers reject',async()=>{
 const order=applyCommands(createOrder(),[{type:'add-menu',identity:coffee.identity,quantity:1},{type:'add-menu',identity:pastry.identity,quantity:3}]);for(const operation of ['relative','preserve']){const text='change both copy counts',f=fixture({text,questionProfile:'lean-v8',plans:[{action:'update',identity:'unchanged',targetScope:'all_cart',quantityRequested:'requested',quantityOperation:operation,quantity:'2'}]});const result=await f.adapter.interpretTurn({text,order});assert.deepEqual(result.commands,[]);assert.equal(result.diagnostics.field,'quantity');}
});
test('lean-v8 shared customization with absent count skips mixed numeric detail',async()=>{
 const order=applyCommands(createOrder(),[{type:'add-menu',identity:coffee.identity,quantity:1},{type:'add-menu',identity:pastry.identity,quantity:3}]),text='both with oat milk',f=fixture({text,questionProfile:'lean-v8',plans:[{action:'update',identity:'unchanged',targetScope:'all_cart',quantityRequested:'absent'}]});const result=await f.adapter.interpretTurn({text,order});assert.equal(result.clarification,null);assert.equal(f.requests.length,1);assert.deepEqual(applyCommands(order,result.commands).menuItems.map(p=>p.quantity),[1,3]);
});
test('lean-v8 preserves absent update single request and canonical unchanged quantity choices',async()=>{
 const order=applyCommands(createOrder(),[{type:'add-menu',identity:coffee.identity,quantity:3}]),target=order.menuItems[0];
 for(const quantityRequested of ['absent','requested']){const text='make first item with oat milk',f=fixture({text,questionProfile:'lean-v8',plans:[{action:'update',identity:'unchanged',target:target.id,quantityRequested,quantity:'unchanged'}]});const result=await f.adapter.interpretTurn({text,order});assert.equal(result.clarification,null);assert.equal(f.requests.length,quantityRequested==='absent'?1:2);assert.equal(applyCommands(order,result.commands).menuItems[0].quantity,3);if(quantityRequested==='requested'){const criteria=f.requests.at(-1).body.questions.quantity.criteria;assert.ok(Object.hasOwn(criteria,'unchanged'));assert.match(criteria.unchanged,/explicit final count of 3/);assert.equal(Object.hasOwn(criteria,'3'),false);}}
});
test('lean-v8 uncertain applicability and low-confidence or unclear quantity fail atomically',async()=>{
 const order=applyCommands(createOrder(),[{type:'add-menu',identity:coffee.identity,quantity:3}]),target=order.menuItems[0],before=JSON.stringify(order);
 for(const [quantityRequested,quantity,low] of [['uncertain','2',undefined],['requested','2','quantity'],['requested','unclear',undefined]]){const text='make first item two copies',f=fixture({text,questionProfile:'lean-v8',low,plans:[{action:'update',identity:'unchanged',target:target.id,quantityRequested,quantity}]});const result=await f.adapter.interpretTurn({text,order});assert.deepEqual(result.commands,[]);assert.ok(result.clarification);assert.equal(JSON.stringify(order),before);}
});
test('lean-v9 eligible beverage single ADD uses two calls with source size resolution when explicit',async()=>{
 for(const text of ['Americano','an Americano','one Americano','one Tall Americano']){const sized=text.includes('Tall'),f=fixture({text,questionProfile:'lean-v9',plans:[{identity:coffee.identity,singleAddQuantity:'single',quantityRequested:'requested',quantity:'1',sizeRequested:sized?'requested':'absent',size:'Tall'}]});const result=await f.adapter.interpretTurn({text,order:createOrder()});assert.equal(result.clarification,null);assert.equal(result.commands[0].quantity,1);assert.equal(f.requests.length,sized?3:2);assert.equal(!!f.requests[0].body.questions.singleAddQuantity,!sized);assert.equal(f.requests.some(r=>r.body.questions.quantity),sized);if(sized)assert.deepEqual(Object.keys(f.requests.at(-1).body.questions),['quantity','size']);}
});
test('lean-v9 eligible uncertain classifier falls back without lowering final quantity confidence',async()=>{
 for(const [singleAddQuantity,low,success] of [['detail',undefined,true],['single','singleAddQuantity',true],['detail','quantity',false]]){const text='one Americano',f=fixture({text,questionProfile:'lean-v9',low,plans:[{identity:coffee.identity,singleAddQuantity,quantity:'1'}]});const result=await f.adapter.interpretTurn({text,order:createOrder()});assert.equal(result.clarification===null,success);assert.equal(f.requests.length,3);if(success)assert.equal(result.commands[0].quantity,1);else assert.deepEqual(result.commands,[]);}
});
test('lean-v9 optional beverage classifier keeps quantity gate equal to v8 and disambiguates numeric language',async()=>{
 const packets=[];for(const questionProfile of ['lean-v8','lean-v9']){const text='one Americano',f=fixture({text,questionProfile,plans:[{identity:coffee.identity,quantityRequested:'requested',quantity:'1'}]});await f.adapter.interpretTurn({text,order:createOrder()});packets.push(f.requests[0].body.questions);}assert.deepEqual(packets[1].quantityRequested,packets[0].quantityRequested);assert.deepEqual(Object.keys(packets[1]).filter(k=>k!=='singleAddQuantity'),Object.keys(packets[0]));const q=packets[1].singleAddQuantity;assert.deepEqual(Object.keys(q.criteria),['single','detail']);for(const pattern of [/12-count/,/pounds/,/pumps/,/ordinal/,/final/,/one of each/])assert.match(q.instructions,pattern);
});
test('lean-v9 fast beverage path preserves identity and size validation',async()=>{
 for(const [low,size] of [['identity','Tall'],['size','Tall'],[undefined,'__source_invalid__']]){const text='one Tall Americano',f=fixture({text,questionProfile:'lean-v9',low,plans:[{identity:coffee.identity,singleAddQuantity:'single',quantity:'1',sizeRequested:'requested',size}]});const result=await f.adapter.interpretTurn({text,order:createOrder()});assert.deepEqual(result.commands,[]);assert.ok(result.clarification);}
});
test('lean-v9 noneligible food, package, nonempty cart and shared clauses send exact v8 packets',async()=>{
 const populated=applyCommands(createOrder(),[{type:'add-menu',identity:coffee.identity,quantity:3}]);
 const cases=[{text:'one Tall Americano',plans:[{identity:coffee.identity,quantity:'1',sizeRequested:'requested',size:'Tall'}]},{text:'one 12-ounce Americano',plans:[{identity:coffee.identity,quantity:'1'}]},{text:'instant Pike Place',plans:[{identity:beans.identity,quantity:'1'}]},{text:'one croissant',plans:[{quantity:'1'}]}, {text:'a one-pound Pike Place roast',plans:[{identity:beans.identity,quantity:'1',sizeRequested:'requested',size:beans.sizes[0].sizeCode}]},{text:'one Americano',order:populated,plans:[{identity:coffee.identity,quantity:'1'}]},{text:'first item with oat milk',order:populated,plans:[{action:'update',identity:'unchanged',target:populated.menuItems[0].id,quantityRequested:'absent'}]},{text:'one croissant and one Americano',boundaryChoices:{b0:'split'},plans:[{quantity:'1'},{identity:coffee.identity,quantity:'1'}]},{text:'one Americano and one croissant both with oat milk',boundaryChoices:{b0:'split',b1:'split'},plans:[{identity:coffee.identity,quantity:'1'},{quantity:'1'},{action:'update',identity:'unchanged',targetScope:'all_cart',quantityRequested:'absent'}]}];
 for(const input of cases){const runs=[];for(const questionProfile of ['lean-v8','lean-v9']){const f=fixture({...input,questionProfile});const result=await f.adapter.interpretTurn({text:input.text,order:input.order??createOrder()});assert.equal(result.clarification,null);runs.push({f,result});}assert.deepEqual(runs[1].f.requests,runs[0].f.requests);assert.deepEqual(runs[1].result.commands,runs[0].result.commands);}
});
test('lean-v9 non-single beverage counts still require selected-product detail',async()=>{
 for(const text of ['two Americanos','one more Americano','one of each Americano']){const f=fixture({text,questionProfile:'lean-v9',plans:[{identity:coffee.identity,singleAddQuantity:'detail',quantityRequested:'requested',quantity:'2'}]});const result=await f.adapter.interpretTurn({text,order:createOrder()});assert.equal(result.clarification,null);assert.equal(result.commands[0].quantity,2);assert.ok(f.requests.some(r=>r.body.questions.quantity));}
});

test('retained profiles preserve established wire packets across add, size, scope and duplicate',async()=>{
 const {createHash}=await import('node:crypto');
 const order=applyCommands(createOrder(),[{type:'add-menu',identity:coffee.identity,quantity:3},{type:'add-menu',identity:pastry.identity,quantity:2}]);
 const cases=[{text:'one Americano',plans:[{identity:coffee.identity,quantity:'1',singleAddQuantity:'single'}]},{text:'two Tall Americanos',plans:[{identity:coffee.identity,sizeRequested:'requested',size:'Tall',quantityRequested:'requested',quantity:'2'}]},{text:'a one-pound Pike Place roast',plans:[{identity:beans.identity,quantity:'1'}]},{text:'both with oat milk',order,plans:[{action:'update',identity:'unchanged',targetScope:'all_cart',quantityRequested:'absent'}]},{text:'duplicate the first item',order,plans:[{action:'duplicate',target:order.menuItems[0].id,quantityRequested:'absent'}]}];
 for(const questionProfile of ['lean-v8','lean-v9']){const packets=[];for(const c of cases){const f=fixture({...c,questionProfile});const result=await f.adapter.interpretTurn({text:c.text,order:c.order??createOrder()});assert.equal(result.clarification,null);packets.push(f.requests);}const hash=createHash('sha256').update(JSON.stringify(packets)).digest('hex');assert.equal(hash,{'lean-v8':'28cf5062f6f5f409f2b44c77d3f1c378f9842051885709e4300a272889f4ca99','lean-v9':'a27fa30812f44fa642601d06b067bfc029f647e78bdc10e7def96756825ef2ba'}[questionProfile]);}
});

test('lean-v10 preserves v9 questions and all cart context while compacting repeated field names',async()=>{
 const seed=Array.from({length:8},(_,i)=>({type:'add-menu',identity:i%2?coffee.identity:pastry.identity,quantity:i+1,instructions:[`original request ${i}`,i%2?'oat milk':'warmed ☕']}));
 const order=applyCommands(createOrder(),seed),before=structuredClone(order),text='Remove the seventh item';
 const results=[];
 for(const questionProfile of ['lean-v9','lean-v10']){
  const f=fixture({text,questionProfile,plans:[{action:'remove',identity:'unchanged',target:order.menuItems[6].id}]});
  const result=await f.adapter.interpretTurn({text,order});results.push({result,body:f.requests[0].body});
 }
 assert.deepEqual(results[1].result.commands,results[0].result.commands);
 assert.equal(results[1].result.clarification,null);
 assert.deepEqual(Object.keys(results[1].body.questions),Object.keys(results[0].body.questions));
 for(const key of Object.keys(results[0].body.questions))assert.deepEqual(Object.keys(results[1].body.questions[key].criteria),Object.keys(results[0].body.questions[key].criteria));
 const oldState=JSON.parse(results[0].body.state),newState=JSON.parse(results[1].body.state);
 const {columns,rows}=newState.cart;
 newState.cart=rows.map(row=>Object.fromEntries(columns.map((key,i)=>[key,row[i]])));
 assert.deepEqual(newState,oldState);assert.deepEqual(order,before);
 assert.ok(results[1].body.state.length<results[0].body.state.length);
});
test('lean-v10 empty-cart context and candidate sets remain identical to lean-v9',async()=>{
 const bodies=[];
 for(const questionProfile of ['lean-v9','lean-v10']){
  const f=fixture({text:'a latte',questionProfile,plans:[{identity:'407:Hot',singleAddQuantity:'single'}]});
  await f.adapter.interpretTurn({text:'a latte',order:createOrder()});bodies.push(f.requests.map(r=>r.body));
 }
 assert.equal(bodies[1].length,bodies[0].length);
 for(let i=0;i<bodies[0].length;i++){assert.equal(bodies[1][i].state,bodies[0][i].state);for(const key of Object.keys(bodies[0][i].questions))assert.deepEqual(Object.keys(bodies[1][i].questions[key].criteria),Object.keys(bodies[0][i].questions[key].criteria));}
});

test('lean-v10 resolves uncertain applicability with confident selected-product detail, never weaker thresholds',async()=>{
 const text='one 12-count box of VIA Pike Place';
 const f=fixture({text,questionProfile:'lean-v10',low:'sizeRequested',plans:[{identity:'24:VIA',size:'12-count'}]});
 const result=await f.adapter.interpretTurn({text,order:createOrder()});assert.equal(result.clarification,null);assert.equal(result.commands[0].size,'12-count');
 assert.ok(f.requests.find(r=>r.body.questions.size)?.body.questions.size.criteria.unchanged);
 const order=applyCommands(createOrder(),[{type:'add-menu',identity:coffee.identity,quantity:3}]),change='make the first one oat milk';
 const g=fixture({text:change,questionProfile:'lean-v10',low:'quantityRequested',plans:[{action:'update',identity:'unchanged',target:order.menuItems[0].id,quantity:'unchanged'}]});
 const updated=await g.adapter.interpretTurn({text:change,order});assert.equal(updated.clarification,null);assert.equal(applyCommands(order,updated.commands).menuItems[0].quantity,3);
 const h=fixture({text,questionProfile:'lean-v10',low:'size',plans:[{identity:'24:VIA',sizeRequested:'uncertain',size:'12-count'}]});
 assert.deepEqual((await h.adapter.interpretTurn({text,order:createOrder()})).commands,[]);
});

test('v10 package and correction instructions survive final packet construction',async()=>{
 const f=fixture({text:'one Americano',questionProfile:'lean-v10',plans:[{identity:'406:Hot',singleAddQuantity:'single'}]});
 await f.adapter.interpretTurn({text:'one Americano',order:createOrder()});
 const q=f.requests.find(r=>r.body.questions.coverage).body.questions;
 assert.match(q.sizeRequested.instructions,/package contents such as 12-count/);
 assert.match(q.sizeRequested.instructions,/final explicitly corrected size/);
 assert.match(q.quantityRequested.instructions,/final explicit count correction/);
 assert.match(q.action.criteria.update,/set final copy count/);
});
