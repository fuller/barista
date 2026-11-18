# Evaluation and measured limits

Four authored corpora exercise full-menu identity, size, quantity, literal requests, prior history and atomic clarification:

| Corpus | Cases | Role |
| --- | ---: | --- |
| `evals/menu-selection-dev.json` | 27 | Development regression |
| `evals/menu-selection-holdout.json` | 12 | Consumed holdout regression |
| `evals/menu-single-copy-regression.json` | 12 | Targeted quantity regression |
| `evals/menu-cart-context-regression.json` | 10 | Authored large-cart development regression |

The holdout has been inspected and must not be described as blind. These small corpora do not establish general model accuracy, physical voice accuracy, recipe correctness, pricing or real fulfillment.

## Reproduce

```sh
npm run eval:menu
npm run eval:menu -- --live --profile lean-v10 --split dev --max-requests 160 --output work/new-dev.json
npm run eval:menu -- --live --profile lean-v10 --corpus evals/menu-single-copy-regression.json --output work/new-target.json
node scripts/benchmark-menu-latency.mjs --live --profile lean-v10 --control-profile lean-v9 --scheduling guarded-overlap --control-scheduling guarded-overlap --output work/new-latency.json
node scripts/compare-menu-evals.mjs baseline.json candidate.json
```

Default evaluation validates fixtures without inference. Explicit live execution uses configured server credentials, bounded actual requests and unique output files. Do not run concurrent provider benchmarks. Restart the server before calling a browser observation cold. Missing usage remains unknown, not zero.

Reports retain corpus, grader, source and harness fingerprints. Compare matching cases, models, menus and complete coverage. Source changes, errors, unsafe mutations and passing-case regressions prevent a sound promotion claim. Different harness versions require review even when their golds match.

## Current v10 behavior

V10 keeps staged routing and complete selected-group menu choices. Its cart encoding retains every field, line position and literal instruction. It uses ordinary JSON when smaller. Uncertain size/count applicability goes to a selected-product question; final answers still require probability 0.85 and margin 0.15. Recipe amounts are not inferred from unsupported menu metadata.

Exact pure packets can share an in-flight provider call within one process/Worker isolate. Credential, model, profile, menu, thresholds and exact body partition reuse. Subscribers cancel independently. Only fully validated successful turns admit reusable answers; cart-routing decisions remain live. `totalRequests` counts physical dispatches, while successful pending joins increment `inflightHits`. Failed/cancelled joins do not increment that optional hit metric.

Browser requests carry current cart state and the latest undo snapshot. Full history remains local and each later undo sends its own next snapshot. A two-line cart with 101 snapshots measured 30,890 bytes before and 763 bytes after compaction (97.5% smaller). This is browser-to-server transport savings, not model-token savings. Current cart contents still obey the HTTP payload limit.

The final development pass covered 51 existing cases with no failures and 9/10 new large-cart cases with no wrong mutations. The remaining case, “Make the oat milk latte four copies,” conservatively retries because action confidence is below the unchanged threshold. These consumed development cases do not establish general model accuracy. One new missing-target case was independently reworded to explicitly reference an existing cart line after its original wording proved ambiguous; its clarification expectation was retained.

A fused all-menu routing experiment increased input tokens and failed accuracy gates. It was rejected and is excluded from the release. Canonical modifier-state extraction was also excluded: literal requests remain authoritative.

### Current measurements

Two matched development runs: cold V9 passed 25/27; cold V10 passed 27/27. Both used 80 calls. V10 input tokens rose 1.7% (148,776 → 151,326), with two more cases accepted correctly. V10 passed all 12 consumed cases and all 12 targeted quantity cases.

Cold development median/p95 varied: V10 was slower on one measure and faster on another across the two runs. No consistent cold latency gain is established. Repeating the identical development suite with a primed cache used 34 calls and 51,500 input tokens; median was 493–506 ms. This measures exact reuse and is not a claim about unique customer requests or a new gain over V9's existing warm cache.

The final combined 61-case run passed 60, with one false clarification and no wrong/unsafe mutations. Full unit/type/build checks and 34 browser tests passed. These are bounded regression results, not a production accuracy guarantee.

- [Final 61-case raw regression](evaluation-results/2026-11-17/menu-v10-regression.json), including suite-assembly provenance.
- [Matched benchmark summaries and per-case outcomes](evaluation-results/2026-11-17/optimization-summary.json).

## Progressive voice preparation

The browser displays current interim recognition text and can start one interpretation after 650 ms of stable text. The preview is hypothetical: it has no effect on committed quantities, totals, history or confirmation. A final transcript adopts preparation only when trim-normalized text and cart revision match exactly; otherwise the final request follows the ordinary path. Changed or withdrawn interim results invalidate preparation without starting another speculative request in that session.

592 unit tests and 42 deterministic browser tests passed for this implementation. Coverage includes completed and pending adoption, corrected finals, failed preparation, withdrawn hypotheses, manual edits, recognition errors, overlong finals and timing isolation. No model questions or confidence gates changed; the recorded menu-model regressions above remain evidence for their recorded source versions.

A separate [real-provider preparation smoke](evaluation-results/2026-11-17/progressive-voice.json) used synthetic speech events with the real local API and a fresh process cache. It made one HTTP turn and two provider calls. Provider response parsing completed before the synthetic final event; final-to-command application was 0.4 ms and final-to-next-animation-frame was 14.3 ms.

The test deliberately waited until the preview was ready before emitting final speech. It proves request reuse and overlap, not typical microphone latency, endpointing speed or physical paint. If final speech arrives before preparation completes, the browser waits for the same pending request. Changed text can discard completed provider work and require one additional final HTTP turn. Exact matching protects corrections but reduces reuse when the recognizer changes capitalization or punctuation.

Timing from a discarded preparation remains isolated from the final request. Adopted pending requests retain their original physical fetch timestamps; completed preparation can correctly show fetch/response milestones before final speech. See the [opt-in reproduction commands](../experiments/live-voice/README.md).

## Retained v9 evidence

Both matched development runs passed all 27 cases in every condition. Cold v8 used 83 calls and 152,112 input tokens; cold v9 used 80 calls and 148,862 input tokens: 3.6% fewer calls and 2.1% fewer input tokens. The consumed 12-case suite passed for both profiles with unchanged cold calls/tokens. Both profiles passed the 12 targeted cases; calls fell 41 to 37.

A plain latte fell from three cold calls to two and from 7,198 to 6,118 input tokens (15%). Eligibility is narrow: a single beverage clause into an empty cart without explicit size/weight, with confident ADD and single-copy decisions. Other or uncertain answers retain the existing detail stage. Warm development input rose about 1% relative to the preceding v8 observation. Provider prompt-cache hits were not established.

Observed latency varied: development p95 improved in one matched run and worsened in the other. No consistent p95 gain or production latency guarantee is established. Synthetic browser-voice evidence checks integration only; final-transcript-to-frame timing does not measure microphone endpointing or physical display paint.

Retained raw reports:

- [Development run 1](evaluation-results/2026-11-15/latency-guarded-single-v9-r1.json)
- [Development run 2](evaluation-results/2026-11-15/latency-guarded-single-v9-r2.json)
- [Consumed regression](evaluation-results/2026-11-15/latency-guarded-single-v9-consumed-regression.json)
- [Targeted v8](evaluation-results/2026-11-15/single-targeted-v8-final.json) and [targeted v9](evaluation-results/2026-11-15/single-targeted-v9-final.json)
- [Synthetic browser voice](evaluation-results/2026-11-15/voice-guarded-single-v9.json)

Reports describe their recorded source revisions. Later cleanup does not retroactively revalidate those measurements against new source fingerprints.
