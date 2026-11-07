# A4 · Platform lane: notes (owned by A4)

You own `packages/web` (contract.md §6.4). It talks to the API only through `src/api.ts` (`createApiClient` from
`@tot/shared`, which validates every response against the contract).

- `VITE_USE_FIXTURES=1 npm run dev:web` runs without the API; `npm run dev` starts web + API.
- Display rules: prices with `formatPence`, operators with `operatorName`, times in Europe/London (`utcToLondon`, or
  Intl with `timeZone: "Europe/London"`).
- Keep the URL in sync with the API's query params (`toSearchParams` / `parseRecommendationQuery`) so links are
  shareable.
- Verdict colours: best and great green, good blue, risky amber, avoid red. Icons per reason kind: ⚽ football ·
  🌧 weather · 🎤 concert · 🎉 event or bank holiday · 🛠 engineering works · ✊ strike · 💷 price · ⏱ peak or history ·
  👥 crowding.
- Check every screen at phone width.

## Design notes and decisions

-
