import {readdir,readFile,lstat,mkdir,copyFile,rm,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
export const releaseRoots=['.github','src','scripts','tests','evals','docs','experiments','deploy'];
export const releaseFiles=['.env.example','.gitignore','README.md','LICENSE','THIRD_PARTY_NOTICES.md','.node-version','CONTRIBUTING.md','SECURITY.md','package.json','package-lock.json','wrangler.jsonc','tsconfig.json','index.html','e2e.config.ts','e2e.live-voice.config.ts'];
const excluded=name=>['.git','.wrangler','node_modules','dist','work','.openai','.gstack','.e2e','.superpowers'].includes(name)||name.startsWith('.dev.vars')||name.startsWith('._')||name==='.env'||name.startsWith('.env.')&&name!=='.env.example'||name.endsWith('.log');
export async function collectReleaseFiles(root){
 const files=[];
 async function visit(relative){const full=path.join(root,relative),stat=await lstat(full);if(stat.isSymbolicLink())throw new Error(`Release refuses symlink: ${relative}`);if(stat.isDirectory()){for(const entry of (await readdir(full)).sort()){if(!excluded(entry))await visit(path.join(relative,entry));}}else if(stat.isFile())files.push(relative);}
 for(const name of [...releaseFiles,...releaseRoots]){try{await lstat(path.join(root,name));}catch(error){if(error.code==='ENOENT')continue;throw error;}await visit(name);}
 return files.sort();
}
export async function checkRelease(root,files){
 for(const required of ['README.md','LICENSE','THIRD_PARTY_NOTICES.md','.node-version','package.json','package-lock.json','wrangler.jsonc','src/ui/main.tsx','scripts/build.mjs'])if(!files.includes(required))throw new Error(`Missing release file: ${required}`);
 for(const relative of files){const bytes=await readFile(path.join(root,relative));const text=bytes.toString('utf8');if(/appgprj_[a-zA-Z0-9]+|\/Users\/[^/\s]+\//u.test(text))throw new Error(`Personal deployment/path reference: ${relative}`);if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-(?:or-v1-)?[A-Za-z0-9_-]{24,}/u.test(text))throw new Error(`Possible credential: ${relative}`);}
 return files.length;
}
export async function main(args=process.argv.slice(2)){
 const root=fileURLToPath(new URL('../',import.meta.url)),files=await collectReleaseFiles(root);await checkRelease(root,files);
 if(args[0]==='--check'){console.log(`Release allowlist checked: ${files.length} files`);return;}
 if(args.length>1)throw new Error('Usage: node scripts/release.mjs [--check|archive.tar.gz]');
 const output=path.resolve(args[0]||path.join(root,'../barista-source.tar.gz'));if(output.startsWith(root+path.sep))throw new Error('Archive output must be outside source tree');
 const staging=await mkdtemp(path.join(tmpdir(),'barista-release-'));
 try{for(const relative of files){const dest=path.join(staging,'barista',relative);await mkdir(path.dirname(dest),{recursive:true});await copyFile(path.join(root,relative),dest);}await mkdir(path.dirname(output),{recursive:true});execFileSync('tar',['-czf',output,'-C',staging,'barista'],{env:{...process.env,COPYFILE_DISABLE:'1'}});console.log(`Source archive: ${output} (${files.length} files)`);}finally{await rm(staging,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
