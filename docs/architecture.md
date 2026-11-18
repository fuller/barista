# Architecture

The React client browses a validated menu snapshot and holds the cart in memory. The Worker serves the client and validates API requests. Provider credentials stay on the server. There is no login, payment, database or fulfillment integration.

## Code layout

| Directory | Responsibility |
| --- | --- |
| `src/catalog` | Source snapshots, menu validation, product identities |
| `src/domain` | Immutable cart commands, revisions, undo, money |
| `src/application` | Turn coordination, XState actors, quote orchestration |
| `src/adapters` | OpenRouter interpretation, browser speech, Starbucks protocols |
| `src/server` | HTTP validation, admission limits, safe diagnostics |
| `src/ui` | React views, actor subscriptions, query caches |

## Order interpretation

The browser sends text, the current cart and its latest undo snapshot to the server. Full undo history stays local. The model has no application session between calls.

Product selection chooses a source group, then an identity, keeping choice lists bounded. Detail questions resolve quantity and size. The default `lean-v10` profile skips detail only for eligible confident single-item beverage requests; uncertain applicability gets a selected-product decision. Confidence, margin, coverage and domain validation apply before committing. Dependent clauses use private drafts, and an accepted turn commits once. Clarification or failed validation leaves the cart unchanged.

Exact validated decisions can be cached or share pending provider work within one process or Worker isolate. Keys include credentials, model, profile, menu, thresholds and exact body; subscribers cancel independently. Cart routing runs live. Guarded overlap can request an eligible identity alongside routing, consuming only the validated selected branch. Other clauses remain sequential. See [evaluation](evaluation.md) for profiles, comparison commands and limits.

## Client lifecycle

[XState actors](state-machines.md) own voice, speculative preparation, final submission and cancellation. React renders actor state and keeps view-only state. Manual edits, cancellation and replacement turns invalidate stale responses.

Stable interim speech can prepare one interpretation without changing the cart. Only matching final text and an unchanged revision can adopt it. Speech synthesis uses accepted acknowledgements. See the state-machine guide for states, events and resource ownership.

## Menu and pricing

Menu queries use a memory cache and acquisition-aware HTTP ETags. Source synchronization validates snapshots before atomic replacement; UI refresh rereads the local snapshot. See [data](data.md).

Generic menu lines preserve source identity, size, quantity and literal customization requests. Those requests do not establish a computed recipe or cash price. Money is independent of model output; unknown amounts remain null.

The same-origin `/api/quote` endpoint resolves trusted size SKUs, calls an authenticated browser service, validates money and caches exact configurations until expiry. TanStack Query keeps quotes independent of cart commits and rejects stale revisions. The service owns isolated Chrome guest contexts outside the Worker and requires a separate host for public deployment. Unresolved modifiers remain unpriced. See [pricing](pricing.md) for setup, protocol and coverage.
