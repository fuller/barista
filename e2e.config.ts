import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';

export default {
  tests: ['tests/**/*.e2e.ts'],
  targets: [
    {
      name: 'local-chromium',
      engine: web(),
      app: {
        url: 'http://127.0.0.1:0',
        command: {
          executable: 'npm',
          args: ['run', 'e2e:serve'],
          env: {
            PORT: '{port}',
            DECISION_PROVIDER: 'decider',
            OPENROUTER_API_KEY: '',
          },
        },
      },
    },
  ],
  retries: 0,
  workers: 1,
} satisfies E2EConfig;
