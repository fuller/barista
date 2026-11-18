# Barista

A text and browser-voice ordering simulator using a recorded Starbucks public menu. Browse products, build a cart, and attach literal customization requests. No payment or café submission. Not affiliated with Starbucks.

[Try the live app](https://barista-order-lab.andrew-fuller.workers.dev).

## Run locally

Clone this repository, enter its directory, then use Node 22.22.3 (pinned in `.node-version`) or Node 24.8+:

```sh
npm ci
cp .env.example .env
# Set OPENROUTER_API_KEY in .env.
npm run dev
```

Open http://127.0.0.1:4173. Restart after source or configuration changes. Keep `.env` private. Credentials belong only on the server. Without a configured provider, conversational ordering is unavailable; manual menu controls remain usable. Live interpretation sends text and relevant cart context to OpenRouter and can incur provider charges.

The default model is `perplexity/pplx-decider-v1.3:free`. `MENU_QUESTION_PROFILE=lean-v10` selects the current profile; `lean-v9` and `lean-v8` provide rollback. `DECISION_SCHEDULING=guarded-overlap` is the default; `sequential` provides rollback. A different model requires independent validation.

Optional real store pricing uses a separate normal Chrome guest browser service: set the shared server-only token and service URL, then run `npm run pricing:browser` alongside the app. See [pricing setup and coverage](docs/pricing.md). Quotes include store tax, expire with the provider, and never fall back to sample prices. Public deployment needs a separate HTTPS browser-service host.

## Deploy

Deploy the portable Worker to Cloudflare: [deployment guide](docs/deployment.md).

## Scope

The bundled directory contains 313 product/form identities. It is a recorded snapshot, not a current store inventory. Generic lines preserve source identity, size, quantity and literal request history. Exact base configurations can receive live store quotes when browser pricing is configured; unresolved customization requests do not represent a verified final recipe or cash price. Unpriced totals remain unknown. Confirmation only confirms the simulated cart.

Browser SpeechRecognition transcribes speech; availability depends on browser and service. Interim text appears immediately. After 650 ms of unchanged text, one speculative interpretation can produce a separate order preview. Only matching final text and an unchanged cart can reuse it and commit. Stable interim text and cart context can therefore be sent to OpenRouter before speech finishes. No audio is stored; physical microphone accuracy and latency are unmeasured.

The guarded single-item path can reduce a plain latte from three cold provider calls to two. It applies only to confident one-copy beverage requests into an empty cart without explicit size/weight. Uncertain requests retain the detail stage. Routing uses a lossless columnar cart when smaller. Uncertain size/count applicability gets a selected-product decision at the same confidence threshold. Exact pure requests can share pending work; cart routing always runs live. Full undo history stays local; requests carry only the next undo snapshot. See [evaluation evidence](docs/evaluation.md).

## Develop

```sh
npm test
npm run check
npm run build
npm run test:e2e
npm run eval:menu
```

Unit/browser fixtures are deterministic; `eval:menu` validates golds without inference. Live evaluations require explicit `--live`. The build creates `dist/`.

See [architecture](docs/architecture.md), [testing](docs/testing.md), [evaluation](docs/evaluation.md), [store-pricing backend status](docs/pricing.md), [data provenance](docs/data.md), and [contributing](CONTRIBUTING.md). Code licensing and upstream content are separate: see [LICENSE](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md).
