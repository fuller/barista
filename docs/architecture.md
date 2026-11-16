# Architecture

The React client browses the validated menu directory and holds the cart in memory. Reloading loses the cart. The local server serves the client and validates API requests; only the server holds provider credentials.

`src/catalog` validates recorded source snapshots and explicit identities. `src/domain` validates immutable order commands and revision history. `src/application` coordinates turns, cancellation and stale responses. `src/adapters` translates text through bounded OpenRouter Decisions/Extractions requests. `src/server` owns HTTP validation and safe diagnostics. `src/ui` owns browser interaction and memory caches.

Product selection first chooses a source group, then a source identity, keeping choice lists bounded. Numeric detail resolves quantity and source size. The v9 shortcut may skip that detail stage for a confident single copy in a narrowly eligible empty-cart beverage request; v8 remains the rollback. Probability, margin, coverage and domain validation still apply. Dependent clauses execute against private drafts; an accepted turn commits once. Clarification and failed validation leave the cart unchanged.

The application supplies context on every request. A bounded server-memory cache reuses exact validated decisions; failed turns admit nothing. Guarded overlap can schedule an eligible identity request alongside fresh routing; only the selected validated branch is consumed. Other clauses remain sequential.

Generic menu lines store literal customization requests, not computed recipes. Money is independent of model output. Source directory lines have no verified cash price; unknown totals remain null. Internal recipe compatibility data does not establish generic menu pricing or customization support.

Pending requests bind to cart revisions. Manual changes, cancellation and new turns invalidate stale responses, even when upstream cancellation cannot stop a dispatched request. Browser recognition emits final text into the same turn flow; speech synthesis consumes accepted acknowledgements.

Menu queries use a browser memory cache and acquisition-aware HTTP ETags. Explicit source synchronization validates data before atomic replacement; UI refresh rereads the local snapshot. There is no login, payment, database or fulfillment integration.
