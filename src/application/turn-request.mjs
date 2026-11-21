import {validateOrder} from '../domain/order.mjs';

export function buildTurnRequest(input){

 validateOrder(input.order);
 const baseRevision=input.baseRevision===undefined?input.order.revision:input.baseRevision;
 if(baseRevision!==input.order.revision)throw new Error('Invalid order revision');
 return structuredClone({...input,baseRevision,order:{...input.order,history:input.order.history.slice(-1)}});
}
