# Public website source fixtures

Acquired credential-free over ordinary server transport from the fixed public menu endpoint and 20 product/form URLs listed in `provenance.json`. All JSON reads returned HTTP 200 and `application/json`; no cookies, authorization, accounts, stores or anti-bot bypass were used. These are observed website responses, not a supported partner API contract.

`menu.json` preserves category membership and real image URLs. `details.json` preserves recipe/defaultOptionValues distinctions and unrecognized option IDs; `latte.json` isolates the confirmed four-size fixture. `provenance.json` records acquisition time and exact source URLs. No response headers/session identifiers/configuration were captured in these fixtures.

Projection covers 13 supported product families and 20 forms. Espresso Doppio explicitly maps to the existing domain `short` identity and retains source display name, sizeCode and SKU; other espresso shot sizes remain outside this projection. Source `recipe.default` governs included selections. `defaultOptionValues` never adds an ingredient. Zero-valued categorical milk, roast, foam, heat, water and ice selections remain present. Unknown options and read-only base ingredients retain external IDs and unsupported records. Source identity always includes productNumber + formCode.

Legacy orders keep the immutable legacy sample version. Source Stars are omitted from monetary pricing; sample prices and unknown tax remain separate.

Refresh: `node scripts/sync-catalog.mjs` imports these fixtures without network; `--live` opts into fixed-origin serial reads capped at 24 identities. Failed normalization/source access leaves current bytes intact. Atomic promotion retains the previous snapshot for server version resolution. Full raw option evidence remains here; the client projection omits duplicated unsupported option size/SKU lists.

Standard Iced Shaken Espresso (`2123425:Iced`) has a separate acquisition record in `shaken-espresso.provenance.json`. Its sample prices are illustrative, not website cash prices or Stars.
