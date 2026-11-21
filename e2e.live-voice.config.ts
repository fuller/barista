import type {E2EConfig} from 'e2e';
import {web} from '@e2e-dev/web';
const url=process.env.LIVE_VOICE_BASE_URL??'http://127.0.0.1:4185';
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(url))throw new Error('Use an existing loopback live benchmark server');
export default {
 tests:['experiments/live-voice/*.live.e2e.ts'],
 targets:[{name:'real-openrouter-synthetic-voice',engine:web(),app:{url}}],
 timeout:900_000,actionTimeout:70_000,assertionTimeout:70_000,
 retries:0,workers:1,
} satisfies E2EConfig;
