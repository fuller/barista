import {useEffect,useMemo,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import type {Order,Quote} from '../contracts';
import type {Store} from './StorePicker';
import {quoteKey,requestQuote,unknownQuote} from './quote-cache.mjs';
import {createLocalQuoteCache,materializeQuoteRecord} from './quote-local-cache.mjs';
export type LiveQuote=Quote&{revision:number;source:'starbucks';storeId:string;storeNumber:string;expiresAt:number|string;cacheScope?:string;unavailable?:Array<{itemId:string;reason:string}>};
type QuoteRecord=NonNullable<ReturnType<ReturnType<typeof createLocalQuoteCache>['set']>>;
export function useLiveQuote(order:Order,available:boolean,store:Store|null,cacheScope:string|null=null){
 const client=useQueryClient(),cache=useMemo(()=>createLocalQuoteCache(),[]),refreshFor=useRef<string|null>(null);
 const [effectiveScope,setEffectiveScope]=useState(cacheScope);
 useEffect(()=>setEffectiveScope(cacheScope),[cacheScope]);
 const key=quoteKey(order,store,effectiveScope),identity=JSON.stringify(key);
 const persisted=useMemo(()=>cache.get(order,store,effectiveScope),[cache,identity]);
 useEffect(()=>()=>{void client.cancelQueries({queryKey:JSON.parse(identity),exact:true});if(refreshFor.current===identity)refreshFor.current=null;},[client,identity]);
 const enabled=available&&Boolean(store),hasItems=order.items.length+(order.menuItems?.length??0)>0;
 const query=useQuery<QuoteRecord,Error>({
  queryKey:key,
  queryFn:async({signal})=>{
   const refresh=refreshFor.current===identity;if(refresh)refreshFor.current=null;
   const quote=await requestQuote(order,store,signal,{cacheScope:effectiveScope,refresh});
   const nextScope=effectiveScope&&quote.cacheScope?quote.cacheScope:effectiveScope;
   if(nextScope!==effectiveScope)cache.clearScope(effectiveScope);
   const record=cache.set(order,quote,store,nextScope);if(!record)throw new Error('Live pricing unavailable');
   if(nextScope!==effectiveScope)setEffectiveScope(nextScope);return record;
  },
  initialData:persisted??undefined,
  initialDataUpdatedAt:persisted?.receivedAt,
  enabled:enabled&&hasItems,retry:false,retryOnMount:false,
  staleTime:query=>query.state.data?Math.max(0,query.state.data.expiresAt-query.state.dataUpdatedAt):0,
  refetchOnWindowFocus:false,refetchOnReconnect:false,
  refetchInterval:query=>query.state.status==='error'||!query.state.data?false:Math.max(1000,query.state.data.expiresAt-Date.now()),
 });
 const current=enabled?materializeQuoteRecord(order,query.data,store,effectiveScope):null;
 return {
  quote:(current??unknownQuote(order)) as Quote,loading:enabled&&query.isFetching,
  refresh:()=>{if(enabled&&hasItems){cache.delete(order,store,effectiveScope);refreshFor.current=identity;void query.refetch();}},
  status:!store?'Choose a store for live prices':!available?'Live pricing unavailable':query.isError?(query.error?.message==='Choose your store again to refresh live prices.'?query.error.message:'Live pricing unavailable'):query.isFetching?'Checking live prices…':current?`Live prices · ${store.name}`:'Live pricing unavailable',
 };
}
