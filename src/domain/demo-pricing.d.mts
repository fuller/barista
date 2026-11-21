import type {Order,Quote} from '../contracts.ts';
import type {MenuDirectory} from '../catalog/menu-directory-contracts.ts';
export interface DemoPriceBook {
 version:string;
 currency:'USD';
 provenance:string;
 menuVersion:string;
 products:Record<string,{defaultCents:number;sizes:Record<string,number>}>;
}
export const DEMO_PRICE_BOOK:DemoPriceBook;
export function validateDemoPriceBook(value:unknown,menu?:MenuDirectory):DemoPriceBook;
export function getDemoMenuPrice(productOrIdentity:string|{identity:string},size?:string|null):number|null;
export function quoteDemoOrder(order:Order,options?:{directory?:MenuDirectory}):Quote&{source:'demo';estimated:true;priceBookVersion:string};
