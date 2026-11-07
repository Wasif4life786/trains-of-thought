#!/usr/bin/env node
// npm run hive:status, and the Claude Code SessionStart hook: whatever this prints lands in the agent's context.
import { renderStatus } from "./lib.mjs";

console.log(renderStatus({ fetch: !process.argv.includes("--no-fetch") }));
