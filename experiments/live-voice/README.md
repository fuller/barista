# Opt-in synthetic voice smoke

Uses the already running real website at `http://127.0.0.1:4173`. Restart that server first to obtain a cold server-memory cache. Do not run beside another provider benchmark. The server owns its credentials; this test/config reads no key or env file and starts no application process.

From the barista directory, run only after authorizing two real interpretation turns:

```sh
E2E_TELEMETRY_DISABLED=1 npm exec -- e2e run --no-cache --config e2e.live-voice.config.ts experiments/live-voice/voice-cart.live.e2e.ts --output work/live-voice-browser
```

The explicit config selects only `experiments/live-voice/`; normal `npm run test:e2e` discovers `tests/` and excludes this experiment. Retries are disabled. Fake SpeechRecognition emits the fixed final `one latte` twice, with Start new order between turns. API configuration and turns use real requests; only remote product photos are stubbed. Expected maximum is six actual provider requests across both turns; the report checks the returned wire counts.

A unique JSON artifact appears under `work/live-voice-smoke/`. It contains local monotonic milestone durations, expected committed cart names, safe request/timing/cache-hit metrics, and actual provider request count. It excludes transcript bodies, response bodies, headers, credentials and user identifiers. Synthetic ASR does not measure physical microphone endpointing. The next-frame callback does not establish physical paint time. “Cold” is valid only after a fresh server process; warm uses the same process and phrase. No provider invocation occurs during test listing or config validation.
