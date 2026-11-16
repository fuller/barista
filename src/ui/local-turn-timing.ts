/** Local monotonic durations only; never transcript, request body or provider data. */
export type LocalTurnTiming={turnId:string;baseRevision:number;committedRevision:number;milestones:Record<string,number>};
export function createLocalTurnTiming(now:()=>number=()=>performance.now()){
 let sample:{origin:number;turnId:string|null;baseRevision:number;milestones:Record<string,number>}|null=null;
 return {
  begin(revision:number){sample={origin:now(),turnId:null,baseRevision:revision,milestones:{micClick:0}};},
  cancel(){sample=null;},
  bind(turnId:string,revision:number){if(!sample||sample.baseRevision!==revision){sample=null;return false;}sample.turnId=turnId;return true;},
  mark(name:string,turnId?:string){if(!sample||(turnId!==undefined&&sample.turnId!==turnId))return; if(!(name in sample.milestones))sample.milestones[name]=Math.max(0,now()-sample.origin);},
  complete(turnId:string,revision:number):LocalTurnTiming|null {if(!sample||sample.turnId!==turnId||revision<=sample.baseRevision)return null;const result={turnId,baseRevision:sample.baseRevision,committedRevision:revision,milestones:{...sample.milestones}};sample=null;return result;}
 };
}
