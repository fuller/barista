const columns=['id','name','identity','size','quantity','instructions'];
/** Lossless ordered rows; keep ordinary JSON when its encoding is smaller. */
export function compactMenuCart(cart){
 const original=structuredClone(cart);
 const compact={columns:[...columns],rows:original.map(item=>columns.map(key=>item[key]))};
 return JSON.stringify(compact).length<JSON.stringify(original).length?compact:original;
}
