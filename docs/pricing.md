# Pricing

The UI shows stored **demo estimates** immediately, then requests verified store prices automatically. The versioned `src/catalog/data/demo-price-book.json` contains illustrative USD amounts for all 313 recorded product identities and 789 size entries. These are not current Starbucks prices. Demo estimates show a subtotal; tax and final total remain unknown. Literal customizations can change the eventual price.

`src/domain/demo-pricing.mjs` calculates estimates independently of model output. A complete validated live cart quote replaces the estimate. Partial or failed live quotes retain the whole-cart estimate; the application never mixes demo amounts into a verified total. Demo prices never enter the verified quote cache.

## HTTP service

Store lookup and live pricing use an authenticated Node HTTP service. Chrome is not required. Set `PRICING_SERVICE_TOKEN` to the same random secret of 32–512 characters in the service and application. Set the application's `STARBUCKS_PRICING_URL` to its origin. For local development, use `http://127.0.0.1:4174`, then run `npm run pricing:service` and `npm run dev` in separate terminals. See [deployment](deployment.md#pricing-service).

Store search is a small cached proxy for a fixed public Starbucks location endpoint. Searches share pending requests and cache sanitized public metadata for five minutes, up to 64 searches per layer. They never create guest sessions. The application validates and signs selected store identities for 24 hours. Without a service configured, local store lookup uses direct HTTP.

Opening the page and confirming a store create no pricing session. The first uncached cart quote creates an HttpOnly caller cookie and initializes an isolated anonymous upstream cookie jar. The service owns those jars in memory, serializes each caller's requests and cookie updates, and reuses guest state. Restarting the service discards sessions. Secrets and cookies never reach client responses or logs.

Starbucks can reject guest creation or pricing, including HTTP 429. The service honors cooldowns and performs no automatic retries or access-control workarounds. Such failures retain demo estimates. A healthy service establishes process availability, not upstream pricing access.

## Quote integrity and coverage

`POST /api/quote` verifies the signed store selection and resolves trusted size SKUs. Exact base configurations and a conservative plain-order grammar can be quoted. Unresolved literal modifiers remain unavailable for live pricing. Every menu item stays orderable. Live pricing accepts at most 50 lines and 100 units.

The protocol validates requested SKU and modifier echoes, quantities, USD currency, integer cents, arithmetic, expiry and complete tax. Unsupported fees, incomplete responses and mismatched configurations cannot produce a verified total. No checkout or purchase operation exists.

The private service accepts only rebuilt quote configurations, not arbitrary URLs. Its input is `{storeNumber, fulfillment?, items:[{itemId, sku, quantity, modifiers?:[{sku,quantity}]}]}`. Standard recipes use empty `childItems`; changes require actual source option SKUs. A modifier quantity describes the selected total, not an additional count. The recorded protocol fixture demonstrates parsing, not current prices.

## Caching

Server quotes are isolated by caller, store, fulfillment, SKU, quantity and modifiers. Pending requests coalesce. Expiry never exceeds upstream lifetime or five minutes. Cancellation does not cancel another subscriber's shared work. A cleared session cannot be repopulated by late work.

TanStack Query and a tab-scoped `sessionStorage` cache retain complete verified cart quotes: at most 32 entries and 512 KiB. Keys include caller namespace, source menu version, store and exact ordered configurations. Revision/history changes or new line IDs may reuse the same cart quote only after validation and row remapping. Corrupt, expired or mismatched records are discarded. Demo estimates are calculated locally and never persisted as verified quotes.

**Refresh prices** bypasses both cache layers. A failed refresh never extends old expiry. Product-detail reads deduplicate identities and use at most four concurrent requests. Cart commits do not wait for pricing.

## Verification

Default tests use deterministic fixtures and never contact Starbucks. `npm run pricing:probe -- --live` makes one ordinary guest attempt and, only on success, one quote. It prints safe status and normalized money, never credentials or provider bodies. Unavailable results exit with code 2 and are not live passes.
