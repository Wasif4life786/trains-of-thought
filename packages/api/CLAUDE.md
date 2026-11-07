# A3 · API (owned by A3)

Lane notes live in `packages/engine/CLAUDE.md`. Endpoints and the error format: contract.md §5.3.

- Parse query params with `parseRecommendationQuery` / `parseSignalQuery` from `@tot/shared`.
- Never 500 in the demo: wrap provider calls and fall back to `@tot/shared/fixtures` with a warning (A3.4).
- `src/app.test.ts` is the end-to-end contract test for the whole team; keep it green.
