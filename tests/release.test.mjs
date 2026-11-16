import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {collectReleaseFiles,checkRelease} from '../scripts/release.mjs';
async function fixture(run){const root=await mkdtemp(path.join(tmpdir(),'barista-release-test-'));try{await run(root);}finally{await rm(root,{recursive:true,force:true});}}
test('source release uses allowlist and excludes nested local secrets and artifacts',()=>fixture(async root=>{
 for(const name of ['README.md','package.json','.env.example','.node-version','LICENSE','THIRD_PARTY_NOTICES.md','.env','random-private.txt','src/main.mjs','src/._metadata','src/.env.local','src/work/log.json','.openai/hosting.json','work/output.json','node_modules/pkg/index.js','dist/app.js','experiments/live-voice/test.ts']){const full=path.join(root,name);await mkdir(path.dirname(full),{recursive:true});await writeFile(full,'fixture');}
 assert.deepEqual(await collectReleaseFiles(root),['.env.example','.node-version','LICENSE','README.md','THIRD_PARTY_NOTICES.md','experiments/live-voice/test.ts','package.json','src/main.mjs']);
}));
test('source release rejects symlink escape',()=>fixture(async root=>{await mkdir(path.join(root,'src'));await symlink('/tmp',path.join(root,'src/external'));await assert.rejects(collectReleaseFiles(root),/refuses symlink/);}));
test('release check rejects credential without including its value in error',()=>fixture(async root=>{
 const files=['README.md','LICENSE','THIRD_PARTY_NOTICES.md','.node-version','package.json','package-lock.json','src/ui/main.tsx','scripts/build.mjs'];for(const name of files){await mkdir(path.dirname(path.join(root,name)),{recursive:true});await writeFile(path.join(root,name),'safe');}
 assert.equal(await checkRelease(root,files),8);const secret='sk-'+ 'x'.repeat(30);await writeFile(path.join(root,'README.md'),secret);await assert.rejects(checkRelease(root,files),error=>error.message==='Possible credential: README.md'&&!error.message.includes(secret));
}));
test('worker build has no personal hosting dependency or cross-site framing permission',async()=>{
 const source=await readFile(new URL('../scripts/build.mjs',import.meta.url),'utf8');assert.ok(!source.includes('.openai/hosting.json'));assert.ok(!source.includes('chatgpt.com'));assert.ok(source.includes("frame-ancestors 'self'"));
});

test('release check requires license, third-party notice and runtime baseline',async()=>{
 const required=['README.md','LICENSE','THIRD_PARTY_NOTICES.md','.node-version','package.json','package-lock.json','src/ui/main.tsx','scripts/build.mjs'];
 for(const missing of ['LICENSE','THIRD_PARTY_NOTICES.md','.node-version'])await assert.rejects(checkRelease('/unused',required.filter(file=>file!==missing)),error=>error.message===`Missing release file: ${missing}`);
});

test('source archive contains exactly allowlisted files without platform metadata',()=>fixture(async temp=>{
 const root=fileURLToPath(new URL('../',import.meta.url)),archive=path.join(temp,'source.tar.gz');
 execFileSync(process.execPath,['scripts/release.mjs',archive],{cwd:root,stdio:'pipe'});
 const entries=execFileSync('tar',['-tzf',archive],{encoding:'utf8'}).trim().split('\n');
 assert.ok(entries.every(entry=>!entry.split('/').some(part=>part.startsWith('._'))));
 const files=entries.filter(entry=>!entry.endsWith('/')).sort();
 assert.deepEqual(files,(await collectReleaseFiles(root)).map(file=>'barista/'+file).sort());
 assert.ok(files.every(file=>!file.split('/').some(part=>['.env','.git','work','node_modules','dist','.openai'].includes(part))));
}));
