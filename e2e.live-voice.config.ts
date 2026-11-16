import type {E2EConfig} from 'e2e';
import {web} from '@e2e-dev/web';
/** Explicit opt-in only: existing real server; no process launch, credentials, or API mocks. */
export default {
 tests:['experiments/live-voice/voice-cart.live.e2e.ts'],
 targets:[{name:'real-local-voice-smoke',engine:web(),app:{url:'http://127.0.0.1:4173'}}],
 timeout:180_000,actionTimeout:70_000,assertionTimeout:70_000,
 retries:0,workers:1,
} satisfies E2EConfig;
