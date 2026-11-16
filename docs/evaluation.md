# Evaluation and measured limits

Three independently authored corpora exercise full-menu identity, size, quantity, literal requests, prior history and atomic clarification:

| Corpus | Cases | Role |
| --- | ---: | --- |
| `evals/menu-selection-dev.json` | 27 | Development regression |
| `evals/menu-selection-holdout.json` | 12 | Consumed holdout regression |
| `evals/menu-single-copy-regression.json` | 12 | Targeted quantity regression |

The holdout has been inspected and must not be described as blind. These small corpora do not establish general model accuracy, physical voice accuracy, recipe correctness, pricing or real fulfillment.

## Reproduce

```sh
npm run eval:menu
npm run eval:menu -- --live --profile lean-v9 --split dev --max-requests 160 --output work/new-dev.json
npm run eval:menu -- --live --profile lean-v9 --corpus evals/menu-single-copy-regression.json --output work/new-target.json
node scripts/benchmark-menu-latency.mjs --live --profile lean-v9 --control-profile lean-v8 --scheduling guarded-overlap --control-scheduling guarded-overlap --output work/new-latency.json
node scripts/compare-menu-evals.mjs baseline.json candidate.json
```

Default evaluation validates fixtures without inference. Explicit live execution uses configured server credentials, bounded actual requests and unique output files. Do not run concurrent provider benchmarks. Restart the server before calling a browser observation cold. Missing usage remains unknown, not zero.

Reports retain corpus, grader, source and harness fingerprints. Compare matching cases, models, menus and complete coverage. Source changes, errors, unsafe mutations and passing-case regressions prevent a sound promotion claim. Different harness versions require review even when their golds match.

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
