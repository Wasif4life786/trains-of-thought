# Trains of Thought 🚆💭

> When should I take the train? We fuse messy real-world data (weather, football, concerts, strikes, engineering
> works, bank holidays, rush hour) with fares and punctuality history to find the departure that's **cheap and won't
> let you down**, and tell you when to book it.

Built at a hackathon by four humans and four Claude agents working in parallel: the hivemind.

## Quick start

```bash
npm install
npm run hive:join -- A1   # your lane: A1 Signaller · A2 Timetabler · A3 Controller · A4 Platform
npm run dev               # API http://localhost:8787 · web http://localhost:5173
```

Then open Claude Code in this folder and paste your lane's kickoff prompt from [prompt.md](prompt.md).

## Map

| Where | What |
|---|---|
| [CLAUDE.md](CLAUDE.md) | the rules every agent follows (loaded automatically) |
| [contract.md](contract.md) | the plan: product, interfaces, conventions, per-agent tasks, milestones |
| [prompt.md](prompt.md) | setup for humans, copy-paste prompts for agents |
| [hivemind/](hivemind/README.md) | team board, cross-lane requests, lane map |
| `packages/shared` | the contract in code: zod schemas, helpers, fixtures, fake providers |
| `packages/signals` · `rail` · `engine` · `api` · `web` | the four lanes |
| `data/` | raw messy inputs per lane, plus a git-ignored cache |
