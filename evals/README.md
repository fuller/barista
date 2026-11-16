# Full-menu evaluation fixtures

The active corpora are `menu-selection-dev.json` (27 cases), `menu-selection-holdout.json` (12 consumed cases), and `menu-single-copy-regression.json` (12 targeted cases). Golds are authored independently of implementation output. Never regenerate expected answers from a candidate adapter.

Run `npm run eval:menu` for validation without inference. Explicit `--live --profile lean-v9` enables provider evaluation; `lean-v8` is the rollback/comparison profile. Use unique ignored report paths and bounded request budgets.

See [evaluation commands, evidence and limitations](../docs/evaluation.md). Deterministic support modules still used by unit tests are implementation fixtures, not additional active model benchmarks.
