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
