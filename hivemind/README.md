# hivemind/: four agents, one repo, no collisions

Four humans each run one Claude agent. Every agent owns a **lane** (a set of folders), codes against the
**contract** (`contract.md` + `packages/shared`), and talks to the others only through files in this folder.

## The pieces

| What | Where | Who writes it |
|---|---|---|
| Lane map (machine-readable) | `hivemind/ownership.json` | the team (human-approved) |
| Identity of a checkout | `.hive/agent` (git-ignored) | humans, via `npm run hive:join -- A<n>` |
| Live status of each agent | `hivemind/board/A1.md` … `A4.md` | each agent edits **only its own** |
| Cross-lane requests | `hivemind/requests/*.md` | requester creates; receiver sets status and responds |
| Session briefing | `scripts/hive/status.mjs` (Claude SessionStart hook) | runs automatically |
| Lane guard for Claude | `scripts/hive/guard.mjs` (Claude PreToolUse hook) | runs on every Edit/Write/Bash |
| Lane guard for git | `.githooks/pre-commit` → `scripts/hive/check-staged.mjs` | runs on every commit |
| Green main | `.githooks/pre-push` → `npm run check` | runs on every push |

## Zones

| Zone | Paths | Rule |
|---|---|---|
| your lane | see `ownership.json` | edit freely |
| another lane | see `ownership.json` | **blocked**: file a request instead |
| contract | `packages/shared/`, `contract.md` | human approves; additive only; commit on its own (contract.md §8) |
| open | `hivemind/requests/`, `data/cache/`, `package-lock.json` | anyone |
| team | everything else (`CLAUDE.md`, `prompt.md`, root configs, `scripts/`, `.claude/`, `ownership.json`, …) | human approves; whole team agrees |

## The loop (every agent, all hackathon)

```
npm run hive:sync → small change + tests → git commit → npm run hive:sync → git push → update your board
```

Push at least every 30–45 minutes. The pre-push hook runs `npm run check` for the whole repo, so a broken
integration is caught by whoever pushes second, not discovered at demo time.

## Requests

```bash
npm run hive:ask -- A2 "Need callingPoints on every JourneyOption"
```

1. Fill in the created file, commit and push it, and tell your human. Humans relay urgent asks out loud.
2. Receiver: set `status: accepted`, do it, set `status: done` and write a Response, then push.
3. Never wait idle: stub what you need **inside your own lane** (start from `@tot/shared/fixtures`) and carry on.

Open requests addressed to an agent show up in its session-start briefing.

## Board format

The first lines of each board are parsed by `npm run hive:status`:

```
status: 🟢 on track        (⚪ not started · 🟢 on track · 🟡 at risk · 🔴 blocked · ✅ demo-ready)
updated: 2026-11-07 22:40
## Now
- the one thing you're doing right now    ← shown in everyone's briefing
```

## Several agents on one machine?

Give each agent its own worktree (separate folder, own `.hive/agent`, own `node_modules`):

```bash
git worktree add -b lane/A2 "../tot-A2" main
cd ../tot-A2 && npm install && npm run hive:join -- A2
git branch --set-upstream-to=origin/main   # hive:sync now pulls main
git push origin HEAD:main                  # how this worktree pushes
```

## Escape hatches (humans only)

- `npm run hive:join -- LEAD` removes lane limits for hand-integration. Switch back before an agent works there.
- `HIVE_SKIP_CHECKS=1 git push` skips the pre-push check in an emergency. Say so on your board.
