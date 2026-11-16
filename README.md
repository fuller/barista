# Barista

A text and browser-voice ordering simulator using a recorded Starbucks public menu. Browse products, build a cart, and attach literal customization requests. No payment or café submission. Not affiliated with Starbucks.

## Run locally

Clone this repository, enter its directory, then use Node 22.22.3 (pinned in `.node-version`) or Node 24.8+:

```sh
npm ci
cp .env.example .env
# Set OPENROUTER_API_KEY in .env.
npm run dev
```

Open http://127.0.0.1:4173. Restart after source or configuration changes. Keep `.env` private. Credentials belong only on the server. Without a configured provider, conversational ordering is unavailable; manual menu controls remain usable. Live interpretation sends text and relevant cart context to OpenRouter and can incur provider charges.

The default model is `perplexity/pplx-decider-v1.3:free`. `MENU_QUESTION_PROFILE=lean-v9` selects the current profile; `lean-v8` provides rollback. `DECISION_SCHEDULING=guarded-overlap` is the default; `sequential` provides rollback. A different model requires independent validation.

## Scope

The bundled directory contains 313 product/form identities. It is a recorded snapshot, not a current store inventory. Generic lines preserve source identity, size, quantity and literal request history. They do not represent a verified final recipe or cash price. Unpriced totals remain unknown. Confirmation only confirms the simulated cart.

Browser SpeechRecognition transcribes speech; availability depends on browser and service. Its final transcript follows the same path as typed input. The application stores no audio. Physical microphone accuracy is unmeasured.

The guarded single-item path can reduce a plain latte from three cold provider calls to two. It applies only to confident one-copy beverage requests into an empty cart without explicit size/weight. Uncertain requests retain the detail stage. Mixed-suite token savings were modest and latency varied; see [evaluation evidence](docs/evaluation.md).

## Develop

```sh
npm test
npm run check
npm run build
npm run test:e2e
npm run eval:menu
```

Unit/browser fixtures are deterministic; `eval:menu` validates golds without inference. Live evaluations require explicit `--live`. The build creates `dist/`.

See [architecture](docs/architecture.md), [testing](docs/testing.md), [evaluation](docs/evaluation.md), [data provenance](docs/data.md), and [contributing](CONTRIBUTING.md). Code licensing and upstream content are separate: see [LICENSE](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md).
