# Deploy to Cloudflare Workers

Use Node 22.22.3 (see `.node-version`) or Node 24.8+. Install the pinned toolchain:

```sh
npm ci
npx wrangler login
npm run deploy:dry-run
```

Wrangler opens Cloudflare authentication in your browser. Choose the intended account when prompted. For automation, provide a scoped Cloudflare API token through the hosting environment's secret storage. Keep account credentials outside source control.

`deploy:dry-run` runs the application build and validates/bundles the Worker without publishing it. It does not prove that production credentials, provider access, or Cloudflare runtime bindings work. The build embeds the browser assets in `dist/server/index.js`; no separate static hosting step is needed.

Review `wrangler.jsonc` and choose a unique Worker `name` before the first deployment. The checked-in non-secret settings select `lean-v9` and `guarded-overlap` explicitly. Upload the provider key only as a Worker secret:

```sh
npx wrangler secret put OPENROUTER_API_KEY
npm run deploy
```

Paste the key into Wrangler's secret prompt. Never place it in `wrangler.jsonc`, command arguments, browser code, or source control. If Wrangler asks to create the named Worker before the first secret upload, allow it, then deploy the application. Local `.env` files are not uploaded as production secrets. `.dev.vars` and its environment variants are private local Wrangler files and excluded from source releases.

The deploy command builds and publishes to the Worker's `workers.dev` URL. Preview URLs are disabled. After deploying, open the printed URL, check that live ordering is available, and exercise one short typed request. Provider calls incur charges under your account's terms.

## Public endpoint limits

The `TURN_RATE_LIMITER` native binding permits approximately 10 turn requests per 60 seconds per IP at each Cloudflare location. `REQUIRE_TURN_RATE_LIMIT=true` makes live turns fail closed when this binding or trusted Cloudflare IP metadata is unavailable. Keep that setting enabled for this deployment.

Cloudflare's limiter is approximate and local to each location, not a globally exact quota. Shared-IP users share a limit; distributed clients and traffic across locations can exceed it. It is abuse friction, not a spending cap or authentication system. Set a hard key budget or credit limit with the provider where supported, and monitor usage. Provider limits remain necessary even with this limiter.

Changing providers/models requires independent validation. To roll back the evaluated profile or scheduling, set `MENU_QUESTION_PROFILE` to `lean-v8` or `DECISION_SCHEDULING` to `sequential` in `wrangler.jsonc` and redeploy. Existing provider secrets remain server-side.
