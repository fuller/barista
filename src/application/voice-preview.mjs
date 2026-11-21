import {applyCommands} from '../domain/order.mjs';
import {getCatalogService} from '../catalog/service.mjs';

export function buildVoicePreview(order,response){
 if(!response||response.clarification||response.pending||!Array.isArray(response.commands)||!response.commands.length)return null;
 try{
  const next=applyCommands(order,response.commands),catalog=getCatalogService(order.catalogVersion);
  return {confirmed:next.confirmed,items:[...next.items.map(item=>({id:item.id,name:catalog.getProduct(item.productId,item.temperature)?.name??item.productId,size:item.size,quantity:item.quantity,instructions:[]})),...(next.menuItems??[]).map(item=>({id:item.id,name:item.name,size:item.size,quantity:item.quantity,instructions:[...item.instructions]}))]};
 }catch{return null;}
}
