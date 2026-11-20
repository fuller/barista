import {useEffect} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import type {Order,Quote} from '../contracts';
import type {Store} from './StorePicker';
import {acceptQuote,quoteRefreshInterval,quoteKey,requestQuote,unknownQuote} from './quote-cache.mjs';
export type LiveQuote=Quote&{revision:number;source:'starbucks';storeId:string;storeNumber:string;expiresAt:number|string;unavailable?:Array<{itemId:string;reason:string}>};
export function useLiveQuote(order:Order,available:boolean,store:Store|null){
 const client=useQueryClient(),key=quoteKey(order,store),identity=JSON.stringify(key);
 useEffect(()=>()=>{void client.cancelQueries({queryKey:JSON.parse(identity),exact:true});},[client,identity]);
 const enabled=available&&Boolean(store);
 const query=useQuery<LiveQuote,Error>({queryKey:key,queryFn:({signal})=>requestQuote(order,store,signal),enabled:enabled&&(order.items.length+(order.menuItems?.length??0)>0),retry:false,retryOnMount:false,staleTime:0,refetchOnWindowFocus:false,refetchOnReconnect:false,refetchInterval:query=>quoteRefreshInterval(query.state)});
 const current=enabled?acceptQuote(order,query.data,store):null;
 return {quote:(current??unknownQuote(order)) as Quote,loading:enabled&&query.isFetching,refresh:()=>{if(enabled)void query.refetch();},status:!store?'Choose a store for live prices':!available?'Live pricing unavailable':query.isError?(query.error?.message==='Choose your store again to refresh live prices.'?query.error.message:'Live pricing unavailable'):query.isFetching?'Checking live prices…':current?`Live prices · ${store.name}`:'Live pricing unavailable'};
}
