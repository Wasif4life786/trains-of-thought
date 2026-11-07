# data/raw/rail (A2)

Raw inputs for the rail model. Nothing here is hand-edited after the fact: cleaning happens in `packages/rail`.

| File | What | Where from |
|---|---|---|
| `stations.json` | 2,609 UK stations as downloaded | davwheat/uk-railway-stations |
| `routes.json` | 8 corridors, both ways: operator, departure minutes, durations, calling points | modelled (`seed:`), not a published timetable |
| `fares.csv` | walk-up fares and Advance range per route, deliberately messy (pounds as text, mixed labels, duplicates) | rounded estimates |
| `performance.csv` | 23k-row punctuality history, deliberately messy | SYNTHETIC: `npm run generate:performance -w @tot/rail` |
| `snapshot/` | frozen data for the offline demo (M3) | |
