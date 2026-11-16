import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

/** Explicit relative paths resolve from the caller's working directory. */
export function resolveReportOutput(root,output,filename){
 return output?path.resolve(output):path.resolve(root,'work/menu-evals',filename);
}

/** Fail before paid calls when a report cannot be saved; final writes still use wx. */
export async function preflightReportOutput(output){
 try{await fs.lstat(output);}catch(error){if(error.code!=='ENOENT')throw error;await probeParent(output);return;}
 throw new Error('Report output already exists');
}
async function probeParent(output){
 const parent=path.dirname(output);await fs.mkdir(parent,{recursive:true});
 const probe=path.join(parent,`.report-probe-${randomUUID()}`);let handle;
 try{handle=await fs.open(probe,'wx');}finally{if(handle){await handle.close();await fs.unlink(probe);}}
}
