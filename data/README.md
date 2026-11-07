# data/

| Path | Owner | What |
|---|---|---|
| `raw/signals/` | A1 | messy inputs for world signals, exactly as downloaded or collected |
| `raw/rail/` | A2 | messy inputs for the rail model |
| `raw/<lane>/snapshot/` | that lane | frozen copies of live data for the offline demo (M3) |
| `cache/` | anyone (git-ignored) | live-fetch cache, one per machine |

Never hand-edit raw files: cleaning lives in code and is counted in each source's `QualityReport` (contract.md §4.3).
Invented records are labelled "(sample)" or come from a `seed:` source.
