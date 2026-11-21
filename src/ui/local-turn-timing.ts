export type LocalTurnTiming={turnId:string;baseRevision:number;committedRevision:number;milestones:Record<string,number>};
export function createLocalTurnTiming(now:()=>number=()=>performance.now()){
 let sample:{origin:number;turnId:string|null;baseRevision:number;milestones:Record<string,number>}|null=null;
 return {
  begin(revision:number){sample={origin:now(),turnId:null,baseRevision:revision,milestones:{micClick:0}};},
  cancel(){sample=null;},
  bind(turnId:string,revision:number){if(!sample||sample.baseRevision!==revision){sample=null;return false;}sample.turnId=turnId;return true;},
  mark(name:string,turnId?:string){if(!sample||(turnId!==undefined&&sample.turnId!==turnId))return; if(!(name in sample.milestones))sample.milestones[name]=Math.max(0,now()-sample.origin);},
  fork(){
   const parent=sample,milestones:Record<string,number>={};let adoptedId:string|null=null;
   return {
    mark(name:string){if(!parent||sample!==parent)return;if(!(name in milestones))milestones[name]=Math.max(0,now()-parent.origin);if(adoptedId&&parent.turnId===adoptedId&&!(name in parent.milestones))parent.milestones[name]=milestones[name];},
    adopt(turnId:string){if(!parent||sample!==parent||parent.turnId!==turnId)return;adoptedId=turnId;for(const [name,value] of Object.entries(milestones))if(!(name in parent.milestones))parent.milestones[name]=value;}
   };
  },
  complete(turnId:string,revision:number):LocalTurnTiming|null {if(!sample||sample.turnId!==turnId||revision<=sample.baseRevision)return null;const result={turnId,baseRevision:sample.baseRevision,committedRevision:revision,milestones:{...sample.milestones}};sample=null;return result;}
 };
}
