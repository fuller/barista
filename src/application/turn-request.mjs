import {validateOrder} from '../domain/order.mjs';

/** Keep full undo history local; the server needs only the next undo snapshot. */
export function buildTurnRequest(input){
 // Validate before discarding snapshots so compaction cannot conceal bad state.
 validateOrder(input.order);
 const baseRevision=input.baseRevision===undefined?input.order.revision:input.baseRevision;
 if(baseRevision!==input.order.revision)throw new Error('Invalid order revision');
 return structuredClone({...input,baseRevision,order:{...input.order,history:input.order.history.slice(-1)}});
}
