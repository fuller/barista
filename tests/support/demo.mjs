import {applyCommands} from '../../src/domain/order.mjs';
import {parseDemoTurn,splitDemoAdditions} from './coffee-language.mjs';

export function createDemoAdapter(){return {async interpretTurn(input,{signal}={}){
 signal?.throwIfAborted();
 const correction=input.clarificationContext;
 const validPumpCorrection=correction?.supersededField==='pumps'&&typeof correction.originalText==='string'&&input.text.startsWith(correction.originalText)&&typeof correction.question==='string'&&correction.question.length>0&&Array.isArray(correction.answers)&&correction.answers.length>0&&correction.answers.every(answer=>typeof answer==='string')&&/\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+(?:syrup )?pumps?\b/i.test(correction.answers.at(-1));

 const parserInput=validPumpCorrection?{...input,text:`${correction.originalText.replace(/\b(?:half (?:(?:the )?flavou?r|sweet|(?:the )?pumps?)|less sweet|sweeter)\b/gi,'')} ${correction.answers.join(' ')}`} :input;
 const compound=splitDemoAdditions(parserInput.text);
 if(compound){
  const reject=()=>({commands:[],clarification:'Please say each drink with its own changes so I can keep every modifier.',clarificationMode:'retry',source:'demo'});
  if(compound.failure)return reject();
  let draft=input.order;const commands=[];
  for(const clause of compound.clauses){
   signal?.throwIfAborted();
   const part=parseDemoTurn({...parserInput,text:clause.text,order:draft});
   if(part.clarification||part.commands.length!==1||part.commands[0].type!=='add'||part.commands[0].productId!==clause.productId)return reject();
   try{draft=applyCommands(draft,part.commands);}catch{return reject();}
   commands.push(...part.commands);
  }
  signal?.throwIfAborted();return {commands,clarification:null,source:'demo'};
 }
 const result=parseDemoTurn(parserInput);
 if(result.commands.length){try{applyCommands(input.order,result.commands);}catch{return {commands:[],clarification:'That change is not supported for this drink. Choose a compatible modifier or another drink.',source:'demo'};}}
 return result;
}};}
