# A3 · Controller lane: notes (owned by A3)

You own `packages/engine` (`createEngine`, contract.md §5.5) and `packages/api` (§5.3), and you're the integration
owner (§7.2).

- The engine only sees the injected `SignalProvider` and `RailProvider`. Never import `@tot/signals` or `@tot/rail`
  here; `packages/api/src/server.ts` wires the real lanes.
- Reference maths for §5.5: `packages/shared/scripts/generate-fixtures.ts`. Read it; don't import it.
- Query signals once per request: window = [first departure − 1 h, last arrival + 1 h], stations = every origin,
  destination and calling point.
- Take the time from `deps.now()` so tests and demo replays are deterministic.
- `packages/api/src/app.test.ts` wires ALL the real lanes together: it's the team's integration alarm. Keep it green;
  when another lane breaks it, file a request with the failing output.

## Tuning log (weights you changed and why)

-
