# Barista

A text and browser-voice ordering simulator using a recorded Starbucks public menu. Browse products, build a cart, and add customization requests. No payment or café submission. Not affiliated with Starbucks.

[Try the live app](https://barista-order-lab.andrew-fuller.workers.dev).

## Run locally

Use Node 22.22.3 (pinned in `.node-version`) or Node 24.8+:

```sh
git clone https://github.com/fuller/barista.git
cd barista
npm ci
cp .env.example .env
# Set OPENROUTER_API_KEY in .env.
npm run dev
```

Open http://127.0.0.1:4173. Restart after source or configuration changes. Keep credentials on the server; never commit `.env`.

Conversational ordering uses OpenRouter and sends text and relevant cart context to the configured model. The default is `perplexity/pplx-decider-v1.3:free`; provider calls can incur charges. Without a configured provider, manual menu controls remain available.

## What to expect

- The menu is a recorded snapshot, not current store inventory.
- Customization requests remain literal text unless resolved by the recipe model. They do not establish a verified café recipe.
- Optional store pricing requires a separate Chrome browser service. Unknown prices stay unknown; sample prices are never substituted. See [pricing setup](docs/pricing.md).
- Browser speech recognition depends on browser and service availability. Stable interim text may be interpreted before speech finishes; only final matching speech can update the cart. Audio is not stored by this application.
- The cart lives in browser memory. Reloading clears it. Confirmation only confirms the simulated cart.

## Develop

```sh
npm test
npm run check
npm run build
npm run test:e2e
npm run eval:menu
```

Tests use deterministic fixtures. `eval:menu` validates evaluation cases without inference; live evaluations require explicit `--live`.

## Documentation

| Guide | Purpose |
| --- | --- |
| [Architecture](docs/architecture.md) | Code layout, decision pipeline, and data flow |
| [State machines](docs/state-machines.md) | Voice and ordering states, events, and cancellation |
| [Testing](docs/testing.md) | Local checks and test coverage |
| [Evaluation](docs/evaluation.md) | Model quality, token, and latency evaluation |
| [Pricing](docs/pricing.md) | Browser pricing service setup and coverage |
| [Deployment](docs/deployment.md) | Cloudflare configuration and CI deployment |
| [Data](docs/data.md) | Menu provenance and refresh |
| [Contributing](CONTRIBUTING.md) | Contribution workflow |
| [Security](SECURITY.md) | Reporting vulnerabilities and deployment boundaries |

Code licensing and upstream content are separate: see [LICENSE](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md).
