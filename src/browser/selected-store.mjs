/** Browser boundary accepts only bounded, explicit Starbucks store metadata. */
export function validateSelectedStore(value,storeNumber){
 const text=(v,max=200)=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
 if(!value||value.source!=='starbucks'||!text(value.storeId,100)||!text(value.sourceStoreNumber,80)||!/^\d{1,10}-\d{1,10}$/.test(value.sourceStoreNumber)||value.sourceStoreNumber!==storeNumber||!text(value.name))throw Error('invalid store');
 const address=value.address,coordinates=value.coordinates;
 if(!address||!Array.isArray(address.lines)||address.lines.length<1||address.lines.length>5||!address.lines.every(line=>text(line))||!text(address.city,100)||!text(address.region,100)||!text(address.postalCode,30)||!text(address.countryCode,2)||address.countryCode.length!==2||!coordinates||!Number.isFinite(coordinates.latitude)||Math.abs(coordinates.latitude)>90||!Number.isFinite(coordinates.longitude)||Math.abs(coordinates.longitude)>180)throw Error('invalid store');
 return {storeId:value.storeId,source:'starbucks',sourceStoreNumber:value.sourceStoreNumber,name:value.name,address:{lines:[...address.lines],city:address.city,region:address.region,postalCode:address.postalCode,countryCode:address.countryCode},coordinates:{latitude:coordinates.latitude,longitude:coordinates.longitude}};
}
