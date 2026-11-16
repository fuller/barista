import {registerCatalogSnapshot} from '../catalog/service.mjs';
class CatalogHTTPError extends Error{constructor(status){super('Catalog could not be loaded ('+status+').');this.status=status;}}
class CatalogSchemaError extends Error{constructor(){super('Catalog response schema is unsupported.');}}
function validateCatalog(value){
 const strings=a=>Array.isArray(a)&&a.every(x=>typeof x==='string');
 if(value?.schemaVersion!==1||typeof value.version!=='string'||!value.version||typeof value.provenance?.source!=='string'||!Number.isFinite(Date.parse(value.provenance?.fetchedAt))||!strings(value.provenance?.sourceUrls)||!Array.isArray(value.products)||!Array.isArray(value.supportedProducts)||!Array.isArray(value.unsupported))throw new CatalogSchemaError();
 for(const p of value.supportedProducts)if(typeof p.id!=='string'||typeof p.name!=='string'||!strings(p.temperatures)||!p.temperatures.length||!strings(p.sizes)||!p.sizes.length||!p.sizesByTemperature||p.temperatures.some(t=>!strings(p.sizesByTemperature[t]))||!strings(p.identities))throw new CatalogSchemaError();
 for(const p of value.products)if(typeof p.identity!=='string'||typeof p.productId!=='string'||typeof p.name!=='string'||typeof p.temperature!=='string'||!Array.isArray(p.categories)||p.categories.some(c=>typeof c.id!=='string'||typeof c.name!=='string')||!Array.isArray(p.sizes))throw new CatalogSchemaError();
 return value;
}
export async function fetchCatalog({signal,fetchImpl=fetch}={}){
 const response=await fetchImpl('/api/catalog',{signal,headers:{Accept:'application/json'}});
 if(!response.ok)throw new CatalogHTTPError(response.status);
 let value;try{value=await response.json();}catch{throw new CatalogSchemaError();}
 signal?.throwIfAborted();
 try{validateCatalog(value);registerCatalogSnapshot(value);}catch{throw new CatalogSchemaError();}
 return value;
}
export const catalogQueryOptions=(fetchImpl=fetch)=>({
 queryKey:['catalog',1,'US','en-US'],queryFn:({signal})=>fetchCatalog({signal,fetchImpl}),
 staleTime:300000,gcTime:86400000,refetchOnWindowFocus:false,
 retry:(count,error)=>count<1&&(error instanceof TypeError||error instanceof CatalogHTTPError&&error.status>=500&&error.status<600),
});
