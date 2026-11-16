import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
if(existsSync('.env'))process.loadEnvFile('.env');
execFileSync(process.execPath,['scripts/build.mjs'],{stdio:'inherit'});
await import('./start.mjs');
