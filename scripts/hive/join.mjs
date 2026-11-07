#!/usr/bin/env node
// npm run hive:join -- <A1|A2|A3|A4|LEAD> — records which lane this checkout belongs to (.hive/agent, git-ignored).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { installHooks } from "./install-hooks.mjs";
import { AGENT_IDS, IDENTITY_FILE, OWNERSHIP, ROOT, renderStatus } from "./lib.mjs";

const id = (process.argv[2] ?? "").toUpperCase();
if (![...AGENT_IDS, "LEAD"].includes(id)) {
  console.error("usage: npm run hive:join -- <A1|A2|A3|A4|LEAD>\n");
  for (const [k, a] of Object.entries(OWNERSHIP.agents)) console.error(`  ${k}    ${a.name.padEnd(11)} ${a.role}`);
  console.error("  LEAD  (humans only) no lane limits, for integrating by hand");
  process.exit(1);
}

mkdirSync(path.dirname(IDENTITY_FILE), { recursive: true });
writeFileSync(IDENTITY_FILE, `${id}\n`);
installHooks();
console.log(renderStatus());
console.log(
  id === "LEAD"
    ? "\nLEAD set. Switch back to a lane before an agent works here."
    : `\nNext: open Claude Code in ${ROOT} and paste the ${id} kickoff prompt from prompt.md.`,
);
