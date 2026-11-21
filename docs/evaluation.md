# Evaluation

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
npm run eval:menu -- --live --profile lean-v10 --corpus evals/menu-single-copy-regression.json --max-requests 160 --output work/new-target.json
npm run eval:menu -- --live --profile lean-v10 --corpus evals/menu-cart-context-regression.json --max-requests 160 --output work/new-cart.json
npm run eval:menu -- --live --profile lean-v10 --split holdout --max-requests 160 --output work/new-holdout.json
npm run benchmark:menu -- --live --profile lean-v10 --control-profile lean-v9 --max-requests 250 --scheduling guarded-overlap --control-scheduling guarded-overlap --output work/new-latency.json
node scripts/compare-menu-evals.mjs baseline.json candidate.json
```

Default evaluation validates the selected corpus without inference. Live evaluation reads `OPENROUTER_API_KEY` from the environment or repository `.env`; `DECISION_MODEL` or `--model` selects the model. Live runs can incur charges. Use unique output files under ignored `work/`. Existing report files are never overwritten. Do not run concurrent provider benchmarks. Restart the server before calling a browser observation cold. Missing usage remains unknown, not zero.

Evaluation defaults to 160 physical requests and concurrency 3; `--max-requests` accepts 0–5000 and `--concurrency` accepts 1–3. Latency benchmarks allow 1–250 requests total across conditions, capped at 150 for `--split holdout`. Budget exhaustion can leave cases unrun; errors and skipped cases are never passes.

Reports retain corpus, grader, source and harness fingerprints. Compare matching cases, models, menus and complete coverage. Source changes, errors, unsafe mutations and passing-case regressions prevent a sound promotion claim. Different harness versions require review even when their golds match.

## Interpreting results

Use `lean-v10` for the current adapter; `lean-v9` and `lean-v8` remain comparison profiles. The current adapter retains literal requests and complete cart fields. Uncertain size or quantity applicability prompts clarification. Final answers require probability 0.85 and margin 0.15; unsupported recipe amounts are not inferred.

Exact requests can reuse validated answers or share an in-flight provider call within one process or Worker isolate. Cart routing remains live. `totalRequests` counts physical provider dispatches; `inflightHits` counts successful pending joins. A warm-cache result measures exact reuse, not performance on unique customer requests. Provider prompt-cache hits require separate evidence.

Latency benchmarks compare control, cold and warm conditions. They measure model work through atomic cart application, excluding microphone endpointing and browser paint. No production accuracy or latency guarantee follows from these authored regression suites.

## Progressive voice preparation

After 650 ms of stable interim recognition text, the browser can prepare an interpretation without committing the cart. Final speech adopts it only when trim-normalized text and cart revision match. Changed or withdrawn interim text cancels the stale candidate. One replacement preparation is allowed per microphone session, with the same debounce and exact-match validation. If matching preparation is pending, final speech waits for that request.

The [opt-in synthetic voice checks](../experiments/live-voice/README.md) exercise real-provider integration and request reuse. Their synthetic recognition events and next-frame callbacks do not measure microphone latency or physical display paint.
