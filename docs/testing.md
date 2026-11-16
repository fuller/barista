# Testing

Run from the repository root after `npm ci`:

```sh
npm test
npm run check
npm run build
npm run test:e2e
npm run eval:menu
```

Unit tests cover domain validation, provider protocol handling, cancellation, source data and evaluation harnesses. Browser tests use a deterministic server fixture, not real inference. The pinned browser runtime may download Chromium. Mocked tests establish application behavior, not model accuracy.

The three active model corpora are documented in [evaluation](evaluation.md). Default validation does not call a provider. Live runs are explicit, consume request budgets and can incur charges. Never count errors or skipped cases as passes.

An optional synthetic browser-voice integration check lives in [experiments/live-voice](../experiments/live-voice/README.md). It uses real interpretation and requires a separately running configured server. It does not measure physical speech recognition or display paint.
