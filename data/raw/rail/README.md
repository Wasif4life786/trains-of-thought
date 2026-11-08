# data/raw/rail (A2)

Raw inputs for the rail model. Nothing here is hand-edited after the fact: cleaning happens in `packages/rail`.

| File | What | Where from |
|---|---|---|
| `stations.json` | 2,609 UK stations as downloaded | davwheat/uk-railway-stations |
| `routes.json` | 8 corridors, both ways: operator, departure minutes, durations, calling points | modelled (`seed:`), not a published timetable |
| `fares.csv` | walk-up fares and Advance range per route, deliberately messy (pounds as text, mixed labels, duplicates) | rounded estimates |
| `performance.csv` | 23k-row punctuality history, deliberately messy | SYNTHETIC: `npm run generate:performance -w @tot/rail` |
| `snapshot/` | frozen data for the offline demo (M3) | |

## Fare calibration (A2.7, checked 8 Nov 2026)

Published anchors used for the **Advance** ranges (the only fares with a reliable free public source):
- London Euston → Manchester Piccadilly: "from £14" single in advance (thetrainline.com/train-times/london-euston-to-manchester-piccadilly); Trainline results for Sat 21 Nov, seen 7 Nov (14 days out): £52.50–£68 for the 09:13–10:33 trains.
- Edinburgh Waverley → Manchester Piccadilly: "from £18.60" in advance (Trainline); Fri 20 Nov 06:12 seen at £39.20 (13 days out).

Walk-up fares (Anytime, Off-Peak, Super Off-Peak) are **rounded estimates**: no free official fares file or reliable public page was found, and the one aggregator that listed an Off-Peak single (£76.30 for London–Manchester) could not be corroborated. Replace them from the National Rail fares feed when available.
