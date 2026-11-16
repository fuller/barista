import {clarification} from '../adapters/clarification.mjs';
/** A transport-independent single-use revision gate. */
export function createTurnGate(){let active=null;return {begin(turnId,revision){active={turnId,revision}},cancel(){active=null},accept(turnId,revision){if(active?.turnId!==turnId||active.revision!==revision)return false;active=null;return true}};}
/** Pending requests are replayed only against the unchanged revision and target IDs. */
export async function interpretInput(input,adapter,context={}){
 const {order,pending,text}=input;
 if(pending){
  if(/^cancel$/i.test(text.trim()))return {...clarification('Cancelled. What would you like next?',{mode:'retry',stage:'conversation',reason:'field_unrepresented'}),pending:null,source:'application'};
  if(pending.revision!==order.revision||pending.targetIds.some(id=>![...order.items,...(order.menuItems??[])].some(i=>i.id===id)))throw Object.assign(new Error('The order changed. Please repeat your request.'),{status:409});
 }
 const isNew=/^(add |remove |delete |undo\b|clear\b|start over\b|confirm\b)/i.test(text.trim());
 let effectiveText=text;let clarificationContext;
 if(pending&&!isNew){
  const original=pending.originalText;
  const replacesPumpAmount=/half (?:(?:the )?flavou?r|sweet|(?:the )?pumps?)|less sweet|sweeter/i.test(original)&&/\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+(?:syrup )?pumps?\b/i.test(text);
  if(replacesPumpAmount){
   clarificationContext={supersededField:'pumps',originalText:original,question:pending.question,answers:[...pending.answers,text]};
   effectiveText=`${original} ${pending.answers.join(' ')} Correction to the syrup pump request: ${text}. This answer replaces the earlier syrup amount; preserve the original drink and target.`;
  }else effectiveText=`${original} ${pending.answers.join(' ')} ${text}`;
 }
 const interpretation=await adapter.interpretTurn({...input,text:effectiveText,clarificationContext},context);
 const nextPending=interpretation.clarification&&interpretation.clarificationMode!=='retry'?{originalText:pending&&!isNew?pending.originalText:text,question:interpretation.clarification,revision:order.revision,answers:pending&&!isNew?[...pending.answers,text]:[],targetIds:pending&&!isNew?pending.targetIds:[...order.items,...(order.menuItems??[])].map(i=>i.id)}:null;
 return {...interpretation,pending:nextPending};
}
