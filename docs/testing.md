# Testing

Run from the repository root after `npm ci`:

```sh
npm test
npm run check
npm run build
npm run test:e2e
npm run eval:menu
```

Unit tests cover domain validation, provider protocol handling, cancellation, source data, speculative voice preparation and evaluation harnesses. Progressive voice browser regressions exercise completed/in-flight adoption, corrections, failed preparation, withdrawn hypotheses, manual edits, recognition errors, and transcript limits. Browser tests use a deterministic server fixture, not real inference. The pinned browser runtime may download Chromium. Mocked tests establish application behavior, not model accuracy.

The [state machines](state-machines.md) have transition tests in `tests/ordering-machine.test.mjs` and `tests/voice-preparation-machine.test.mjs`. They cover actor cleanup, request transfer, stale responses, revision correlation and native timer binding. Browser regressions exercise the React Strict Mode integration.

The four active model corpora are documented in [evaluation](evaluation.md). Default validation does not call a provider. Live runs are explicit, consume request budgets and can incur charges. Never count errors or skipped cases as passes.

Store tests cover HTTP-only lookup, bounded caches, request coalescing, cooldowns and signed selection. Pricing tests cover demo-book completeness, integer money, unknown tax, configured-SKU protocols, lazy sessions, per-caller serialization, cancellation and response sanitization. UI tests verify immediate estimates while live requests are pending or failing, complete live replacement and exclusion of demo data from verified caches. Cache tests cover store/revision/configuration correlation, expiry, corrupt storage, caller-scope rotation, undo/re-add reuse and explicit refresh bypass. The opt-in `npm run pricing:probe -- --live` attempts an ordinary guest session and quote; no operation submits an order. See [pricing](pricing.md).

An optional synthetic browser-voice integration check lives in [experiments/live-voice](../experiments/live-voice/README.md). It uses real interpretation and requires a separately running configured server. It does not measure physical speech recognition or display paint.

## Interaction benchmark

Run `npm run benchmark:interactions` for deterministic manual and voice latency samples. Results go to `work/interaction-manual.json` and `work/interaction-voice.json`. Manual samples exercise 30 additions and 30 size changes with a 30-item cart. Voice samples revise interim speech and use a fixed 200 ms mocked inference delay, checking that only the matching final drink reaches the cart. Reports include median, p95 and HTTP turn counts.

These measure synthetic DOM-event/final-transcript to cart DOM at an animation frame. They do not measure physical paint, field INP, microphone recognition latency or live provider speed. Compare runs on the same hardware and browser without concurrent benchmark workloads. Timing is reported rather than enforced as a brittle shared-runner threshold; correctness assertions still fail the run.
