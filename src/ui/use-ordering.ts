import {useLayoutEffect,useMemo,useState} from 'react';
import {useActorRef,useSelector} from '@xstate/react';
import type {Command} from '../contracts';
import {createOrder} from '../domain/order.mjs';
import {defaultCatalogService} from '../catalog/service.mjs';
import {orderingMachine} from '../application/ordering-machine.ts';

/** React renders actor state; request, voice and cancellation ownership live in the machine. */
export function useOrdering(connection:{ready:boolean;available:boolean;error:string}){
 const [initialOrder]=useState(()=>createOrder(defaultCatalogService.version));
 const actor=useActorRef(orderingMachine,{input:{order:initialOrder}});
 const snapshot=useSelector(actor,state=>state);
 useLayoutEffect(()=>{
  actor.send({type:'CONNECTION.CHANGED',...connection});
 },[actor,connection.ready,connection.available,connection.error]);
 const actions=useMemo(()=>({
  changeStore(storeId:string|null){actor.send({type:'STORE.CHANGED',storeId});},
  commit(commands:Command[]){const before=actor.getSnapshot().context.order;actor.send({type:'ORDER.COMMIT',commands});return actor.getSnapshot().context.order!==before;},
  submit(text:string){actor.send({type:'ORDER.SUBMIT',text});return actor.getSnapshot().hasTag('busy');},
  startVoice(){actor.send({type:'VOICE.START'});},
  finishVoice(){actor.send({type:'VOICE.FINISH'});},
  cancel(message?:string){actor.send({type:'REQUEST.CANCEL',message});},
  cancelQuestion(){actor.send({type:'CLARIFICATION.CANCEL'});},
  newOrder(catalogVersion:string){actor.send({type:'ORDER.RESET',catalogVersion});},
  setReplies(enabled:boolean){actor.send({type:'REPLIES.CHANGED',enabled});},
  setError(message:string|((current:string)=>string)){const current=actor.getSnapshot().context.error;const next=typeof message==='function'?message(current):message;if(next!==current)actor.send({type:'ERROR.CHANGED',message:next});},
 }),[actor]);
 const frame=snapshot.context.pendingFrame;
 useLayoutEffect(()=>{
  if(!frame||frame.revision!==snapshot.context.order.revision)return;
  actor.send({type:'UI.LAYOUT_COMMITTED',turnId:frame.id,revision:frame.revision});
  const handle=requestAnimationFrame(()=>actor.send({type:'UI.FRAME_PAINTED',turnId:frame.id,revision:frame.revision}));
  return()=>cancelAnimationFrame(handle);
 },[actor,frame,snapshot.context.order.revision]);
 return {...snapshot.context,...actions,busy:snapshot.hasTag('busy'),listening:snapshot.hasTag('listening'),preparing:snapshot.hasTag('preparing')};
}
