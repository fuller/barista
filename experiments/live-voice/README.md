# Opt-in real OpenRouter browser benchmark

Start a fresh isolated application server with real OpenRouter credentials and a hard provider request guard. Build and run the included guard server in one terminal:

```sh
npm run build
node experiments/live-voice/server.mjs
```

Run the explicit suite in another terminal. Its same-origin `GET /_benchmark/status` must return `{requestCount,maxRequests:60,budgetExceeded}`. The benchmark reads no credentials and starts no server. Do not share that server with another benchmark.

```sh
LIVE_VOICE_BASE_URL=http://127.0.0.1:4185 E2E_TELEMETRY_DISABLED=1 npm exec -- e2e run --no-cache --config e2e.live-voice.config.ts --output work/live-voice-browser
```

Ten sequential cases cover cold latte, warm identical repeat, second-latte setup, ambiguous target requiring clarification with unchanged cart, American/cold-brew recognition, iced/oat/extra-shot modifiers, size/decaf follow-up, trenti/half-syrup ownership, stable preparation and revised preparation. No retries. The browser allows at most twelve HTTP turns and stops admitting cases at sixty provider requests; the server enforces the absolute sixty-request cap, including canceled preparation work.

Configuration and interpretation endpoints remain real. Only product photos, store search and background pricing are isolated. The store fixture enables the UI gate without starting external pricing sessions.

Synthetic SpeechRecognition excludes physical microphone, actual transcription and natural endpointing latency. Stable interim begins immediately and final arrives after 1200ms regardless of model readiness. Revised interim arrives at 900ms and final at 2000ms. These are controlled speech cadences, not a preview-ready best case. Local timing reports microphone-start-to-next-frame and final-to-commands/next-frame; an animation callback does not prove physical paint.

The harness reads the committed React root’s cart props, verifies item identity, size, quantity and instruction ownership, and correlates cart DOM item count. Owning full clauses/request histories must match exactly after whitespace normalization, including numeric extra-shot amount; extra or contradictory text fails. Plain drink scaffolding remains part of the preserved history. Legacy recipe carts fail this full-menu oracle. Successful turns must advance revision and expose a matching committed-revision/current-turn frame sample before capture. Prepared cases must dispatch the exact interim sequence entirely before final speech, with zero post-final requests. Clarifications must preserve the complete cart. This test-only snapshot reader intentionally fails if React internals change rather than substituting heading-only checks.

Unique JSON artifacts under `work/live-voice-smoke/` record model, case IDs, phase, pass/fail stage, safe synthetic cart summaries, local milestones, HTTP turns including aborts, returned request/cache metrics and authoritative provider counts from the server guard. Only fixed synthetic order/request histories are saved; no live user audio, credentials, headers, cookies or raw provider responses are saved. Ordinary accuracy failures are collected; transport or budget failures halt further cases. Cold labels require a fresh server whose initial process-local `serverRequests` count is zero (or `requestCount` zero when no process-local counter exists); cumulative provider counts can retain earlier attempts under the same global budget. The warm repeat records observed cache behavior rather than assuming a cache hit.

Default application E2E configuration excludes this directory. Listing this explicit suite makes no provider calls.

Use `LIVE_VOICE_CASES` as a comma-separated list of case IDs to select a budgeted subset; defaults to all ten. Ambiguity and modifier follow-ups use independent manual seeds, consuming no provider requests. Timing is captured before cart accuracy assertions. Unexpected clarification remains a failure with safe reason/field and clarification diagnostics.
