# Opt-in synthetic voice smoke

Uses the already running real website at `http://127.0.0.1:4173`. Restart that server first to obtain a cold server-memory cache. Do not run beside another provider benchmark. The server owns its credentials; this test/config reads no key or env file and starts no application process.

From the repository root, explicitly opt into two real interpretation turns (provider charges may apply):

```sh
E2E_TELEMETRY_DISABLED=1 npm exec -- e2e run --no-cache --config e2e.live-voice.config.ts experiments/live-voice/voice-cart.live.e2e.ts --output work/live-voice-browser
```

The explicit config selects only `experiments/live-voice/`; normal `npm run test:e2e` discovers `tests/` and excludes this experiment. Retries are disabled. Fake SpeechRecognition emits the fixed final `one latte` twice, with Start new order between turns. API configuration and turns use real requests; only remote product photos are stubbed. Expected maximum is six actual provider requests across both turns; the report checks the returned wire counts.

A unique JSON artifact appears under `work/live-voice-smoke/`. It contains local monotonic milestone durations, expected committed cart names, safe request/timing/cache-hit metrics, and actual provider request count. It excludes transcript bodies, response bodies, headers, credentials and user identifiers. Synthetic ASR does not measure physical microphone endpointing. The next-frame callback does not establish physical paint time. “Cold” is valid only after a fresh server process; warm uses the same process and phrase. No provider invocation occurs during test listing or config validation.

## Progressive preparation

With a fresh local server, explicitly opt into the single-turn preparation smoke (provider charges may apply):

```sh
E2E_TELEMETRY_DISABLED=1 npm exec -- e2e run --no-cache --config e2e.live-voice.config.ts experiments/live-voice/progressive.live.e2e.ts --output work/progressive-live-browser
```

It emits a fixed interim phrase, waits for a real model-backed preview, then emits the exact final phrase. The committed cart must remain empty before final speech. Matching final speech must commit with one HTTP turn and at most four provider calls. Timing evidence separates the model work before final speech from final-to-command and final-to-next-frame durations. The final event is deliberately delayed until preparation completes, so this proves reuse/overlap rather than natural microphone latency. It stores no audio or credentials. Both live smoke files remain excluded from the default browser suite; running this config without a file filter runs both experiments.
