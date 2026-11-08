# A1 · Signaller lane: notes (owned by A1)

You deliver `createSignalProvider()` (contract.md §5.2, tasks §6.1): messy world data → clean, validated `Signal[]`
and honest `SourceStatus[]`.

Suggested layout (yours to change):
- `src/sources/<id>.ts`: one adapter per source; fetch (live) → parse → clean → `{ signals, quality, mode, fetchedAt }`
- `src/cache.ts`: live → `data/cache/signals/<id>.json` → seed in `data/raw/signals/`; respects `isOffline()`
- `src/venues.ts`: stadium or venue → lat/lon → nearest CRS (from `data/raw/signals/stadiums.csv`)
- `src/index.ts`: the registry plus filtering per §5.2 (window overlap AND (stations OR nationwide) AND kinds),
  sorted and de-duplicated

Tests: keep `src/contract.test.ts` green; test each adapter against a saved raw sample in `data/raw/signals/` (no
network). Station coordinates for the hero corridors are in `@tot/shared/fixtures` (`loadFixtures().stations`).

## Source quirks log (append as you learn; it survives /clear)

- openfootball: kick-off "15:00" is often a placeholder until the TV picks; names end in "FC"/"AFC"; no venues.
- TheSportsDB (key 123): TV-adjusted `strTimestamp`; spellings like "Brighton and Hove Albion".
- Open-Meteo: gusts in km/h (50 mph ≈ 80 km/h); coordinates snap to a grid; 16-day horizon.
- Open-Meteo: asked for all 25 route points in ONE call (comma-separated coordinates, answers with an array); some trailing hours come back null (counted as `missing_values`).
- TheSportsDB free key `123` returns a single upcoming match, but that was enough to catch a TV move (Brighton v Brentford, Sat 15:00 → Sun 14:00).
- openfootball has no venues: the stadium table is `data/raw/signals/stadiums.csv` (curated; every station code is checked against the station file by a test).
- Live fetches fill `data/cache/signals/`; `npm run ingest -w @tot/signals -- --snapshot` freezes them into `data/raw/signals/snapshot/` for the offline demo.
