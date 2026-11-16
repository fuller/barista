import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeItems,gradeTurn} from '../evals/grader.mjs';

// Hand-written oracle: no recipe/default/pricing imports generate expectations.
const latte={
 productId:'latte',size:'grande',temperature:'hot',milk:'2%',shots:2,
 caffeine:'regular',roast:'signature',shotStyle:'standard',heat:'standard',
 milkAmount:'regular',milkPreparation:'standard',milkFoam:'regular',water:'none',
 ice:'none',preparation:'standard',room:'none',cupSize:'standard',
 coldFoam:{id:'none',amount:'none'},syrups:[],sauces:[],sweeteners:[],
 inclusions:[],toppings:[],onSide:[],quantity:1,syrup:'none',pumps:0,
 decaf:false,whip:false
};
const clone=value=>structuredClone(value);
const business=(changes={})=>({...clone(latte),...clone(changes)});
const item=(changes={},id='drink-1')=>({...business(changes),id,explicit:[]});
const order=(items=[],revision=0)=>({
 catalogVersion:'legacy-sample-v1',revision,items:clone(items),confirmed:false,
 history:[],nextId:Math.max(0,...items.map(i=>Number(i.id.slice(6))))+1
});
const metrics={extractionRequests:1,decisionRequests:1,totalRequests:2,clauseCount:1,
 strategy:'single',extractionMs:1,decisionMs:1,totalMs:2};
const applied={commands:[{type:'add',productId:'latte'}],clarification:null};
const clarified={commands:[],clarification:'Which milk would you like?'};
const expected=(changes={})=>({outcome:'applied',items:[business()],confirmed:false,subtotalCents:525,...clone(changes)});
const fixture=(changes={})=>({before:order(),after:order([item()],1),result:clone(applied),expected:expected(),metrics:clone(metrics),maxRequests:2,...changes});
const has=(grade,code,path)=>grade.failures.some(f=>f.code===code&&(path===undefined||f.path===path));

test('correct full business state and explicit request budget pass',()=>{
 const grade=gradeTurn(fixture());
 assert.deepEqual(grade,{pass:true,failures:[],outcome:'applied',unsafeMutation:false,incorrectAppliedMutation:false,unnecessaryClarification:false,budgetExceeded:false});
});

test('normalization removes only item identity and explicit bookkeeping, preserving ingredient IDs and item order',()=>{
 const first=item({milk:'oat',syrups:[{id:'vanilla',quantity:2}],syrup:'vanilla',pumps:2});
 first.explicit=['milk','syrups:vanilla'];first.futureBusinessField={id:'keep-this-id'};
 const second=item({milk:'almond'},'drink-2');
 const input=[first,second],before=clone(input),normalized=normalizeItems(input);
 assert.equal(Object.hasOwn(normalized[0],'id'),false);
 assert.equal(Object.hasOwn(normalized[0],'explicit'),false);
 assert.equal(normalized[0].syrups[0].id,'vanilla');
 assert.deepEqual(normalized[0].futureBusinessField,{id:'keep-this-id'});
 assert.deepEqual(normalized.map(i=>i.milk),['oat','almond']);
 assert.deepEqual(input,before);
 normalized[0].syrups[0].quantity=10;
 assert.equal(input[0].syrups[0].quantity,2);
});

test('ingredient groups and onSide canonicalize without sorting drinks or dropping quantities',()=>{
 const groups={
  syrups:[{id:'vanilla',quantity:2},{id:'caramel',quantity:1}],
  sauces:[{id:'white-mocha',quantity:3},{id:'mocha',quantity:2}],
  sweeteners:[{id:'sugar',quantity:2},{id:'honey',quantity:1}],
  inclusions:[{id:'strawberry',quantity:2},{id:'matcha',quantity:1}],
  toppings:[{id:'whipped-cream',amount:'regular'},{id:'cinnamon',amount:'extra'}],
  onSide:['toppings','milk','ice']
 };
 const a=item(groups),b=item(Object.fromEntries(Object.entries(groups).map(([key,list])=>[key,[...list].reverse()])));
 assert.deepEqual(normalizeItems([a]),normalizeItems([b]));
 assert.deepEqual(normalizeItems([a])[0].syrups,[{id:'caramel',quantity:1},{id:'vanilla',quantity:2}]);
 assert.deepEqual(normalizeItems([a])[0].onSide,['ice','milk','toppings']);
});

test('semantic ingredient reordering passes while all aliases still compare',()=>{
 const fields={syrups:[{id:'vanilla',quantity:2},{id:'caramel',quantity:1}],syrup:'vanilla',pumps:2};
 const target=business({...fields,syrups:[...fields.syrups].reverse()});
 const grade=gradeTurn(fixture({after:order([item(fields)],1),expected:expected({items:[target],subtotalCents:585})}));
 assert.equal(grade.pass,true);
});

test('different generated item IDs and explicit paths do not affect successful business grading',()=>{
 const actual=item({},'drink-7');actual.explicit=['milk'];
 const target=item({},'drink-42');target.explicit=['shots'];
 const grade=gradeTurn(fixture({after:order([actual],1),expected:expected({items:[target]})}));
 assert.equal(grade.pass,true);
});

test('wrong modifier ownership fails despite matching aggregate drinks and total price',()=>{
 const after=order([item({milk:'almond'}),item({milk:'oat'},'drink-2')],1);
 const target=[business({milk:'oat'}),business({milk:'almond'})];
 const grade=gradeTurn(fixture({after,expected:expected({items:target,subtotalCents:1050})}));
 assert.equal(grade.pass,false);
 assert.ok(has(grade,'field_mismatch','items[0].milk'));
 assert.ok(has(grade,'field_mismatch','items[1].milk'));
 assert.equal(has(grade,'subtotal_mismatch'),false);
 assert.equal(grade.incorrectAppliedMutation,true);
 assert.equal(grade.unsafeMutation,true);
});

test('drink order remains meaningful even when totals agree',()=>{
 const after=order([item({milk:'oat'}),item({milk:'almond'},'drink-2')],1);
 const grade=gradeTurn(fixture({after,expected:expected({items:[business({milk:'almond'}),business({milk:'oat'})],subtotalCents:1050})}));
 assert.equal(grade.pass,false);
 assert.ok(has(grade,'field_mismatch','items[0].milk'));
});

for(const [name,items] of [['extra',[item(),item({},'drink-2')]],['missing',[]]])test(`${name} drinks fail exact item count`,()=>{
 const grade=gradeTurn(fixture({after:order(items,1)}));
 assert.equal(grade.pass,false);
 assert.ok(has(grade,'item_count_mismatch','items.length'));
 assert.equal(grade.incorrectAppliedMutation,true);
 assert.equal(grade.unsafeMutation,true);
});

test('every business field compares, including fields absent from an incomplete expected oracle',()=>{
 const target=business();delete target.milk;
 const grade=gradeTurn(fixture({expected:expected({items:[target]})}));
 assert.equal(grade.pass,false);
 assert.ok(has(grade,'field_mismatch','items[0].milk'));
 const extra=item();extra.unexpectedBusinessField='do not drop';
 assert.ok(has(gradeTurn(fixture({after:order([extra],1)})),'field_mismatch','items[0].unexpectedBusinessField'));
});

test('ingredient quantity mismatch fails even if price would be unchanged',()=>{
 const after=order([item({syrups:[{id:'vanilla',quantity:2}],syrup:'vanilla',pumps:2})],1);
 const grade=gradeTurn(fixture({after,expected:expected({items:[business({syrups:[{id:'vanilla',quantity:1}],syrup:'vanilla',pumps:1})],subtotalCents:565})}));
 assert.equal(grade.pass,false);
 assert.ok(has(grade,'field_mismatch','items[0].syrups[0].quantity'));
});

test('actual subtotal is computed independently and compared in integer cents',()=>{
 const grade=gradeTurn(fixture({expected:expected({subtotalCents:526})}));
 assert.equal(grade.pass,false);
 assert.deepEqual(grade.failures.find(f=>f.code==='subtotal_mismatch'),{code:'subtotal_mismatch',path:'subtotalCents',expected:526,actual:525});
 assert.equal(grade.incorrectAppliedMutation,true);
 assert.equal(grade.unsafeMutation,true);
});

test('confirmed is a required compared business field',()=>{
 const after=order([item()],1);after.confirmed=true;
 const grade=gradeTurn(fixture({after}));
 assert.equal(grade.pass,false);
 assert.ok(has(grade,'confirmed_mismatch','confirmed'));
 assert.equal(grade.incorrectAppliedMutation,true);
 assert.equal(grade.unsafeMutation,true);
});

test('correct clarification passes only with the complete order untouched',()=>{
 const before=order([item()],1);
 const grade=gradeTurn(fixture({before,after:clone(before),result:clone(clarified),expected:expected({outcome:'clarified'})}));
 assert.equal(grade.pass,true);
 assert.equal(grade.outcome,'clarified');
 assert.equal(grade.unsafeMutation,false);
});

test('clarification with modifier mutation is unsafe and fails',()=>{
 const before=order([item()],1),after=order([item({milk:'oat'})],2);
 const grade=gradeTurn(fixture({before,after,result:clone(clarified),expected:expected({outcome:'clarified'})}));
 assert.equal(grade.pass,false);
 assert.equal(grade.unsafeMutation,true);
 assert.ok(has(grade,'unsafe_mutation'));
});

for(const field of ['revision','history','nextId','id','explicit'])test(`clarification may not mutate ${field} bookkeeping`,()=>{
 const before=order([item()],1),after=clone(before);
 if(field==='revision')after.revision++;
 if(field==='history')after.history.push({items:clone(after.items),confirmed:false});
 if(field==='nextId')after.nextId++;
 if(field==='id'){after.items[0].id='drink-2';after.nextId=3;}
 if(field==='explicit')after.items[0].explicit=['milk'];
 const grade=gradeTurn(fixture({before,after,result:clone(clarified),expected:expected({outcome:'clarified'})}));
 assert.equal(grade.unsafeMutation,true);
 assert.equal(grade.pass,false);
});

test('unnecessary clarification fails an applied expectation',()=>{
 const grade=gradeTurn(fixture({after:order(),result:clone(clarified)}));
 assert.equal(grade.pass,false);
 assert.equal(grade.unnecessaryClarification,true);
 assert.ok(has(grade,'outcome_mismatch'));
});

for(const [name,result] of [['empty',{commands:[],clarification:null}],['missing',{}],['refusal',{commands:[],clarification:'I cannot fulfill that request.'}]])test(`${name} response never satisfies an applied case`,()=>{
 const grade=gradeTurn(fixture({after:order(),result}));
 assert.equal(grade.pass,false);
 assert.ok(has(grade,'outcome_mismatch'));
});

test('matching state does not substitute for applied commands',()=>{
 const grade=gradeTurn(fixture({result:{commands:[],clarification:null}}));
 assert.equal(grade.pass,false);
 assert.ok(has(grade,'missing_commands'));
});

test('applied commands require an advanced order revision',()=>{
 const grade=gradeTurn(fixture({after:order([item()],0)}));
 assert.equal(grade.pass,false);
 assert.ok(has(grade,'revision_not_advanced','revision'));
});

test('commands plus clarification are invalid and mutation is unsafe',()=>{
 const grade=gradeTurn(fixture({result:{...clone(applied),clarification:'Which milk?'}}));
 assert.equal(grade.pass,false);
 assert.equal(grade.outcome,'invalid');
 assert.equal(grade.unsafeMutation,true);
});

test('confidence metadata never overrules correct consumed business fields',()=>{
 const result={...clone(applied),confidence:0.01,probabilities:{irrelevant:0.001}};
 assert.equal(gradeTurn(fixture({result})).pass,true);
});

test('missing metrics fail even when the business result is correct',()=>{
 const grade=gradeTurn(fixture({metrics:undefined}));
 assert.equal(grade.pass,false);
 assert.ok(has(grade,'missing_metrics','metrics.totalRequests'));
});

for(const totalRequests of [-1,1.5,'2',NaN,Infinity])test(`invalid request count ${totalRequests} fails`,()=>{
 const grade=gradeTurn(fixture({metrics:{...metrics,totalRequests}}));
 assert.equal(grade.pass,false);
 assert.ok(has(grade,'invalid_metrics','metrics.totalRequests'));
});

test('request budget violation is explicit',()=>{
 const grade=gradeTurn(fixture({metrics:{...metrics,totalRequests:3}}));
 assert.equal(grade.pass,false);
 assert.equal(grade.budgetExceeded,true);
 assert.ok(has(grade,'budget_exceeded','metrics.totalRequests'));
 assert.equal(grade.incorrectAppliedMutation,false);
 assert.equal(grade.unsafeMutation,false);
});

test('zero-request offline metrics are valid with an explicit zero budget',()=>{
 assert.equal(gradeTurn(fixture({metrics:{...metrics,extractionRequests:0,decisionRequests:0,totalRequests:0},maxRequests:0})).pass,true);
});

test('missing budget is not silently treated as unlimited',()=>{
 const grade=gradeTurn(fixture({maxRequests:undefined}));
 assert.equal(grade.pass,false);
 assert.ok(has(grade,'invalid_budget','maxRequests'));
});

for(const result of [{unavailable:true},{status:'unavailable'}])test('unavailable provider is distinct and never fabricated into a pass',()=>{
 const before=order([item()],1);
 const grade=gradeTurn(fixture({before,after:clone(before),result,expected:expected({outcome:'clarified'})}));
 assert.equal(grade.pass,false);
 assert.equal(grade.outcome,'unavailable');
 assert.ok(has(grade,'unavailable'));
});

test('sanitized adapter errors are invalid outcomes, not successful clarifications',()=>{
 const grade=gradeTurn(fixture({after:order(),result:{error:'Invalid decision response'}}));
 assert.equal(grade.pass,false);
 assert.equal(grade.outcome,'invalid');
});

test('grading never mutates caller fixtures and returns structured failures',()=>{
 const input=fixture({expected:expected({subtotalCents:526})}),before=clone(input);
 const grade=gradeTurn(input);
 assert.deepEqual(input,before);
 for(const failure of grade.failures)assert.deepEqual(Object.keys(failure).sort(),['actual','code','expected','path']);
});
test('a successful turn must advance exactly one revision',()=>{const f=fixture();f.after.revision=2;const g=gradeTurn(f);assert.equal(g.pass,false);assert.ok(has(g,'revision_not_atomic'));});
