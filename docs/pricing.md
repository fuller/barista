# Store pricing backend

The application still displays illustrative prices or unknown prices. The new backend core is not connected to an HTTP route or the cart UI. Ordinary backend guest creation returned HTTP 429 during verification, so live pricing is not enabled. A successful browser quote does not establish server or Worker access.

The verified website flow is café selection, product selection, a guest session, then a configured-cart quote. No account login was needed. On November 18, 2026, the public website quoted a grande Iced Sugar Cookie Latte at 104 Jay St, Brooklyn, at $7.75 plus $0.69 tax. Three total shots changed the subtotal to $8.25 and the total to $8.98. These are recorded observations, not current prices for every store. The sanitized fixture is [price-order.json](../tests/fixtures/starbucks/price-order.json).

## Components

- `src/adapters/starbucks-guest-session.mjs` owns a fixed-origin guest bootstrap and quote transport. It keeps bounded cookie jars in server memory, separates caller sessions, reuses guest state, handles expiry and timeouts, and observes upstream cooldowns. A 429 blocks new requests across session keys for the backoff period. It performs no automatic retries and never imports browser cookies or synthesizes reputation/security values.
- `src/adapters/starbucks-quote-protocol.mjs` builds requests from explicit configured SKUs and normalizes verified responses into integer cents. It preserves store and fulfillment, expands quantities into individual units, and checks response keys, requested modifier SKUs/counts, currency and arithmetic. The returned modifier line price is already the line charge; it must not be multiplied by the selected shot count.
- `src/application/starbucks-quote-service.mjs` composes the source and protocol. It deduplicates pending requests and caches exact configurations within one caller session. Cache and pending cardinality are bounded. Cancelled callers do not cancel shared work for another waiter. Clearing a session prevents deferred or late work from recreating its cached quote. Expiration is bounded by the upstream lifetime and measured conservatively from dispatch.

The internal input is `{storeNumber, fulfillment?, items:[{itemId, sku, quantity, modifiers?:[{sku,quantity}]}]}`. A session key must be generated and owned by the trusted server caller; it is not an upstream cookie. The core is not an arbitrary URL proxy or a public raw-SKU endpoint.

Standard recipes can use empty `childItems`; selected changes use their actual source option SKUs. For the recorded extra-shot example, option SKU `55`, quantity `3` means three total shots, not three extra shots. Known public-client fulfillment values are `CONSUME_IN_STORE` / `CONSUME_OUT_OF_STORE` and `IN_STORE` / `DRIVE_THRU`. Only the default take-away/in-café combination has a captured live response here.

The response must echo requested modifier SKUs and counts. Configurations with missing echoes, unavailable items, unsupported fees, incomplete tax, expired quotes or mismatched money are unavailable. This deliberately limits quote coverage; it does not restrict which menu items may be added to the application's cart.

## Opt-in runtime proof

```sh
npm run pricing:probe -- --live
```

This makes one ordinary backend guest-creation attempt and, only if that succeeds with usable cookies, one quote for the recorded store/SKU. It prints only safe status, retry metadata and normalized money. No cookies, authentication response bodies, provider error bodies or order identifiers are printed. No checkout or purchase operation exists in this core. Running without `--live` does not contact Starbucks. An unavailable result exits with code 2 and must never be counted as a live pass.

Deterministic tests inject transport fixtures. They establish protocol, money, cancellation and session behavior, not upstream reachability. Default tests never call Starbucks.

## Before connecting the cart

First verify ordinary guest bootstrap and quoting in the intended runtime. Do not work around access denial, copy a user's Starbucks cookies or treat browser-only access as Worker support. The current core uses process-local state; Worker isolates do not guarantee session affinity. Production wiring needs an appropriate session-owning runtime, such as a deliberately designed Durable Object, after upstream access is established.

Then resolve application orders to server-owned product-size and modifier SKUs. Generic menu lines contain literal instructions; an unresolved instruction must remain unpriced rather than receiving a base-only quote. Add a bounded, admitted, same-origin quote endpoint and a revision-bound asynchronous UI query. Store/configuration changes invalidate pending quotes. Prices must load independently of voice/cart commits, and failures must remain explicitly unavailable. Never label illustrative fallback prices as official store quotes.

Cookie jars and any future session store are secrets. Keep them out of client responses, logs, shared caches, repository fixtures and source archives. Session/offer-specific prices must not be shared across users.
