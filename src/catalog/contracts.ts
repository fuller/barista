export interface CatalogIdentity { productNumber:string; formCode:string }
export interface CatalogProvenance { source:string; fetchedAt:string; sourceUrls:string[]; storeContext:null }
export interface CatalogSnapshot { schemaVersion:1; version:string; provenance:CatalogProvenance; products:CatalogProduct[]; supportedProducts:SupportedProduct[]; unsupported:UnsupportedRecord[] }
export interface UnsupportedRecord { productNumber:string; reason:string; name?:string; formCode?:string; identity?:string }
export interface CatalogProduct extends CatalogIdentity { identity:string; productId:string; name:string; description:string; imageURL:string|null; categories:{id:string;name:string}[]; temperature:string; sizes:{size:string;name:string;sizeCode:string;sku:string;recipe:{defaults:Record<string,unknown>;included:unknown[];unsupported:UnsupportedRecord[]}}[]; supported:boolean; unsupported:UnsupportedRecord[] }
export interface SupportedProduct { id:string;name:string;description:string;imageURL:string|null;temperatures:string[];sizes:string[];sizesByTemperature:Record<string,string[]>;identities:string[] }
