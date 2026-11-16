# Contributing

Use Node 22.22.3 (pinned in `.node-version`) or Node 24.8+. Run `npm ci`, copy `.env.example` to `.env`, and configure a server-only key if testing live interpretation. Never commit credentials, transcripts from real users or generated provider reports containing private data.

Before submitting a change, run:

```sh
npm test
npm run check
npm run build
npm run test:e2e
npm run eval:menu
```

Explain the user-visible change and relevant validation. Add focused regression coverage when behavior changes. Keep source identities and independently authored evaluation golds separate from model output. Do not modify golds merely to make a candidate pass.

Provider calls and source refreshes require explicit live commands. Use bounded requests and unique ignored output paths. Describe model, profile, corpus and limitations when reporting performance. Changes to upstream data must retain provenance and respect the content rights described in THIRD_PARTY_NOTICES.md.
