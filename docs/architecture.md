# Architecture

The React client browses a validated menu snapshot and holds the cart in memory. The Worker serves the client and validates API requests. Provider credentials stay on the server. There is no login, payment, database or fulfillment integration.

## Code layout

| Directory | Responsibility |
| --- | --- |
| `src/catalog` | Source snapshots, menu validation, product identities |
| `src/domain` | Immutable cart commands, revisions, undo, money |
| `src/application` | Turn coordination, XState actors, quote orchestration |
| `src/adapters` | OpenRouter interpretation, browser speech, Starbucks protocols |
| `src/services` | Private HTTP pricing boundary and public store proxy |
| `src/server` | HTTP validation, admission limits, safe diagnostics |
| `src/ui` | React views, actor subscriptions, query caches |

## Order interpretation

The browser sends text, the current cart and its latest undo snapshot to the server. Full undo history stays local. The model has no application session between calls.

Product selection keeps source groups and identity choices bounded. On an empty cart, the current profile can batch independent beverage additions after exact clause boundaries are validated: at most two clauses and twelve questions per provider request. Each owning clause must independently pass coverage, action, product-group, identity, copy-count and size confidence checks. Source sizes and the complete command list are validated before one cart commit. Unproven, mixed or dependent requests use the existing group/identity pipeline; pending clarifications skip this shortcut. Detail questions resolve quantity and size. The default `lean-v10` profile skips detail only for eligible confident single-item beverage requests; uncertain applicability gets a selected-product decision. Confidence, margin, coverage and domain validation apply before committing. Dependent clauses use private drafts, and an accepted turn commits once. Clarification or failed validation leaves the cart unchanged.

Exact validated decisions can be cached or share pending provider work within one process or Worker isolate. Keys include credentials, model, profile, menu, thresholds and exact body; subscribers cancel independently. Cart routing runs live. Guarded overlap can request an eligible identity alongside routing, consuming only the validated selected branch. Other clauses remain sequential. See [evaluation](evaluation.md) for profiles, comparison commands and limits.

## Client lifecycle

[XState actors](state-machines.md) own voice, speculative preparation, final submission and cancellation. React renders actor state and keeps view-only state. Manual edits, cancellation and replacement turns invalidate stale responses.

Stable interim speech can prepare an interpretation without changing the cart. One replacement preparation is allowed after a transcript correction; each microphone session has at most two preparation attempts and one active candidate. Only matching final text and an unchanged revision can adopt it. Speech synthesis uses accepted acknowledgements. See the state-machine guide for states, events and resource ownership.

## Menu and pricing

Menu queries use a memory cache and acquisition-aware HTTP ETags. Source synchronization validates snapshots before atomic replacement; UI refresh rereads the local snapshot. See [data](data.md).

Generic menu lines preserve source identity, size, quantity and literal customization requests. Those requests do not establish a computed recipe. Money is independent of model output. A versioned local price book provides clearly labeled demo estimates; estimated tax and final totals remain null.

Ordering starts with a ZIP/city or nearby search through `/api/stores` and explicit café confirmation. This is a cached HTTP-only lookup with bounded query validation and shared pending requests; it creates no guest session and has no browser fallback. **Use my location** requests browser geolocation only after a click. Coordinates are rounded to four decimal places and sent as `lat`/`lng`; permission denial, unavailable location and timeout retain manual search. Late location callbacks cannot replace a newer search. The server signs normalized store identities for 24 hours, so later Worker requests can verify selections without a shared database. Store choice gates manual additions, typed orders and voice input. Changing it preserves the cart and cancels older work.

Demo prices render synchronously from the local price book. TanStack Query requests live quotes in the background. Only a complete validated live quote replaces the estimate; failures and partial results keep the demo subtotal visible.

Pricing sessions start on the first uncached cart quote after adding an item. Page load and store confirmation create no pricing cookie or guest session. The same-origin `/api/quote` verifies the selected store, resolves trusted size SKUs and calls an authenticated HTTP service. That service owns bounded per-caller upstream cookie jars in one Node process. It uses ordinary API requests, serializes cookie updates and respects access-denial cooldowns. No Chrome runtime is involved.

Verified quotes are cached independently of cart commits. Exact configurations reuse whole quotes only through their original expiry; money, store, caller namespace and configuration are revalidated before remapping rows. Demo data never enters this cache. Explicit refresh bypasses both layers. Product-detail reads deduplicate identities and use at most four concurrent requests. Unresolved modifiers remain unavailable for live quotes. See [pricing](pricing.md) for contracts, coverage and setup.
