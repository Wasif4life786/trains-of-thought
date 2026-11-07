# CLAUDE.md: Trains of Thought (hackathon, four-agent hivemind)

**Product:** find the cheapest, most reliable time to take the train. We fuse messy world data (weather, football,
concerts, strikes, engineering works, bank holidays, rush hour) with fares and punctuality history, explain the
answer, and say when to book.

**Team:** four humans, each running one Claude agent. You are one of those agents. The hivemind only works if every
agent stays in its lane and codes against the contract.

## 1. Start of every session

1. Read the hivemind briefing injected at session start (or run `npm run hive:status`): who you are, what you own,
   requests waiting for you, and the team board.
2. No identity? Stop and ask your human which lane you are. They run `npm run hive:join -- A<n>`.
   Working alone? Your human runs `npm run hive:join -- LEAD` and you may work in every lane (contract.md §3, solo mode).
3. Run `npm run hive:sync` (pull --rebase, reinstall if needed, show status) before you start a task.
4. Your tasks are in **contract.md §6** under your id. Interfaces: §5. Conventions: §4. Milestones: §7.

## 2. Lanes

| Agent | Name | You may write | You deliver |
|---|---|---|---|
| A1 | Signaller | `packages/signals/`, `data/raw/signals/` | `createSignalProvider()`: messy world data → `Signal[]` |
| A2 | Timetabler | `packages/rail/`, `data/raw/rail/` | `createRailProvider()`: stations, departures, fares, punctuality |
| A3 | Controller | `packages/engine/`, `packages/api/` | `createEngine()` and the HTTP API; integration owner |
| A4 | Platform | `packages/web/` | the website and the demo flow |

Also yours: `hivemind/board/<your id>.md`. Open to anyone: `hivemind/requests/`.
**Contract** (`packages/shared/`, `contract.md`): additive changes only, human-approved, in a commit of their own
(contract.md §8). **Team files** (this file, `prompt.md`, root configs, `scripts/`, `.claude/`,
`hivemind/ownership.json`): human-approved.

Hooks enforce this. A Claude PreToolUse hook (`scripts/hive/guard.mjs`) blocks edits to other lanes and asks your
human before contract or team edits; the git pre-commit hook rejects commits that touch other lanes. **Never work
around them**: no shell redirection into other lanes, no `--no-verify`, no editing `.hive/agent`.

Need something from another lane? Run `npm run hive:ask -- A2 "what you need"`, fill in the file, commit and push it,
and tell your human. Meanwhile stub it **inside your own lane** (start from `@tot/shared/fixtures`) and keep going.
Never sit idle waiting.

## 3. Hard rules (details in contract.md §4)

- **Money** is integer pence. `formatPence` for display, `parsePounds` for messy input.
- **Time:** instants are ISO UTC with seconds and `Z` (`toIsoUtc`, never bare `toISOString()`). Dates and times users
  see or type are Europe/London (`londonToUtc`, `utcToLondon`). No hand-rolled offset maths.
- Stations are CRS codes (`EUS`), operators ATOC codes (`VT`), probabilities 0..1, scores 0..100. IDs are
  deterministic.
- Validate at boundaries with the zod schemas from `@tot/shared`; your lane's `src/contract.test.ts` stays green.
- **Offline-safe:** honour `isOffline()` (TOT_OFFLINE=1, always on under Vitest). Tests never hit the network. Live
  sources fall back to `data/cache/`, then `data/raw/`.
- Raw data stays untouched in `data/raw/<lane>/`; clean it in code and count every fix and drop in a `QualityReport`.
  Label invented data "(sample)".
- Import other packages only through their entry (`@tot/rail`, never `@tot/rail/src/…`). The engine and web import
  `@tot/shared` only.
- Don't read whole fixture JSONs (`recommendation.json` is ~270 KB). Use `packages/shared/fixtures/README.md` and
  `recommendation.sample.json`.
- Don't reformat or refactor files you don't own. Add dependencies only to your own package:
  `npm install <pkg> -w @tot/<yours>`.

## 4. Git: trunk-based, small and often

- Everyone commits to `main`. The loop: `npm run hive:sync` → small change + tests → commit → `npm run hive:sync` →
  `git push` → update your board.
- Commit messages: `A2(rail): advance fare curve (A2.3)` · `contract: add Signal.url (v1.1.0)` · `A2(board): …` ·
  `A2(ask): …`.
- Push at least every 30–45 minutes; never sit on more than an hour of unpushed work.
- pre-push runs `npm run check` (typecheck + every package's tests), so main stays green. If another lane broke main,
  tell your human and file a request; don't fix their code.
- After each push, update `hivemind/board/<id>.md` (status, Now, Done, Next, Blocked). It's how the other agents see
  you.
- Rebase conflicts: during `git pull --rebase`, `--ours` is the team's version and `--theirs` is your commit. For a
  `package-lock.json` conflict: `git checkout --ours package-lock.json && npm install && git add package-lock.json &&
  git rebase --continue`.

## 5. Commands

| Command | What it does |
|---|---|
| `npm install` | installs everything and points git at `.githooks/` |
| `npm run dev` | API on http://localhost:8787 + web on http://localhost:5173 |
| `npm run check` | typecheck + all tests (what pre-push runs) |
| `npm test -w @tot/<pkg>` | one package's tests |
| `VITE_USE_FIXTURES=1 npm run dev:web` | the UI without the API |
| `npm run fixtures` | regenerates `packages/shared/fixtures/` (a contract change) |
| `npm run hive:status` · `hive:sync` · `hive:ask -- <A1..A4\|ALL> "…"` | the hivemind |

Environment: copy `.env.example` to `.env`; every key is optional.

## 6. Stack

Node ≥ 20.12 · TypeScript 7, strict, everywhere · npm workspaces; internal packages export TS source (no build step) ·
Vitest · zod 4 · API: Express 5 run by tsx · Web: React 19, Vite 8, Tailwind 4.

## 7. Definition of done (any task)

Typecheck and tests green · output validates against the contract · works offline · pushed · board updated · anything
other lanes rely on is noted under "Notes for the team" on your board.
