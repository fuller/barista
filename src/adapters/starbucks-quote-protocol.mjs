const fail=()=>{throw new Error('Invalid Starbucks quote');};
const check=v=>{if(!v)fail();};
const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const sku=v=>typeof v==='string'&&/^[0-9]{1,16}$/.test(v);
const safe=v=>{check(Number.isSafeInteger(v)&&v>=0);return v;};
function cents(v){
  check(typeof v==='number'||typeof v==='string');
  const s=String(v);check(/^\d+(?:\.\d{1,2})?$/.test(s));
  const [whole,fraction='']=s.split('.');const n=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
  check(n<=BigInt(Number.MAX_SAFE_INTEGER));return Number(n);
}
const defaultFulfillment={consumptionType:'CONSUME_OUT_OF_STORE',collectionType:'IN_STORE'};
const compare=(a,b)=>a<b?-1:a>b?1:0;
export function buildStarbucksQuoteRequest(input){
  check(input&&typeof input==='object'&&typeof input.storeNumber==='string'&&/^\d{1,10}-\d{1,10}$/.test(input.storeNumber));
  const fulfillment=input.fulfillment??defaultFulfillment;
  check(['CONSUME_IN_STORE','CONSUME_OUT_OF_STORE'].includes(fulfillment?.consumptionType)&&['IN_STORE','DRIVE_THRU'].includes(fulfillment?.collectionType));
  check(Array.isArray(input.items)&&input.items.length>0&&input.items.length<=50);
  const ids=new Set();let units=0;
  const items=input.items.map(item=>{
    check(item&&typeof item.itemId==='string'&&item.itemId.length>0&&item.itemId.length<=128&&!ids.has(item.itemId)&&sku(item.sku)&&integer(item.quantity,1,100));ids.add(item.itemId);units+=item.quantity;check(units<=100);
    const modifiers=item.modifiers??[];check(Array.isArray(modifiers)&&modifiers.length<=50);const seen=new Set();
    const normalized=modifiers.map(m=>{check(m&&sku(m.sku)&&integer(m.quantity,1,100)&&!seen.has(m.sku));seen.add(m.sku);return {sku:m.sku,quantity:m.quantity};}).sort((a,b)=>compare(a.sku,b.sku));
    return {itemId:item.itemId,sku:item.sku,quantity:item.quantity,modifiers:normalized};
  }).sort((a,b)=>compare(a.itemId,b.itemId));
  const correlation=[];const parents=[];
  items.forEach((item,index)=>{for(let unit=0;unit<item.quantity;unit++){
    const key=`barista-${index}-${unit}`;
    correlation.push({key,itemId:item.itemId,sku:item.sku,quantity:1,modifiers:item.modifiers.map(m=>({...m}))});
    parents.push({key,quantity:1,commerce:{sku:item.sku},childItems:item.modifiers.map(m=>({quantity:m.quantity,commerce:{sku:m.sku}}))});
  }});
  const normalizedFulfillment={consumptionType:fulfillment.consumptionType,collectionType:fulfillment.collectionType};
  return {body:{variables:{order:{cart:{items:parents,offers:[]},fulfillment:normalizedFulfillment,storeNumber:input.storeNumber,enableTransparentPricing:true,enableNextGenLoyalty:true}}},correlation,cacheKey:JSON.stringify({storeNumber:input.storeNumber,fulfillment:normalizedFulfillment,items}),storeNumber:input.storeNumber};
}
export function normalizeStarbucksQuote(envelope,prepared,{now=Date.now}={}){
  check(envelope&&(!envelope.errors||Array.isArray(envelope.errors)&&envelope.errors.length===0));
  const order=envelope.data?.priceOrder;
  check(order?.__typename==='PricedOrderV2'&&order.currency==='USD'&&typeof order.expiresIn==='number'&&Number.isFinite(order.expiresIn)&&order.expiresIn>0);
  check(Array.isArray(prepared?.correlation)&&prepared.correlation.length>0&&typeof prepared.storeNumber==='string');
  const expected=new Map(prepared.correlation.map(c=>[c.key,c]));check(expected.size===prepared.correlation.length);
  check(Array.isArray(order.cart?.items)&&order.cart.items.length===expected.size);
  const seen=new Set(),groups=new Map();let sum=0;
  for(const item of order.cart.items){
    const c=expected.get(item.key);check(c&&!seen.has(item.key)&&item.sku===c.sku&&item.quantity===1&&item.isAvailable===true&&item.availability==='PURCHASABLE');seen.add(item.key);
    const unitCents=cents(item.price);check(Array.isArray(item.lineItems)&&item.lineItems.length>0&&item.lineItems.length<=100);

    check(Array.isArray(c.modifiers));
    const requestedModifiers=new Map(c.modifiers.map(m=>[m.sku,m.quantity]));
    const echoedModifiers=new Set();
    const lineKeys=new Set();
    const lines=item.lineItems.map(line=>{check(line&&typeof line.key==='string'&&!lineKeys.has(line.key)&&sku(line.sku)&&integer(line.quantity,0,100)&&typeof line.label==='string'&&line.label.length>0&&line.label.length<=500);lineKeys.add(line.key);
      if(requestedModifiers.has(line.sku)){
        check(!echoedModifiers.has(line.sku)&&line.quantity===requestedModifiers.get(line.sku));echoedModifiers.add(line.sku);
      }else check(line.sku===c.sku||cents(line.price)===0);
      return {label:line.label,amountCents:cents(line.price)};});
    check(echoedModifiers.size===requestedModifiers.size);
    check(safe(lines.reduce((n,l)=>n+l.amountCents,0))===unitCents);sum=safe(sum+unitCents);
    const signature=JSON.stringify(item.lineItems.map(l=>({sku:l.sku,quantity:l.quantity,label:l.label,amountCents:cents(l.price)})));
    const previous=groups.get(c.itemId);
    if(previous){check(previous.unitCents===unitCents&&previous.signature===signature);previous.quantity++;previous.totalCents=safe(previous.totalCents+unitCents);}
    else groups.set(c.itemId,{itemId:c.itemId,quantity:1,unitCents,totalCents:unitCents,lines,signature});
  }
  check(seen.size===expected.size);
  const summary=order.summary;check(summary&&Array.isArray(summary.lineItems)&&summary.lineItems.length===2&&(!summary.additionalFeeDescription||Array.isArray(summary.additionalFeeDescription)&&summary.additionalFeeDescription.length===0));
  const rows=new Map();for(const row of summary.lineItems){check(row&&(row.key==='subtotal'||row.key==='tax')&&!rows.has(row.key));rows.set(row.key,cents(row.price));}
  check(rows.has('subtotal')&&rows.has('tax'));const subtotalCents=rows.get('subtotal'),taxCents=rows.get('tax'),totalCents=cents(summary.price);
  check(subtotalCents===sum&&totalCents===safe(subtotalCents+taxCents));
  const timestamp=now();check(Number.isSafeInteger(timestamp)&&timestamp>=0);const expiresAt=timestamp+Math.floor(Math.min(300,order.expiresIn)*1000);check(Number.isSafeInteger(expiresAt)&&expiresAt>timestamp);
  return {currency:'USD',subtotalCents,taxCents,totalCents,items:[...groups.values()].sort((a,b)=>compare(a.itemId,b.itemId)).map(({signature,...item})=>item),estimated:false,taxLabel:'Tax',provenance:'Verified Starbucks store quote',source:'starbucks',storeNumber:prepared.storeNumber,expiresAt};
}
