/** Shared bounded search input; coordinates are rounded to roughly 11 metres. */
export function normalizeStoreQuery(query){
 if(typeof query==='string'){
  if(!query.trim()||query.length>120||/[\u0000-\u001f\u007f]/.test(query))throw Error('Invalid store query');
  return query.trim();
 }
 if(!query||typeof query!=='object'||Array.isArray(query)||Object.keys(query).sort().join(',')!=='latitude,longitude'||!Number.isFinite(query.latitude)||Math.abs(query.latitude)>90||!Number.isFinite(query.longitude)||Math.abs(query.longitude)>180)throw Error('Invalid store query');
 return {latitude:Number(query.latitude.toFixed(4)),longitude:Number(query.longitude.toFixed(4))};
}
export function storeQueryKey(query){return typeof query==='string'?'text:'+query:'coordinates:'+query.latitude+','+query.longitude;}
export function storeLocationsUrl(query){
 const url=new URL('https://www.starbucks.com/apiproxy/v1/locations');
 if(typeof query==='string')url.searchParams.set('place',query);
 else{url.searchParams.set('lat',String(query.latitude));url.searchParams.set('lng',String(query.longitude));}
 return url;
}
