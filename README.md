# Trains of Thought 🚆💭

> See the delays coming. We fuse messy real-world data (weather, football, concerts, strikes, engineering works, bank
> holidays, rush hour, real punctuality history) to forecast how late every train is likely to run, what that will cost
> an operator in Delay Repay compensation, why, and which pre-emptive actions pay for themselves.

Built at HackTheBurgh 2026.

## Quick start

```bash
npm install
cp .env.example .env      # every key is optional
npm run dev               # API http://localhost:8787 · web http://localhost:5173
```

`VITE_USE_FIXTURES=1 npm run dev:web` runs the website without the API, on canned data for 20–22 Nov 2026.

## Real data

| Source | Key | How to refresh |
|---|---|---|
| Realtime Trains (real timetables and arrival lateness) | `RTT_TOKEN`: free token from https://api-portal.rtt.io (personal, non-commercial use) | `npm run fetch:rtt -w @tot/rail -- --wait` (about 4 hours for every corridor; resumable) |
| Ticketmaster Discovery (concerts and events at big venues) | `TICKETMASTER_API_KEY` | `npm run ingest -w @tot/signals` |
| Open-Meteo, GOV.UK bank holidays, openfootball, TheSportsDB, TfL | none | `npm run ingest -w @tot/signals` |

Timetables (where Realtime Trains hasn't been fetched yet), fares, passenger loads and mitigation costs are modelled
and labelled "(sample)".

**Before the demo**, freeze the live data so it runs without Wi-Fi, then commit the snapshots (keep the repo private:
the Realtime Trains free tier is personal use only):

```bash
npm run ingest -w @tot/signals -- --snapshot   # → data/raw/signals/snapshot/
npm run fetch:rtt -w @tot/rail -- --snapshot   # → data/raw/rail/rtt/
TOT_OFFLINE=1 npm run dev                      # rehearse offline
```

## Map

| Where | What |
|---|---|
| [contract.md](contract.md) | the plan: product, interfaces, conventions, tasks, milestones |
| `packages/shared` | the contract in code: zod schemas, helpers, fixtures, fake providers |
| `packages/signals` | world data → `Signal[]` (weather, football, events, strikes, works, holidays, TfL) |
| `packages/rail` | stations, timetables, fares, punctuality (real Realtime Trains data layered over a model) |
| `packages/engine` · `packages/api` | the delay and Delay Repay model, and the HTTP API |
| `packages/web` | the operator dashboard: route risk board, network alerts, data inputs explorer |
| `data/` | raw messy inputs, plus a git-ignored cache of live fetches |

`npm run check` runs the typecheck and every package's tests; a pre-push hook runs it too.
