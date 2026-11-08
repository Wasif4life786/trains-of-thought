# The demo (3 minutes)

**Pitch in one line:** operators pay Delay Repay on every train that arrives 15+ minutes late, and much of that lateness
is predictable days ahead from messy world data nobody joins up. We join it up, put a £ on it, and say what to do.

## Before you go on stage

```bash
npm run demo           # starts the API + website (or reuses them), runs the preflight, prints the links
npm run demo:offline   # same with no network at all: everything from the saved snapshot (the Wi-Fi-dies fallback)
npm run demo:check     # just the preflight, against whatever is running
```

The preflight must end with **Ready.** It checks the website, every operator endpoint, both demo windows, and that no
source is down. Then:

- [ ] Open the **Main link** below in the browser you'll present from; full screen, zoom 100–110%.
- [ ] Pre-open the **Storm** link in a second tab.
- [ ] Press **Play** once to warm up the animation, then drag the slider back to the far left.
- [ ] Laptop on power, notifications off.

| | Link |
|---|---|
| **Main** (data inputs, the showpiece) | `http://localhost:5173/?view=inputs&origin=EUS&destination=MAN&dateFrom=2026-11-20&dateTo=2026-11-22` |
| **Storm** (weather, optional) | `http://localhost:5173/?view=inputs&origin=EUS&destination=MAN&dateFrom=2026-11-14&dateTo=2026-11-16` |

## The script

Numbers are from the saved snapshot (taken 8 Nov 2026), so they are the same live and offline. If you re-snapshot
they change: see "Refreshing" below.

### 0:00 · The problem (20 s) — Data inputs, top strip
> "Operators pay Delay Repay on every train 15+ minutes late. Most of it is predictable from data nobody joins up."

Point along the strip: **12 sources → 43,332 raw rows → 42,065 repaired → 12,228 thrown away → 31 signals on our
corridors → £367,126 of Delay Repay they add on top of punctuality history.** "That's the messy-data story: weather, football
fixtures and away-fan flows, concerts, engineering works, TfL closures, bank holidays, leaf-fall, fares, timetables, punctuality,
read as published and cleaned."

### 0:20 · The map and Play (50 s) — scroll to the map
Drag the slider to the far left, press **Play**. It runs the three days hour by hour: 72 hours in about 20 seconds, then stops.
- The lines glow where expected payout is highest this hour; circles are signals (size = severity, fill = confidence,
  pulsing = live right now). Dashed amber track is engineering works drawn on the line they close.
- Call out as they appear: **Man City v Fulham** at the Etihad (Sat 12:00–18:00), then **Sunday morning: engineering works
  Milton Keynes–Rugby**.
- Pause on **Sun 22 Nov, 09:00**: "£21,455 expected this hour; punctuality history alone says £8,092. The works are the
  biggest part of the difference."

### 1:10 · Network alerts (45 s) — click the **Network alerts** tab
> "£1.20 million of expected Delay Repay across 2,130 services. £496k of it is added by signals. £143k is avoidable with actions."

Top card: **Engineering works Milton Keynes to Rugby: +£47,389 across 95 services.** Read the green box: "Retime around the
works and add diversion running time: costs £14,250, saves £30,821, net +£16,571." Third card: **Man City v Fulham +£28,830** across 154 services.
The TfL line closures rank high only because they touch Euston all weekend; they're low severity per train. (Liverpool v Man Utd is on
this view too: it is network-wide. It was correctly *ignored* on the Euston–Manchester route.)

### 1:55 · Drill into one train (45 s)
1. On the first card click the **London Euston → Manchester Piccadilly** chip → the **Route risk board** (£105,524 expected,
   £54,856 added by world signals, 44 high-risk of 136 services).
2. In the heatmap click **Sun 22 Nov, 09** ("Showing one hour").
3. Click **details** on the **Sun 22 Nov 09:00 · Severe** train:
   - Baseline £259, expected **£1,041**: the works add £607.
   - Delay forecast: 51% on time, 18% 15–29 min, 15% 30–59 min, 8% cancelled, each band with its refund rate.
   - Pre-emptive action: **retime around the works.**

### 2:40 · Close (20 s)
> "Same engine, any of 13 corridors, both directions, with railcards and one-change journeys: Edinburgh to Manchester works the same way.
> Everything is a contract: four lanes, one shared schema, 190 tests, zero merge conflicts."

Optional if you have 20 seconds: switch to the **Storm** tab. "Monday's forecast gale: 26 weather signals, £62k at 16:00 against £28k
from history alone. The 53 mph gust near Manchester alone adds £58k."

## What is real and what is modelled (say this before anyone asks)

| Real | Modelled or invented (labelled "(sample)" or "modelled" in the app) |
|---|---|
| Weather forecast (Open-Meteo), Premier League fixtures (openfootball) and TV kick-off moves (TheSportsDB), GOV.UK bank holidays, the station list | Timetable patterns, fares and the punctuality history (synthetic, messy on purpose), passenger loads, the 25% claim rate, mitigation costs, events and the engineering-works/strike notices |

If asked **"why are the £ numbers so big?"**: "They're modelled: a few hundred passengers a train on intercity fares and a 25% claim
rate. The relative picture is what matters (what adds cost, by how much, what to do), and every assumption is a labelled input an
operator would replace with their own loads and claim data."

If asked **"is the punctuality real?"**: "Synthetic, generated to look like a messy export, then cleaned by the same code that would clean
the real feed (Realtime Trains). It's what the 'repaired' and 'discarded' counts are about."

## If something goes wrong

| Problem | Fix |
|---|---|
| Wi-Fi dies | Nothing: everything is in the snapshot. If the stack was started online, restart with `npm run demo:offline`. |
| Page is blank or shows an error | Hard refresh. Run `npm run demo:check` and read the ✗ line. |
| "Port 5173/8787 in use" | `lsof -nP -iTCP:5173 -iTCP:8787 -sTCP:LISTEN`, kill the old process, run `npm run demo` again. |
| Preflight says the storm window has no weather | The forecast snapshot changed. Pick any window with weather in `npm run demo:check` output, or use the weekend only. |
| The map is slow | Close other tabs; use Chrome; the Play step can be skipped by dragging the slider. |

## Refreshing the numbers (do this at most once, the day before)

```bash
npm run ingest -w @tot/signals -- --snapshot   # fetches live, freezes it into data/raw/signals/snapshot/
npm run demo:check                              # confirm both windows still tell the story
npm run check                                   # the whole test suite
```

Then re-read the numbers above against the screen and update this file. Commit `data/raw/signals/snapshot/`.
