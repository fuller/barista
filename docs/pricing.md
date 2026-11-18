# Store pricing backend

The cart requests real quotes through `POST /api/quote` when a browser pricing service is configured. It uses an ordinary headful Chrome guest session and never substitutes illustrative prices.

## Run browser pricing

Install Google Chrome and project dependencies on a host with a display. Set `BARISTA_BROWSER_TOKEN` to a random secret of at least 32 characters in `.env`, and set `STARBUCKS_BROWSER_URL=http://127.0.0.1:4174` for a local app. The browser process and app server must share the token. Start `npm run pricing:browser` and `npm run dev` in separate terminals. `npm run pricing:browser -- --check` prints safe readiness counts; zero exit status means at least one guest context is ready. No context exists until the first quote.

Each caller receives a separate fresh browser context. The service attempts ordinary website actions to select 104 Jay St, Brooklyn 11201, add a sample drink to the guest website cart, and review that cart to initialize the guest session. This does not submit or pay for an order. A successful guest response is required for readiness. UI changes or access denial leave prices unavailable. The visible service browser can finish normal guest setup; never sign into a personal account there. Use **Refresh prices** after setup. There are no challenge workarounds, imported cookies, direct guest bootstrap calls, or automatic retries after failures.

The service supports four contexts, rejects work while a context is busy, closes idle contexts after 15 minutes, and respects upstream rate-limit cooldowns. Credentials remain inside Chrome. Its authenticated HTTP boundary accepts only rebuilt quote configurations and returns a whitelist of price fields; order identifiers and authentication data do not leave the service.

For Cloudflare deployment, run the browser service on a separate host with Chrome and a display, expose it through an authenticated HTTPS origin, and configure server-only `STARBUCKS_BROWSER_URL` and `BARISTA_BROWSER_TOKEN` secrets on the Worker. Localhost refers to the Worker itself and cannot reach your computer. The browser service defaults to loopback; configure `BARISTA_BROWSER_HOST` explicitly behind your HTTPS proxy. HTTPS is required except for local loopback development. Never expose Chrome debugging ports. This repository does not provision a browser host or public tunnel.

## Coverage and cart behavior

The server resolves source identities and size SKUs from the trusted menu directory/product details. Exact base configurations and a conservative plain-order grammar are supported; unresolved free-text modifiers, multi-item prose, or unsupported source shapes remain unpriced rather than receiving an incorrect base price. Every menu item remains orderable. Pricing currently accepts up to 50 lines and 100 units; larger carts remain orderable with unavailable prices. Modifier SKUs can be quoted by the lower-level protocol once their exact mapping is known; the generic free-text cart does not yet compile them to source options.

The browser quote is cached by private caller, store, fulfillment, SKU, quantity, and modifier configuration, only until its returned expiry (at most five minutes). The UI keys requests by the full cart state, rejects stale revisions, hides expired prices, and offers an explicit refresh after failures. Voice/cart commits do not wait for prices. Partial prices never produce a misleading cart total or tax amount.

## Components

- `src/adapters/starbucks-guest-session.mjs` owns a fixed-origin guest bootstrap and quote transport. It keeps bounded cookie jars in server memory, separates caller sessions, reuses guest state, handles expiry and timeouts, and observes upstream cooldowns. A 429 blocks new requests across session keys for the backoff period. It performs no automatic retries and never imports browser cookies or synthesizes reputation/security values.
- `src/adapters/starbucks-quote-protocol.mjs` builds requests from explicit configured SKUs and normalizes verified responses into integer cents. It preserves store and fulfillment, expands quantities into individual units, and checks response keys, requested modifier SKUs/counts, currency and arithmetic. The returned modifier line price is already the line charge; it must not be multiplied by the selected shot count.
- `src/application/starbucks-quote-service.mjs` composes the source and protocol. It deduplicates pending requests and caches exact configurations within one caller session. Cache and pending cardinality are bounded. Cancelled callers do not cancel shared work for another waiter. Clearing a session prevents deferred or late work from recreating its cached quote. Expiration is bounded by the upstream lifetime and measured conservatively from dispatch.

The internal input is `{storeNumber, fulfillment?, items:[{itemId, sku, quantity, modifiers?:[{sku,quantity}]}]}`. A session key must be generated and owned by the trusted server caller; it is not an upstream cookie. The core is not an arbitrary URL proxy or a public raw-SKU endpoint.

Standard recipes can use empty `childItems`; selected changes use their actual source option SKUs. Option SKU `55`, quantity `3` means three total shots, not three extra shots. Known public-client fulfillment values are `CONSUME_IN_STORE` / `CONSUME_OUT_OF_STORE` and `IN_STORE` / `DRIVE_THRU`. The sanitized [price-order.json](../tests/fixtures/starbucks/price-order.json) fixture covers the default take-away/in-café combination; it does not establish current prices or other fulfillment coverage.

The response must echo requested modifier SKUs and counts. Configurations with missing echoes, unavailable items, unsupported fees, incomplete tax, expired quotes or mismatched money are unavailable. This deliberately limits quote coverage; it does not restrict which menu items may be added to the application's cart.

## Opt-in runtime proof

```sh
npm run pricing:probe -- --live
```

This makes one ordinary backend guest-creation attempt and, only if that succeeds with usable cookies, one quote for the recorded store/SKU. It prints only safe status, retry metadata and normalized money. No cookies, authentication response bodies, provider error bodies or order identifiers are printed. No checkout or purchase operation exists in this core. Running without `--live` does not contact Starbucks. An unavailable result exits with code 2 and must never be counted as a live pass.

Deterministic tests inject transport fixtures. They establish protocol, money, cancellation and session behavior, not upstream reachability. Default tests never call Starbucks.

## Integration boundaries

Do not work around access denial, copy a user's Starbucks cookies or treat browser-only access as direct Worker support. The standalone browser service owns guest contexts; Worker quote caches are process-local optimizations, not session owners. An opaque HttpOnly same-site cookie correlates the caller to that service context.

Generic menu lines contain literal instructions; an unresolved instruction must remain unpriced rather than receiving a base-only quote. The admitted same-origin endpoint bounds concurrent work and body sizes. Store/configuration changes invalidate pending UI quotes. Never label illustrative fallback prices as official store quotes.

Cookie jars and any future session store are secrets. Keep them out of client responses, logs, shared caches, repository fixtures and source archives. Session/offer-specific prices must not be shared across users.
