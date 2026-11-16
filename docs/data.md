# Data provenance

The bundled menu directory records public Starbucks website JSON. Its 313 product/form identities preserve source IDs, names, available source sizes, category paths and acquisition metadata. Recorded detail fixtures support normalizer regression tests. Acquisition metadata and source references live alongside the snapshots and fixtures.

```sh
# Reset the active directory from recorded fixtures (overwrites the snapshot)
node scripts/sync-menu-directory.mjs
# Fetch public source data and replace the active directory
node scripts/sync-menu-directory.mjs --live
```

Both commands replace the active directory after validation. The first resets it to the recorded fixture data, discarding any previously refreshed directory. `--live` reads the public source instead. Replacement is atomic; failed validation retains last-good data. Restart the server afterward. The separate catalog synchronizer maintains internal recipe compatibility snapshots.

A recorded listing does not verify current availability, store inventory, local pricing, ingredient suitability or fulfillment support. Generic customizations remain literal requests. Photographs represent base products and may be loaded remotely from the source asset host.

Starbucks names, descriptions, photographs and other upstream materials are not covered by this project's code license. Public availability does not establish redistribution permission. Review upstream rights before redistributing or hosting those materials; replace them with content you have permission to use where necessary. See [third-party notices](../THIRD_PARTY_NOTICES.md).
