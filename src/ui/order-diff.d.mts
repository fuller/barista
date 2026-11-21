import type {Order} from '../contracts.ts';
export interface OrderChanges {
 added:string[];
 removed:string[];
 updated:Array<{id:string;fields:string[];ingredients:string[]}>;
}
export function diffOrder(before:Order,after:Order):OrderChanges;
