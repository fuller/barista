import type {TurnRequest,TurnResponse} from '../contracts.ts';
export interface TurnRequestOptions {
 signal?:AbortSignal;
 fetchImpl?:typeof fetch;
 onTiming?:(event:string)=>void;
}
export function requestTurn(input:TurnRequest,options?:TurnRequestOptions):Promise<TurnResponse>;
