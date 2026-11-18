# Deploy to Cloudflare Workers

Use Node 22.22.3 (see `.node-version`) or Node 24.8+. Install the pinned toolchain:

```sh
npm ci
npx wrangler login
npm run deploy:dry-run
```

Wrangler opens Cloudflare authentication in your browser. Choose the intended account when prompted. For automation, provide a scoped Cloudflare API token through the hosting environment's secret storage. Keep account credentials outside source control.

`deploy:dry-run` runs the application build and validates/bundles the Worker without publishing it. It does not prove that production credentials, provider access, or Cloudflare runtime bindings work. The build embeds the browser assets in `dist/server/index.js`; no separate static hosting step is needed.

Review `wrangler.jsonc` and choose a unique Worker `name` before the first deployment. The checked-in non-secret settings select `lean-v10` and `guarded-overlap` explicitly. Upload the provider key only as a Worker secret:

```sh
npx wrangler secret put OPENROUTER_API_KEY
npm run deploy
```

Paste the key into Wrangler's secret prompt. Never place it in `wrangler.jsonc`, command arguments, browser code, or source control. If Wrangler asks to create the named Worker before the first secret upload, allow it, then deploy the application. Local `.env` files are not uploaded as production secrets. `.dev.vars` and its environment variants are private local Wrangler files and excluded from source releases.

The deploy command builds and publishes to the Worker's `workers.dev` URL. Preview URLs are disabled. After deploying, open the printed URL, check that live ordering is available, and exercise one short typed request. Provider calls incur charges under your account's terms.

## Browser pricing host

Real store quotes require a separate browser host. Cloudflare Containers access and a running Docker daemon are required to build and provision it. From the repository root, choose a unique Worker name in `deploy/browser/wrangler.jsonc`, then run:

```sh
npx wrangler secret put BARISTA_BROWSER_TOKEN --config deploy/browser/wrangler.jsonc
npx wrangler deploy --config deploy/browser/wrangler.jsonc
npx wrangler secret put BARISTA_BROWSER_TOKEN
npx wrangler secret put STARBUCKS_BROWSER_URL
npm run deploy
```

Use one random token of at least 32 characters for both secret prompts. For `STARBUCKS_BROWSER_URL`, enter the browser Worker's printed HTTPS origin, without a path or query. If the initial secret upload asks to create the Worker, allow creation. These values remain server-side; the browser Worker passes its token into the container only at runtime. Application CI deploys the application Worker; deploy browser host changes separately with its configuration.

The gateway authenticates requests before container startup and routes to one fixed Durable Object name. This code limits normal routing to one container; the Durable Object scheduling configuration does not enforce a `max_instances` setting. Each instance uses `standard-1` (0.5 vCPU, 4 GiB memory) and stops after 15 minutes of inactivity. A new instance starts with fresh guest sessions. Worker version metadata triggers one replacement on browser host deployments or token changes; repeat requests reuse that version even while Chrome is booting. Updates can interrupt in-flight quotes. Only the pricing HTTP service is forwarded; no VNC or Chrome debugging endpoint is provided.

Authenticated `GET /health` reports process status. `ready:false` is expected before the first quote creates a guest context; process health alone does not prove live prices. Authenticated status also exposes aggregate setup failure categories and numeric HTTP statuses, without page content or session credentials. The service attempts ordinary guest UI setup on demand. Website access denial, selector changes, startup delays or unsuccessful guest setup leave prices unavailable. Use **Refresh prices** after a transient startup failure. See [pricing setup](pricing.md) for session limits and coverage.

## Public endpoint limits

Speculative voice preparation uses the same API and rate-limit quota as final submissions. Matching final text reuses its HTTP turn; a correction or failed preparation can require one additional final HTTP turn (at most two per microphone session).

The `TURN_RATE_LIMITER` native binding permits approximately 10 turn requests per 60 seconds per IP at each Cloudflare location. `REQUIRE_TURN_RATE_LIMIT=true` makes live turns fail closed when this binding or trusted Cloudflare IP metadata is unavailable. Keep that setting enabled for this deployment.

Cloudflare's limiter is approximate and local to each location, not a globally exact quota. Shared-IP users share a limit; distributed clients and traffic across locations can exceed it. It is abuse friction, not a spending cap or authentication system. Set a hard key budget or credit limit with the provider where supported, and monitor usage. Provider limits remain necessary even with this limiter.

Changing providers/models requires independent validation. To roll back the evaluated profile or scheduling, set `MENU_QUESTION_PROFILE` to `lean-v9` (or `lean-v8`) or `DECISION_SCHEDULING` to `sequential` in `wrangler.jsonc` and redeploy. Existing provider secrets remain server-side.

## Automatic deployment from GitHub

The `CI` workflow tests pull requests without Cloudflare credentials. Every push to `main` runs unit/type/build/evaluation checks and browser tests. Only after both jobs pass does the production deployment job run. It uses Cloudflare's official Wrangler action, pinned to a commit, with the same pinned Wrangler version as the lockfile. Deployments are serialized; older runs skip publishing if their commit is no longer the tip of `main`.

Configure these repository Actions secrets in **Settings → Secrets and variables → Actions**:

- `CLOUDFLARE_ACCOUNT_ID`: the account that owns the Worker.
- `CLOUDFLARE_API_TOKEN`: a dedicated deployment API token scoped to that account. Use Cloudflare's **Edit Cloudflare Workers** template and narrow resources/permissions to this deployment. This Worker uses `workers.dev`, so no zone or custom-route access is needed.

Use an API token for CI rather than the local `wrangler login` OAuth credentials. Never commit the token. The OpenRouter key stays in the existing Worker secret; the workflow does not need it in GitHub. Ordinary Worker deployments preserve that secret.

The job records the URL in the GitHub `production` environment and checks the deployed home page, live configuration and nonempty menu. These checks make no model calls. A failed smoke check marks the deployment job failed; it does not automatically roll back the already-published Worker. Missing credentials fail explicitly. A manual rerun works only while that workflow's commit remains the tip of `main`; otherwise push a new commit.

Keep Wrangler's action input version synchronized with `package.json` when upgrading the toolchain. Keep branch rules or required reviews on `main` appropriate for who may publish code.

Sources: [Cloudflare's GitHub Actions guide](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) and the [official Wrangler action](https://github.com/cloudflare/wrangler-action).
