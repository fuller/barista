import {validateSelectedStore} from './selected-store.mjs';
export function validateStoreQuery(query){if(typeof query!=='string'||!query.trim()||query.length>120||/[\u0000-\u001f\u007f]/.test(query))throw Error('invalid query');return query.trim();}
/** Never return provider envelopes, cookies, session IDs or other fields. */
export function sanitizePublicStores(raw){
 if(!Array.isArray(raw)||raw.length>500)throw Error('unavailable');
 return raw.map(entry=>{const s=entry?.store;const store=validateSelectedStore({storeId:s?.id,source:'starbucks',sourceStoreNumber:s?.storeNumber,name:s?.name,address:{lines:s?.address?.lines,city:s?.address?.city,region:s?.address?.countrySubdivisionCode,postalCode:s?.address?.postalCode,countryCode:s?.address?.countryCode},coordinates:s?.coordinates},s?.storeNumber);return {store:{id:store.storeId,storeNumber:store.sourceStoreNumber,name:store.name,address:{lines:store.address.lines,city:store.address.city,countrySubdivisionCode:store.address.region,postalCode:store.address.postalCode,countryCode:store.address.countryCode},coordinates:store.coordinates}};});
}
