# Trains of Thought · team contract v1.4.0

> The plan and the interfaces for the four-agent hivemind (or one agent playing all four: see "Solo mode" in §3). This
> is the human-readable half of the contract; the
> machine-readable half is `packages/shared/src/` (zod schemas and types). They change together, only through §8,
> and a test checks that the version above matches `CONTRACT_VERSION`.

| Kickoff | Hackathon ends | Feature freeze | Demo |
|---|---|---|---|
| _fill in_ | _fill in_ | end − 3 h | _fill in_ |

## 0. TL;DR

- **Product (pivot, v1.3.0):** a tool for **train operators**. For every upcoming service we forecast how late it is
  likely to run, what that will cost in **Delay Repay** compensation, *why* (storms, football crowds, concerts,
  strikes, engineering works, bank holidays, poor punctuality history), and which **pre-emptive actions** pay for
  themselves. Two views: a per-route **risk board** and a network-wide **alert feed** (§1.5, §5.6). The original
  consumer search (`/api/recommendations`, §1.2) stays in the API but is no longer in the website.
- **Four lanes:** A1 Signaller (world data) and A2 Timetabler (rail data) feed A3 Controller (engine + API), which
  feeds A4 Platform (website).
- **Contract first:** everyone codes against `@tot/shared` from minute one. Fixtures and fake providers mean nobody
  waits for anybody; real code replaces the fakes behind the same interfaces.
- **Stay in your lane**, push small and often, and talk through `hivemind/` (see `hivemind/README.md`).
- **Solo mode:** if teammates aren't contributing, one agent works every lane as `LEAD` (§3). The lanes stay as code
  boundaries and the contract stays the contract; only the "who" changes.

## 1. Product

### 1.1 Pitch

Train tickets are cheapest when booked early, but the cheap train is often the one wrecked by a storm, a sold-out
derby or Sunday engineering works. The data that predicts this exists, but it's scattered and messy: weather forecasts,
football fixtures with provisional kick-offs, concert listings, strike notices, punctuality history, fare rules.
Trains of Thought cleans and fuses it so you can see, in five seconds, which departure is cheap *and* likely to get
you there.

### 1.2 What the user does

1. Picks origin and destination (station autocomplete), a date range (1–14 days), a departure window and a
   *Cheapest ↔ Most reliable* slider.
2. Sees the **best pick** (times, price, reliability %, verdict, top reasons), a **day × hour heatmap**, and every
   departure with reason chips.
3. Sees **booking advice** for the best pick ("Book now: this fare usually rises to £52.80 within a week") with the
   fare curve.
4. (P1) Opens **"What we cleaned"**: for each source, rows in → rows out and what we fixed and dropped. This is the
   messy-data story for the judges.
5. Can sort every table by departure, price, reliability or score; apply a **railcard** to see discounted prices; and
   follow a **Book** link to Trainline for the route and time. All of this lives in `packages/web`, on top of the API.
6. Can choose **One way** or **Return**. A return is two API searches (the way there, then the same trip backwards for
   the return dates); the website pairs a train each way (return trains must leave after the outbound one arrives) and
   prices the trip as two single fares. Return *fares* aren't modelled yet (P2).
7. If a route has no data, the website says so, never shows trains for a different route, and offers a Trainline
   search instead.

### 1.3 Hero scenario (the demo script and the integration test)

**London Euston → Manchester Piccadilly, Fri 20 – Sun 22 Nov 2026, departing 06:00–22:00, priority 0.5.**
Every lane makes this work first.

| When | What the data says | What we should tell the user |
|---|---|---|
| Fri 16:00–19:00 | Peak fares (Advance or Anytime only), Friday getaway crowds | Avoid: expensive and packed |
| Sat 09:00–20:00 | Manchester Christmas Markets | A little busier |
| Sat 12:00–18:00 | Man City v Fulham at the Etihad (kick-off 15:00, provisional) | Don't arrive in this window |
| Sat 16:30–23:30 | Sold-out concert at Co-op Live | Evening arrivals busy |
| Sat 12:00–18:00 | Liverpool v Man Utd at Anfield | Must **not** affect this route (relevance check) |
| Sun until 14:00 | Engineering works Milton Keynes–Rugby, diversions | Mornings risky |
| Sun all day | Engineering works Preston–Wigan (affects Edinburgh ⇄ Manchester, not Euston) | Sunday risky on that route |
| Whole weekend | The real forecast (checked 7 Nov) is calm everywhere on the routes | No weather reasons: the adapter only speaks up above its thresholds |
| Booking today (7 Nov) | Advance fares step up at 14 and 7 days out | Book now |

The story the data should tell: Friday trains are dear and busy; Saturday trains arriving from about 11:30 to 18:30 run
into the match (an early train arrives before the crowds and is unaffected); Sunday morning has engineering works; book
Advance now because fares step up at 14 and 7 days out. Which single train is "best" depends on the slider and on
the modelled fares and punctuality, so check the reasons rather than a fixed answer (in the old fixture it was Sat 09:00,
£38.40 Advance; with the real lanes today it is a Sunday-evening train). The football fixtures, bank holidays and weather
are real (openfootball 2026/27, GOV.UK, Open-Meteo); anything marked "(sample)" is invented and replaceable. The fixture
version is `packages/shared/fixtures/recommendation.json`.

**Second scenario: Edinburgh Waverley ⇄ Manchester Piccadilly** (TransPennine Express, about 3 h 15 min, nothing on
the West Coast fast line to share crowds with). Same dates. It proves the system isn't a one-route demo: it must return
scored trains, a heatmap and booking advice for this route in both directions, so a return trip works. The Man City
home game on Saturday 21 Nov should show up as a reason for trains into Manchester, and Edinburgh should get its own
weather.

### 1.4 Out of scope

Buying tickets or taking payments, user accounts, journeys with changes (P2), Northern Ireland, other modes of
transport, and (operator view) real operator data: loads, claim rates and costs are modelled.

### 1.5 The operator product (v1.3.0)

Operators pay Delay Repay on every train that arrives 15+ minutes late, and much of that lateness is predictable days
ahead from the same messy world data. The website is now for an operator's control and planning teams:

1. **Risk board** (one route direction, 1–14 days): the expected compensation for the window and how much of it the
   world signals add, the high-risk service count, and the saving if every recommended action is taken; a day × hour
   heatmap of £ exposure; and every service (10 per page, sortable, biggest expected cost first by default) with its
   risk level, chance of a 15+ min delay or cancellation, expected payout, top driver and best action. Expanding a
   service shows the Delay Repay band forecast, every driver with the £ it adds, and every costed mitigation.
2. **Network alerts** (every route the rail lane knows, 1–7 days): one card per world signal that adds cost, with the
   routes and services it touches, the £ it adds, and the best action against it summed over those services; plus a
   table of routes by exposure.
3. **Data inputs** (v1.4.0, the demo's showpiece): the evidence behind the forecast. A "messy data → £" pipeline
   strip (sources → rows read → repaired → discarded → signals → £ they add); a map of the corridors coloured by
   expected payout in the current hour, with every signal drawn where it happens (size = severity, fill =
   confidence, pulsing while live; engineering works drawn on the track they close); a Play control that runs the
   window hour by hour; and signal swimlanes over the £-by-hour curve (expected vs punctuality history alone).
4. **What we cleaned** stays: the data-quality story per source.

Passenger loads, the claim rate and mitigation costs are modelled assumptions and are labelled "(sample)" in the UI.


## 2. Architecture

```
  messy world data                               rail data
  weather · football · concerts · strikes ·      stations · timetable · fares ·
  engineering works · bank holidays              punctuality history · rush hour
            │                                              │
            ▼                                              ▼
   A1  @tot/signals                                A2  @tot/rail
       createSignalProvider(): SignalProvider          createRailProvider(): RailProvider
            └──────────────────────┬───────────────────────┘
                                   ▼
                     A3  @tot/engine   createEngine({ signals, rail }): Engine
                                   ▼
                     A3  @tot/api      HTTP /api/*  (the only place the lanes are wired together)
                                   ▼
                     A4  @tot/web      React UI (talks HTTP only)

  Every package imports @tot/shared (schemas, types, helpers, fixtures). Nobody imports another lane's internals.
```

### 2.1 Import rules

| Package | May import |
|---|---|
| `@tot/shared` | `zod` only; isomorphic (runs in Node and the browser) |
| `@tot/signals`, `@tot/rail` | `@tot/shared` + their own npm dependencies |
| `@tot/engine` | `@tot/shared` only; the providers are injected |
| `@tot/api` | `@tot/shared`, `@tot/signals`, `@tot/rail`, `@tot/engine` |
| `@tot/web` | `@tot/shared`; data only over HTTP (or from `@tot/shared/fixtures` in fixture mode) |

Always import the package entry (`@tot/rail`), never a deep path (`@tot/rail/src/...`).

### 2.2 Runtime

`npm run dev` starts the API on :8787 (`tsx watch`, wires the lanes) and the web app on :5173 (Vite, proxies `/api`).
There's no database: lanes read seeds from `data/raw/<lane>/`, cache live fetches in `data/cache/<lane>/`
(git-ignored) and keep data in memory. Internal packages export TypeScript source, so there's no build step.

## 3. Lanes

| Agent | Name | Owns (write access) | Provides | Consumes |
|---|---|---|---|---|
| A1 | Signaller | `packages/signals/`, `data/raw/signals/` | `SignalProvider`: messy world data → `Signal[]` + `SourceStatus[]` | shared |
| A2 | Timetabler | `packages/rail/`, `data/raw/rail/` | `RailProvider`: stations, `JourneyOption[]`, fare curves, `SourceStatus[]` | shared |
| A3 | Controller | `packages/engine/`, `packages/api/` | `Engine` + the HTTP API; integration owner | A1, A2 through their interfaces |
| A4 | Platform | `packages/web/` | The website and the demo flow | A3 over HTTP |

Each agent also owns `hivemind/board/<id>.md`. The contract (`packages/shared/`, this file) changes only through §8.
Everything else is team-wide and needs human approval. The machine-readable map is `hivemind/ownership.json`; the
Claude guard hook and the git pre-commit hook enforce it.

**Solo mode.** When the team isn't all contributing, one agent works every lane: the human runs
`npm run hive:join -- LEAD` (no lane limits; contract and team files still need the human's approval). Keep the lane
boundaries in the code anyway (§2.1) so teammates can pick a lane up later, and keep the per-lane boards current.

## 4. Conventions (MUST)

### 4.1 Units and identifiers

- **Money** is integer pence (`1999` = £19.99). Parse messy text with `parsePounds`, display with `formatPence`.
- **Stations** are CRS codes (`EUS`). **Operators** are ATOC codes (`VT`); show names with `operatorName`.
- **Probabilities** are 0..1; **scores** are 0..100, higher is better.
- **IDs are deterministic** (same input → same id): `Signal.id = "<source>:<record key>"`,
  `JourneyOption.id = "ORIGIN-DEST-departAt"`.
- JSON fields are camelCase; enum values are snake_case.

### 4.2 Time

- Instants are ISO UTC with seconds and `Z`: `2026-11-21T15:00:00Z`. Use `toIsoUtc`: plain `toISOString()` adds
  milliseconds and fails validation.
- Anything users see or type, and the query dates (`YYYY-MM-DD`) and times (`HH:mm`), is **Europe/London**. Convert
  with `londonToUtc` / `utcToLondon`, never by hand. (November is GMT, so UTC = London and BST bugs stay hidden until a
  summer date. The shared tests cover both.)
- A London "day" runs 00:00–23:59 London time.

### 4.3 Data hygiene (the messy-data rules)

- Raw files go in `data/raw/<lane>/` **untouched**: original format, typos and all. Cleaning happens in code, so it's
  repeatable and demoable.
- Every source reports a `QualityReport`: `rowsIn`, `rowsOut`, `fixed{reason: n}`, `dropped{reason: n}`, where
  rowsIn − rowsOut = Σ dropped. Name reasons in snake_case: `team_alias_resolved`, `kickoff_moved_for_tv`, `duplicate`.
- Validate at the boundary: everything a provider returns must `parse` with its schema. The contract tests check this.
- Invented data is labelled: the title ends in "(sample)" or the source id starts with `seed:`. Never present invented
  records as real.
- The fixture JSON files are big. Read `packages/shared/fixtures/README.md` and `recommendation.sample.json`, not the
  whole files.

### 4.4 Signal impact windows

`start` and `end` cover when the railway feels the event, not just the event itself:

| kind | window |
|---|---|
| football | kick-off − 3 h → kick-off + 3 h |
| concert, event | start − 3 h → start + 4 h (or published end + 1.5 h) |
| weather | the hours above threshold, merged into contiguous windows, + 1 h for recovery |
| strike | 00:00–23:59 London on each strike day, plus until 10:00 the next morning |
| engineering_works | as published |
| bank_holiday | 00:00–23:59 London |

`scope.stations` lists the stations within ~3 km of the venue or the ones that serve it (for weather: the stations in
the affected area). `scope.operators` is for operator-specific disruption. `scope.nationwide` is for national strikes
and England & Wales bank holidays (Scotland-only holidays go on Scottish stations instead).

### 4.5 Severity rubric (0..1)

| kind | 0.2 | 0.4 | 0.6 | 0.8 | 1.0 |
|---|---|---|---|---|---|
| weather | gusts 40–49 mph · rain 2–4 mm/h · 27–29 °C | rain 4–8 mm/h · light snow | gusts 50–59 mph · rain 8–15 mm/h · 30–32 °C · snow 1–3 cm | gusts 60–69 mph · rain > 15 mm/h · ≥ 33 °C · snow 3–10 cm | gusts ≥ 70 mph · Met Office red warning · snow > 10 cm |
| football | crowd < 15k | 15–30k | 30–45k | 45–60k | > 60k, derby or cup final |
| concert, event | < 5k | 5–15k | 15–30k | 30–60k | > 60k |
| strike | | overtime ban | one operator, partial | one operator, full walkout | several operators or national |
| engineering_works | late night only | reduced service | diversions (+15–30 min) | partial closure, some buses | line closed, buses replace trains |

`bank_holiday` is always 0.3 (Sunday-style timetable plus leisure demand). Open-Meteo reports gusts in km/h:
40 mph ≈ 64, 50 ≈ 80, 60 ≈ 97, 70 ≈ 113.

### 4.6 Confidence (0..1)

| Situation | confidence |
|---|---|
| Official and confirmed (gov.uk, published engineering works, announced strike) | 0.9–1.0 |
| Reliable but may change (fixture with a provisional TV kick-off, forecast ≤ 3 days out) | 0.6–0.8 |
| Forecast 4–10 days out, or a single unofficial source | 0.4–0.6 |
| Forecast more than 10 days out, or rumour | 0.2–0.4 |

When two sources disagree, prefer the more specific one and count the repair in `fixed` (e.g. `kickoff_moved_for_tv`).

### 4.7 Offline and failure

- `isOffline()` (TOT_OFFLINE=1, or under Vitest) means **no network**: use `data/cache/`, then `data/raw/`. Tests
  never touch the network.
- A failing source never breaks a request: degrade (cache → seed → nothing) and say so in that source's
  `SourceStatus.mode`.
- If the Wi-Fi dies, the demo runs with `TOT_OFFLINE=1` from committed snapshots (§7).

## 5. Interfaces

### 5.1 Data shapes

Defined in `packages/shared/src/schemas.ts`. That file wins if this summary drifts (then fix the summary).

```
Station        { crs, name, lat, lon, aliases[], country? }
Signal         { id, kind, title, detail?, source, start, end, place?{name, lat, lon},
                 scope{stations[], operators[], nationwide}, severity, confidence, metrics?{}, url? }
                 kind: weather | football | concert | event | strike | engineering_works | bank_holiday | other
SourceStatus   { id, name, lane: signals | rail, mode: live | cache | seed | fixture | down, fetchedAt?, quality, note? }
QualityReport  { rowsIn, rowsOut, fixed{reason: n}, dropped{reason: n} }
JourneyOption  { id, origin, destination, departAt, arriveAt, durationMin, changes, operator, callingPoints[],
                 fares[{ticketType, pricePence, flexible}] (cheapest first),
                 baseline{onTimeProb, cancelProb, avgDelayMin, crowding, peak, sampleSize} }
                 ticketType: advance | super_off_peak | off_peak | anytime
FareCurve      { journeyId, bookingDate, points[{date, daysBefore, pricePence, ticketType}] (ascending), advanceOnSale? }
RecommendationQuery    { origin, destination, dateFrom, dateTo, earliest, latest, priority 0..1, bookingDate? }
ScoredOption   { journey, pricePence, ticketType, reliability, crowding, score, verdict, reasons[] }
                 verdict: best | great | good | risky | avoid
Reason         { kind (signal kinds + price | peak | history | crowding), signalId?, text,
                 effect: good | bad | neutral, reliabilityDelta?, priceDeltaPence? }
HeatmapCell    { date, hour, score | null, minPricePence | null, reliability | null, optionIds[] }
BookingAdvice  { journeyId, action: book_now | wait | not_on_sale_yet, headline, currentPricePence,
                 expectedPricePence?, bookBy?, curve }
RecommendationResponse { contractVersion, generatedAt, query, best | null, options[] (by departAt),
                 heatmap[] (by date, hour), signals[] (every cited one), bookingAdvice | null, sources[], warnings[] }
```

### 5.2 Library interfaces (`packages/shared/src/providers.ts`)

```ts
interface SignalProvider {            // A1: createSignalProvider() in @tot/signals
  readonly name: string;              // "fixture" until A1 ships
  getSignals(q: { from; to; stations[]; kinds? }): Promise<Signal[]>;
  listSources(): Promise<SourceStatus[]>;
}
interface RailProvider {              // A2: createRailProvider() in @tot/rail
  readonly name: string;
  searchStations(query: string, limit?: number): Promise<Station[]>;
  getStation(crs: string): Promise<Station | null>;
  getJourneyOptions(q: { origin; destination; dateFrom; dateTo; earliest; latest; bookingDate }): Promise<JourneyOption[]>;
  getFareCurve(journeyId: string, bookingDate: string): Promise<FareCurve | null>;
  listSources(): Promise<SourceStatus[]>;
}
interface Engine {                    // A3: createEngine({ signals, rail, now? }) in @tot/engine
  readonly name: string;
  recommend(q: RecommendationQuery): Promise<RecommendationResponse>;
}
```

Semantics every implementation keeps (each lane's `contract.test.ts` checks them):

- `getSignals` returns the signals whose window overlaps `[from, to]` **and** that touch a listed station or are
  nationwide (**and** whose kind is in `kinds`, when given). Sorted by `start`, unique ids. It never throws because one
  source is down.
- `searchStations` puts an exact CRS match first, then name and alias matches; an empty query returns `[]`.
- `getJourneyOptions` returns every departure in the London date range and time window (inclusive), sorted by
  `departAt`, fares cheapest first, priced as of `bookingDate`.
- `getFareCurve` works for any id `getJourneyOptions` returned and returns `null` for unknown ids; points ascend by date
  and end on travel day.
- `recommend` does everything in §5.5: `best` is the unique top score (ties go to the earliest departure) and every
  `reason.signalId` appears in `signals`.

### 5.3 HTTP API (A3 serves, A4 consumes; helpers in `packages/shared/src/api.ts`)

| Endpoint | Query | 200 response |
|---|---|---|
| `GET /api/health` | none | `Health { ok, contractVersion, time, providers{signals, rail, engine} }` |
| `GET /api/stations` | `q`, `limit` (default 8) | `Station[]` |
| `GET /api/recommendations` | `origin`, `destination` (CRS, any case) · `dateFrom` · `dateTo` (default `dateFrom`, at most 14 days) · `earliest`, `latest` (default 06:00 / 22:00) · `priority` (default 0.5) · `bookingDate` (default today) | `RecommendationResponse` |
| `GET /api/signals` | `from`, `to` (ISO UTC) · `stations`, `kinds` (comma lists) | `Signal[]` |
| `GET /api/sources` | none | `SourceStatus[]` (signals first, then rail) |
| `GET /api/operations` (v1.3.0) | `origin`, `destination` · `dateFrom` · `dateTo` (default `dateFrom`, at most 14 days) · `earliest`, `latest` (default 05:00 / 23:30) · `bookingDate` (default today) | `OperationsResponse` |
| `GET /api/network` (v1.3.0) | `dateFrom` · `dateTo` (default `dateFrom`, at most 7 days) · `bookingDate` | `NetworkResponse` |
| `GET /api/inputs` (v1.4.0) | same as `/api/network` | `InputsResponse` |

- Parse with `parseRecommendationQuery` / `parseSignalQuery` and call with `createApiClient()`. Both sides share them,
  so a URL means the same thing everywhere and the web app's address bar can mirror the API's query string.
- Errors: `{ error: { code: "bad_request" | "not_found" | "internal", message, details? } }` with 400 / 404 / 500.
- Budget: `/api/recommendations` for a 3-day window answers in under 500 ms on a laptop with warm caches.

### 5.4 Fixtures and fakes (`@tot/shared/fixtures`)

```ts
import { FIXTURE_QUERY, createFixtureSignalProvider, createFixtureRailProvider, createFixtureEngine, loadFixtures } from "@tot/shared/fixtures";
```

Every lane's stub starts out returning these, so `npm run dev` works end to end from minute one. Replace the fakes
piece by piece. A4 can run the UI with no API at all: `VITE_USE_FIXTURES=1 npm run dev:web`. The fixture data covers
EUS → MAN on 20–22 Nov 2026 only, plus the same trains mirrored as MAN → EUS so return trips can be built (the fake rail provider and fake engine both answer either direction); files and sizes are listed in `packages/shared/fixtures/README.md`.

### 5.5 Default scoring model (A3's starting point)

Reference implementation: `packages/shared/scripts/generate-fixtures.ts`, which produced the fixture recommendation.

```
for each JourneyOption j and Signal s:
  station times   origin = departAt · destination = arriveAt · calling point k of n = departAt + k/(n+1) × duration
  relevant if     (s.scope.operators is empty or contains j.operator) and
                  ( s is nationwide and overlaps [departAt − 30 min, arriveAt + 30 min]
                    or a station of j is in s.scope.stations and its station time ± 30 min overlaps s )
  proximity       1.0 at origin / destination (or nationwide) · 0.6 at a calling point
  risk(s)         severity × confidence × KIND_WEIGHT[kind] × proximity
  KIND_WEIGHT     strike .9 · engineering_works .6 · weather .5 · football .3 · concert .2 · other .2 · event .1 · bank_holiday .1

reliability       baseline.onTimeProb × Π(1 − risk(s))
crowding          min(1, baseline.crowding + Σ severity × 0.4 × proximity)   over football | concert | event | bank_holiday
price             cheapest fare (P1: Advance × (1 + 0.25 × severity) when a big event is at the destination)
priceScore        cheapest price in the response ÷ price                     (1 = the cheapest option)
reliabilityScore  clamp((reliability − 0.55) ÷ 0.40, 0, 1)
score             round(100 × ((1 − priority) × priceScore + priority × reliabilityScore))
verdict           best = top score (earliest wins ties) · great ≥ 70 · good ≥ 55 · risky ≥ 40 · avoid < 40
reasons           one per relevant signal (reliabilityDelta = −baseline.onTimeProb × risk), plus
                  price (Advance saves ≥ £10 → good; Advance sold out → bad) · peak (bad) ·
                  history (onTime ≥ .90 good, ≤ .82 bad) · crowding (≥ .75 bad); sorted by impact
heatmap           one cell per (London date, hour) from earliest to latest, holding the cell's best score
bookingAdvice     for best: travel > 84 days away → not_on_sale_yet; price 7 days later ≥ +10% → book_now; else wait
```

Tune the numbers freely (A3.8): the shapes and semantics are the contract, the weights aren't.

### 5.6 Operator model (v1.3.0; A3's starting point, `packages/engine/src/operations.ts`)

Shapes (in `schemas.ts`): `OperationsQuery`, `DelayForecast { onTimeProb, cancelProb, bands{15_29, 30_59, 60_119,
120_plus}, expectedDelayMin }`, `CompensationEstimate { passengers, claimRate, avgFarePence, expectedClaims,
expectedCostPence, baselineCostPence }`, `Mitigation { kind, title, detail, signalId?, costPence, savingPence, netPence }`,
`ServiceRisk { journey, delay, compensation, riskLevel: low | elevated | high | severe, reasons[], mitigations[] }`,
`ExposureCell`, `OperationsTotals`, `OperationsResponse`, and for the network view `RouteRef`, `DisruptionAlert`,
`RouteSummary`, `NetworkResponse`. `Reason` gains an optional `compensationPence`. `RailProvider` gains an optional
`listRoutes()`; `Engine` gains `operations(q)` and `network(q)`.

```
delay             start from baseline: onTime, cancel, late = 1 − onTime − cancel (tail mean max(10, 2 × avgDelayMin + 6))
                  each touching signal (in §5.5 order): lost = onTime × risk(s); onTime −= lost
                    cancel += lost × CANCEL_SHARE[kind]; the rest is late with tail mean TAIL_MIN[kind]
                  minutes over 15 late ~ exponential(tail) → split into the four Delay Repay bands
compensation      DELAY_REPAY_15 = 15–29: 25% · 30–59: 50% · 60–119: 100% · 120+: 140% of the single fare
                    (100% of a return for the ~40% holding one) · a cancellation pays as 60–119
                  passengers = seats[operator] × min(1.1, 0.3 + 0.8 × crowding)        (sample)
                  avgFare    = 0.7 × cheapest fare + 0.3 × cheapest walk-up               (sample)
                  cost       = passengers × claimRate (0.30, sample) × avgFare × Σ P(band) × payout
                  baselineCost = the same with no signals
reasons           §5.5 reasons minus price and peak; each signal's compensationPence = cost − cost without it
riskLevel         by P(15+ late or cancelled): severe ≥ .45 · high ≥ .30 · elevated ≥ .20 · else low
mitigations       per driver (strike → contingency timetable by 22:00 the day before, works → retime, weather →
                  standby stock / weather timetable, crowds → crowd management / extra coaches, poor history →
                  standby crew, any big signal → passenger comms); saving = cost − cost with the lever applied;
                  only netPence > 0 are listed, best first
totals            sums; mitigation totals take each service's best action
network           operations() for every listRoutes() direction (whole day); one alert per signal that adds cost
```

Every `signalId` in a reason or mitigation appears in the response's `signals`. Fixtures: `operations.json` (EUS → MAN,
20–22 Nov) and `network.json`, made by `npm run fixtures:ops -w @tot/engine` and served by the fake engine.

### 5.7 Inputs for the visual explorer (v1.4.0)

`Engine.inputs(q: NetworkQuery) → InputsResponse { stations[], corridors[], signals[], timeline[], sources[], warnings[] }`.

- `corridors`: one per route with both directions merged: `{ origin, destination, operator, stops[] (longest stopping
  pattern, running order), services, onTimeProb (mean history), exposureByHour[] (aligned with timeline) }`.
- `stations`: every corridor stop, with coordinates.
- `signals`: `SignalImpact { signal, expectedCostPence, affectedServices, routes[] }` for every signal in the window
  touching a corridor station or nationwide, including those that add nothing; sorted by start.
- `timeline`: one `ExposurePoint { at, services, expectedCostPence, baselineCostPence }` per hour of every London day
  in the window; its `expectedCostPence` sums to `/api/network`'s total. Fixture: `inputs.json`.

## 6. Tasks

Task ids (A1.3 …) are for boards and commit messages. **P0** = must have by M1, **P1** = by M2, **P2** = only if
ahead. Don't tick boxes here; progress lives on your board. Every lane keeps its `contract.test.ts` green and adds
tests for what it builds.

### 6.1 A1 · Signaller (`packages/signals`, `data/raw/signals`)

**Mission:** turn messy world data into clean, validated `Signal[]` and honest `SourceStatus[]` behind
`createSignalProvider()`.

P0
- **A1.1 Adapter framework.** One module per source returning `{ signals, quality, mode, fetchedAt }`. The provider
  merges, filters (§5.2), sorts and de-dupes by id. Live → `data/cache/signals/` → seed in `data/raw/signals/`;
  `isOffline()` never touches the network.
- **A1.2 Bank holidays** (gov.uk JSON, no key) → `bank_holiday` signals: England & Wales nationwide, Scotland-only days
  on Scottish stations, severity 0.3.
- **A1.3 Weather** (Open-Meteo hourly, no key) for every hero-corridor station: gusts, precipitation, snowfall,
  temperature → thresholds → merged windows (§4.4) → severity (§4.5) → confidence by lead time (§4.6).
- **A1.4 Football.** openfootball PL 2026/27 (plus `en.2` Championship if there's time): normalise team names, map
  home team → stadium (`data/raw/signals/stadiums.csv`: aliases, stadium, lat/lon, capacity, nearest CRS) → window →
  severity. Cross-check kick-offs with TheSportsDB (test key `123`); when they disagree prefer SportsDB, count
  `fixed.kickoff_moved_for_tv`, and use confidence 0.6 when only openfootball has the match.
- **A1.5 Concerts and big events.** `data/raw/signals/events.csv`, messy as found (mixed date formats, venue aliases,
  duplicates), covering big venues near hero stations. Real events where you can find them; otherwise "(sample)".
- **A1.6 Strikes and engineering works.** `data/raw/signals/disruptions.json`, hand-curated, operator names → ATOC
  codes, samples labelled.
- **A1.7 `listSources()`:** one `SourceStatus` per adapter with an honest mode and quality counts.

**Done at M1:** `getSignals({ from: "2026-11-20T00:00:00Z", to: "2026-11-22T23:59:59Z", stations: ["EUS", "MAN",
"MKC", "SOT", "SPT"] })` returns ≥ 5 schema-valid signals, including the real Man City v Fulham football signal (the real forecast is calm that
weekend, so no weather signal is expected: the weather adapter is proven on the 17 Nov Bristol gale in the snapshot),
offline too, in under 300 ms when warm.

P1
- **A1.8** Cross-source de-duplication and confidence merging.
- **A1.9** `npm run ingest -w @tot/signals` refreshes caches and prints the quality table; `--snapshot` copies live
  caches into `data/raw/signals/snapshot/` for the offline demo.
- **A1.10** Away-fan flows (Man Utd fans travelling Manchester → Liverpool) as lower-severity signals on the away
  team's stations.
- **A1.11** Ticketmaster Discovery (`TICKETMASTER_API_KEY`) for real concerts; TfL line status near London termini.

P2
- **A1.12** Historical weather (Open-Meteo archive), shared with A2 to back-test delays.
- **A1.13** Seasonal signals: autumn leaf-fall adhesion, summer heat.

### 6.2 A2 · Timetabler (`packages/rail`, `data/raw/rail`)

**Mission:** model the railway behind `createRailProvider()`: stations, departures, fares and punctuality.

P0
- **A2.1 Stations.** Save davwheat/uk-railway-stations (2,609 stations) into `data/raw/rail/` as is; clean in code
  ("Stoke-On-Trent" → "Stoke-on-Trent", "London Kings Cross" → "London King's Cross", aliases like "Euston" and
  "Piccadilly"); fuzzy search (§5.2); `getStation`.
- **A2.2 Timetable model.** `data/raw/rail/routes.json` for the hero corridors in both directions: EUS–MAN, EUS–LIV,
  EUS–BHM, KGX–LDS, KGX–EDB, PAD–BRI, **EDB–MAN** (the second scenario, §1.3) and MAN–LDS (operator, minutes past the
  hour, first/last departure per day type, duration, calling points). These are modelled patterns, not published
  timetables: label them as such (`seed:`). Expand into `JourneyOption[]` for any London date range and time window,
  ids `ORIGIN-DEST-departAt`.
- **A2.3 Fares.** A walk-up table per route (anytime / off-peak / super off-peak, in pence); peak rules (weekday
  departures before 09:30 and 16:00–18:59 from London, and the mirror image for morning arrivals into London);
  Advance pricing by days before travel (on sale 12 weeks out, stepping up at 28/14/7/2 days, some trains sell out).
  `getFareCurve` = the cheapest fare on sale on each booking day from on-sale to travel day.
- **A2.4 Punctuality baseline.** `data/raw/rail/performance.csv` (route, date, planned time, delay minutes,
  cancelled). Use real data if you can get it (Realtime Trains, HSP); otherwise build a realistic messy sample (typos,
  missing actuals, "5 mins" as text, duplicates), label it `seed:`, and clean it in code. Aggregate per route × day
  type × hour → `onTimeProb` (≤ 15 min late and not cancelled), `cancelProb`, `avgDelayMin`, `sampleSize`; shrink
  small samples toward the route average.
- **A2.5 Rush hour.** A crowding baseline per route × day type × hour (weekdays 07–09 and 16:30–18:30 high; Friday
  evening and Sunday afternoon leisure peaks), with `peak` set from the fare rules.

**Done at M1:** the hero `getJourneyOptions` returns ≥ 100 schema-valid departures with fares and baselines in under
200 ms; `searchStations("manc")` puts MAN first; `getFareCurve` works for every returned id.

P1
- **A2.6** Quality reports in `listSources()` (stations cleaned, history rows fixed and dropped).
- **A2.7** Calibrate walk-up fares on the hero routes against published fares (note source and date).
- **A2.8** More routes and return journeys; a railcard toggle (⅓ off), which needs an additive contract change.

P2
- **A2.9** Real timetables and punctuality from the Realtime Trains API (`RTT_USERNAME` / `RTT_PASSWORD`).
- **A2.10** Journeys with one change.

### 6.3 A3 · Controller (`packages/engine`, `packages/api`) and integration owner

**Mission:** turn departures and signals into ranked, explained recommendations, serve them, and keep the whole
system integrated.

P0
- **A3.1 Engine.** Implement §5.5 in `createEngine(deps)` using only the injected providers (query signals for the
  whole window and every station on every journey).
- **A3.2 Booking advice** from `rail.getFareCurve` (§5.5).
- **A3.3 Heatmap, best pick, warnings** (e.g. "Weather forecasts only reach 16 days ahead", "Advance fares not on sale
  yet").
- **A3.4 API hardening.** Endpoints exactly as §5.3. If a provider throws, fall back to that lane's fixture provider
  and add a warning: never a 500 in the demo. Memoise per query for 5 minutes.
- **A3.5 Integration owner.** Run the checkpoint (§7.2) at M1, M2 and M3; keep `packages/api/src/app.test.ts` (all
  lanes wired together) green; chase blockers through requests.

**Done at M1:** `/api/recommendations` for the hero query is computed by your engine (`/api/health` shows an engine
other than "fixture"), every `reason.signalId` resolves, and it answers in under 500 ms.

P1
- **A3.6** Engine unit tests: no departures, a nationwide strike, a signal spanning midnight, a BST date, priority 0
  vs 1 changing the best pick.
- **A3.7** Demand-adjusted Advance prices when big events hit the destination ("Advance prices up ~15%: match day").
- **A3.8** Tune the weights with A1 and A2 until the hero story reads right.

P2
- **A3.9** `GET /api/explain?journeyId=` deep dive (a contract change).
- **A3.10** Deploy (Render, Fly or Railway) for a shareable URL.

### 6.4 A4 · Platform (`packages/web`)

**Mission:** make the answer obvious in five seconds and the demo memorable.

P0
- **A4.1 Search.** Station autocomplete (`/api/stations`), date range (default: next Fri–Sun), departure window,
  *Cheapest ↔ Reliable* slider. Keep the state in the URL with the same params as the API, so links are shareable.
- **A4.2 Best-pick card.** London times, operator name, price, reliability %, verdict, and the top 3 reasons as chips
  with an icon per kind (⚽ 🌧 🎤 🎉 🛠 ✊ 💷 ⏱ 👥).
- **A4.3 Heatmap.** Dates × hours coloured by score (grey = no trains), tooltip with price and reliability; clicking
  a cell filters the list.
- **A4.4 Departures list.** Sort by score, price or time; peak and sold-out badges; reasons on expand.
- **A4.5 Booking advice.** The headline plus a fare-curve sparkline (inline SVG is fine).
- **A4.6 States.** Loading skeleton, empty, error (`ApiError.message`), and fixture mode (`VITE_USE_FIXTURES=1`).

**Done at M1:** in fixture mode and against the live API, a judge can search EUS → MAN and see the best pick,
heatmap and reasons without help.

P1
- **A4.7 "What we cleaned" panel** from `/api/sources`: rows in → out, top fixes and drops per source. The messy-data
  money shot.
- **A4.8** A signals timeline for the selected day.
- **A4.9** A map (Leaflet + OpenStreetMap tiles): route line and signal markers.
- **A4.10** Mobile layout, keyboard access, dark mode.

P2
- **A4.11** Compare two departures; share card; polish.
- **A4.12** Own `packages/web/DEMO.md`, the click path for the pitch (with A3), by M3.

## 7. Milestones

### 7.1 Timeline (relative to kickoff; the lead writes real times in the table at the top)

| Milestone | Target | Everyone | Proof |
|---|---|---|---|
| **M0 Hive up** | T + 0:20 | Joined, plan posted on board, `npm run check` green | `npm run hive:status` shows four 🟢 boards |
| **M1 Walking skeleton on real code** | T + 2:30 | Each lane's P0 core behind its interface (fixtures where not ready) | A3's checkpoint: hero query through real providers and engine, rendered by the web app |
| **M2 Feature complete** | T + 6:00 | All P0 + chosen P1 | The hero story tells itself from real data; quality panel; booking advice |
| **M3 Freeze** | end − 3:00 | Bug fixes only | Two offline rehearsals (`TOT_OFFLINE=1`), snapshots committed, `DEMO.md` |
| **Demo** | end | | The 3-minute pitch (§7.3) |

### 7.2 Integration checkpoint (A3 runs it; anyone may)

```bash
npm run hive:sync && npm run check
npm run dev
curl -s localhost:8787/api/health      # which lanes are real?
open "http://localhost:5173/?origin=EUS&destination=MAN&dateFrom=2026-11-20&dateTo=2026-11-22"
```

Post the result under "Notes for the team" on `hivemind/board/A3.md`: ✅ works · ❌ broken (owner) · next. File one
request per ❌ and don't fix other lanes' code.

### 7.3 Demo (3 minutes)

1. **Problem** (20 s): cheap trains get wrecked by things nobody joins up.
2. **Live search** (60 s): the hero query; best pick and heatmap.
3. **Why** (40 s): the reason chips. The match, the wind, the works; Liverpool v Man Utd correctly ignored.
4. **When to book** (20 s): the fare curve and the nudge.
5. **What we cleaned** (30 s): sources, rows in → out, fixes.
6. **How we built it** (10 s): four agents, one contract, zero merge conflicts.

## 8. Changing the contract

1. **Additive?** A new optional field, a new endpoint, or a new enum value that every `switch` handles: OK with your
   human's approval. **Breaking?** A rename, removal, type change or change of meaning: stop. The humans decide
   together, and the request file records the migration plan.
2. File it: `npm run hive:ask -- <affected lane | ALL> "contract: <change>"`.
3. Change `packages/shared/src/*`, regenerate fixtures (`npm run fixtures`) if shapes changed, update §5 here, bump
   `CONTRACT_VERSION` **and** the version in this file's first line (1.0.0 → 1.1.0), and add a line to §10.
4. Run `npm run check`, then commit **only** those files as `contract: <summary> (v1.1.0)` (the pre-commit hook
   enforces this) and push straight away.
5. Tell your human. The other agents pick it up on their next `npm run hive:sync`, which shows the new version.

## 9. Data sources (checked 2026-11-07 unless noted)

| Source | URL | Key | Lane | Notes (the mess) |
|---|---|---|---|---|
| Open-Meteo forecast | `https://api.open-meteo.com/v1/forecast?latitude=53.48&longitude=-2.23&hourly=temperature_2m,precipitation,wind_gusts_10m,snowfall,weather_code&timezone=UTC&forecast_days=16` | none | A1 | km/h; 16 days max; coordinates snap to a grid |
| Open-Meteo archive | `https://archive-api.open-meteo.com/v1/archive?latitude=…&longitude=…&start_date=…&end_date=…&hourly=wind_gusts_10m` | none | A1 (A2) | history for back-testing |
| GOV.UK bank holidays | `https://www.gov.uk/bank-holidays.json` | none | A1 | three divisions; curly apostrophes |
| openfootball PL 2026/27 | `https://raw.githubusercontent.com/openfootball/football.json/master/2026-27/en.1.json` | none | A1 | 380 matches; local times; no venues; "FC"/"AFC" suffixes; many 15:00 placeholders before TV picks |
| TheSportsDB | `https://www.thesportsdb.com/api/v1/json/123/eventsnextleague.php?id=4328` | test key `123` | A1 | TV-adjusted times, other spellings: openfootball has Brighton v Brentford on Sat 7 Nov 15:00, SportsDB on Sun 8 Nov 14:00 |
| football-data.org | `https://api.football-data.org/v4/competitions/PL/matches` | free key (`X-Auth-Token`) | A1 | optional |
| Ticketmaster Discovery | `https://app.ticketmaster.com/discovery/v2/events.json?countryCode=GB&apikey=…` | free key | A1 | optional, P1 |
| TfL line status | `https://api.tfl.gov.uk/Line/Mode/tube/Status` | none (rate-limited) | A1 | P1 |
| UK stations | `https://raw.githubusercontent.com/davwheat/uk-railway-stations/main/stations.json` | none | A2 | 2,609 stations: `stationName`, `lat`, `long`, `crsCode`, `constituentCountry`; inconsistent casing |
| Realtime Trains API | `https://api.rtt.io` (not checked) | free sign-up | A2 | P2: real timetables and punctuality |
| National Rail Data Portal (Darwin, fares) | `https://opendata.nationalrail.co.uk` (not checked) | sign-up, slow approval | A2 | probably too slow for a hackathon |

## 10. Changelog

| Version | When | Who | Change |
|---|---|---|---|
| 1.0.0 | 2026-11-07 | setup | Initial contract: lanes, schemas, HTTP API, fixtures, tasks |
| 1.1.0 | 2026-11-07 | setup | Fake providers also serve MAN → EUS (mirrored EUS → MAN fixtures) so return trips can be built; shapes unchanged |
| 1.2.0 | 2026-11-07 | LEAD | Solo mode; return trips, railcards, sorting and Trainline links documented (website-only); Edinburgh ⇄ Manchester second scenario; EDB–MAN and MAN–LDS added to A2.2; shapes unchanged |
| 1.3.0 | 2026-11-08 | LEAD | Pivot to an operator product: delay and Delay Repay 15 forecasting with costed mitigations (§1.5, §5.6). Additive: `/api/operations`, `/api/network`, their schemas, `Reason.compensationPence?`, `RailProvider.listRoutes?()`, `Engine.operations/network`, `operations.json` and `network.json` fixtures. The consumer API is unchanged |
| 1.4.0 | 2026-11-08 | LEAD | Data inputs explorer (§1.5, §5.7). Additive: `/api/inputs`, `InputsResponse`, `Corridor`, `SignalImpact`, `ExposurePoint`, `Engine.inputs`, `inputs.json` fixture |
