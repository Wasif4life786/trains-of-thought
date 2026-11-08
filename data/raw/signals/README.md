# data/raw/signals (A1)

Raw inputs for world signals, as downloaded or hand-collected (cleaned in `packages/signals`).

| File | What | Where from |
|---|---|---|
| `bank-holidays.json` | GOV.UK bank holidays, three divisions | gov.uk/bank-holidays.json (8 Nov 2026) |
| `open-meteo-forecast.json` | 16-day hourly forecast for the 25 points in `weather-points.json` | Open-Meteo (8 Nov 2026) |
| `openfootball-en1-2026-27.json` | Premier League 2026/27 fixtures | openfootball/football.json |
| `thesportsdb-epl-next.json` | next matches with TV-adjusted times (free key: one match) | TheSportsDB |
| `weather-points.json` | forecast points and the stations each speaks for | curated |
| `stadiums.csv` | club → ground, coordinates, capacity, nearest stations | curated |
| `venues.csv`, `events.csv` | arenas and a messy events list | curated SAMPLE |
| `disruptions.json` | strikes and engineering works, messy operator names | curated SAMPLE |
| `snapshot/` | frozen live data for the offline demo (`npm run ingest -w @tot/signals -- --snapshot`) | |

## Quirks we found

- openfootball: kick-off "15:00" is often a placeholder until the TV picks; names end in "FC"/"AFC"; no venues.
- TheSportsDB (key 123): TV-adjusted `strTimestamp`; spellings like "Brighton and Hove Albion".
- Open-Meteo: gusts in km/h (50 mph ≈ 80 km/h); coordinates snap to a grid; 16-day horizon.
- Open-Meteo: asked for all 25 route points in ONE call (comma-separated coordinates, answers with an array); some trailing hours come back null (counted as `missing_values`).
- TheSportsDB free key `123` returns a single upcoming match, but that was enough to catch a TV move (Brighton v Brentford, Sat 15:00 → Sun 14:00).
- openfootball has no venues: the stadium table is `data/raw/signals/stadiums.csv` (curated; every station code is checked against the station file by a test).
- Live fetches fill `data/cache/signals/`; `npm run ingest -w @tot/signals -- --snapshot` freezes them into `data/raw/signals/snapshot/` for the offline demo.
