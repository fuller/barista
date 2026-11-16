# Public website source fixtures

Acquired credential-free over ordinary server transport from the fixed public menu endpoint and 20 product/form URLs listed in `provenance.json`. All JSON reads returned HTTP 200 and `application/json`; no cookies, authorization, accounts, stores or anti-bot bypass were used. Sandbox DNS initially failed; approved network transport succeeded. These are observed website responses, not a supported partner API contract.

`menu.json` preserves category membership and real image URLs. `details.json` preserves recipe/defaultOptionValues distinctions and unrecognized option IDs; `latte.json` isolates the confirmed four-size fixture. `provenance.json` records acquisition time and exact source URLs. No response headers/session identifiers/configuration were captured in these fixtures.

Projection covers 13 supported product families and 20 forms. Espresso Doppio explicitly maps to the existing domain `short` identity and retains source display name, sizeCode and SKU; other espresso shot sizes remain outside this projection. Source `recipe.default` governs included selections. `defaultOptionValues` never adds an ingredient. Zero-valued categorical milk, roast, foam, heat, water and ice selections remain present. Unknown options and read-only base ingredients retain external IDs and unsupported records. Source identity always includes productNumber + formCode.

Actual differences from the legacy sample include whole milk and three Grande shots for Flat White, classic syrup in current Chai/Matcha recipes, and real size recipes. Legacy orders keep the immutable legacy sample version. Source Stars are omitted from monetary pricing; sample prices and unknown tax remain separate.

Refresh: `node scripts/sync-catalog.mjs` imports these fixtures without network; `--live` opts into fixed-origin serial reads capped at 24 identities. Failed normalization/source access leaves current bytes intact. Atomic promotion retains the previous snapshot for server version resolution. Full raw option evidence remains here; the client projection omits duplicated unsupported option size/SKU lists.

Standard Iced Shaken Espresso (`2123425:Iced`) was added through the existing fixed-origin source adapter. Its separate acquisition record is `shaken-espresso.provenance.json`. Verified Tall/Grande/Venti shots are 2/3/4; included Classic syrup is 1/2/3 and milk is 2%. The frozen legacy sample catalog still has its original 12 products. Shaken Espresso has explicitly illustrative sample prices of 495/545/595 cents; these are not website cash prices or Stars.
