import {useQuery} from '@tanstack/react-query';
import type {Order,Quote} from '../contracts';
import {acceptQuote,quoteRefreshInterval,quoteKey,requestQuote,unknownQuote} from './quote-cache.mjs';
export type LiveQuote=Quote&{revision:number;source:'starbucks';storeNumber:string;expiresAt:number|string;unavailable?:Array<{itemId:string;reason:string}>};
export function useLiveQuote(order:Order,available:boolean){
 const query=useQuery<LiveQuote,Error>({queryKey:quoteKey(order),queryFn:({signal})=>requestQuote(order,signal),enabled:available&&(order.items.length+(order.menuItems?.length??0)>0),retry:false,retryOnMount:false,staleTime:0,refetchOnWindowFocus:false,refetchOnReconnect:false,refetchInterval:query=>quoteRefreshInterval(query.state)});
 const current=available?acceptQuote(order,query.data):null;
 return {quote:(current??unknownQuote(order)) as Quote,loading:available&&query.isFetching,refresh:()=>{if(available)void query.refetch();},status:!available||query.isError?'Live pricing unavailable':query.isFetching?'Checking live prices…':current?'Live prices · 104 Jay St':'Live pricing unavailable'};
}
