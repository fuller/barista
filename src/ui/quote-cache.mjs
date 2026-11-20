export const pricingAvailable=config=>config?.pricing?.available===true;
export function expiryTime(value){return typeof value==='number'?value:Date.parse(value);}
export function quoteKey(order,store){return ['live-quote',store?.storeId??null,store?.sourceStoreNumber??null,store?.selectionToken??null,JSON.stringify(order)];}
export function unknownQuote(order){const items=[...order.items,...(order.menuItems??[])];return {currency:'USD',items:items.map(item=>({itemId:item.id,quantity:item.quantity,unitCents:null,totalCents:null,lines:[]})),subtotalCents:null,taxCents:null,totalCents:null,pricedSubtotalCents:0,unpricedItemCount:items.reduce((sum,item)=>sum+item.quantity,0),estimated:false,taxLabel:'Tax unavailable',provenance:'Live pricing unavailable'};}
const money=value=>Number.isSafeInteger(value)&&value>=0;
export function quoteRefreshInterval(state,now=Date.now()){if(state.status==='error'||!state.data?.expiresAt)return false;return Math.max(1000,expiryTime(state.data.expiresAt)-now);}
export function acceptQuote(order,value,store,now=Date.now()){
 const items=[...order.items,...(order.menuItems??[])];
 if(!store||!value||value.storeId!==store.storeId||value.revision!==order.revision||value.source!=='starbucks'||value.storeNumber!==store.sourceStoreNumber||!(expiryTime(value.expiresAt)>now)||!Array.isArray(value.items))return null;
 const ids=new Set();
 for(const line of value.items){const item=items.find(item=>item.id===line.itemId);if(!item||ids.has(line.itemId)||line.quantity!==item.quantity||!Array.isArray(line.lines)||![line.unitCents,line.totalCents].every(amount=>amount===null||(Number.isSafeInteger(amount)&&amount>=0)))return null;if((line.unitCents===null)!==(line.totalCents===null))return null;if(line.lines.some(part=>typeof part.label!=='string'||!Number.isSafeInteger(part.amountCents)))return null;if(line.unitCents!==null&&(line.totalCents!==line.unitCents*line.quantity||line.lines.reduce((sum,part)=>sum+part.amountCents,0)!==line.unitCents))return null;ids.add(line.itemId);}
 const resolved=items.map(item=>value.items.find(line=>line.itemId===item.id)??{itemId:item.id,quantity:item.quantity,unitCents:null,totalCents:null,lines:[]});
 const missing=resolved.filter(line=>line.totalCents===null).reduce((sum,line)=>sum+line.quantity,0);
 const suppliedMissing=value.items.some(line=>line.totalCents===null);
 if(!suppliedMissing){const subtotal=value.items.reduce((sum,line)=>sum+line.totalCents,0);if(!money(subtotal)||value.subtotalCents!==subtotal||!money(value.taxCents)||!money(value.totalCents)||value.totalCents!==subtotal+value.taxCents)return null;}
 else if(value.subtotalCents!==null||value.taxCents!==null||value.totalCents!==null)return null;
 return {...value,items:resolved,unpricedItemCount:missing,pricedSubtotalCents:resolved.reduce((sum,line)=>sum+(line.totalCents??0),0),...(missing?{subtotalCents:null,taxCents:null,totalCents:null}:{})};
}
export async function requestQuote(order,store,signal){if(!store)throw new Error('Choose a store first.');const response=await fetch('/api/quote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({order,storeId:store.storeId,selectionToken:store.selectionToken}),signal});if(!response.ok){let failure=null;try{failure=await response.json();}catch{}throw new Error(failure?.code==='store_selection_required'?'Choose your store again to refresh live prices.':'Live pricing unavailable');}const quote=acceptQuote(order,await response.json(),store);if(!quote)throw new Error('Live pricing unavailable');return quote;}
