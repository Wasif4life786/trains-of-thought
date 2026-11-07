#!/usr/bin/env node
// git pre-commit: refuse commits that touch another agent's lane, and keep contract changes in commits of their own.
import { classify, git, label, whoami } from "./lib.mjs";

const fail = (msg) => {
  console.error(`hive: ✋ commit blocked: ${msg}`);
  process.exit(1);
};

const me = whoami();
if (!me) {
  console.warn("hive: no identity (.hive/agent), skipping the lane check. Agents: npm run hive:join -- A<n>.");
  process.exit(0);
}
if (me === "LEAD") process.exit(0);

const staged = git(["diff", "--cached", "--name-only", "--no-renames"]).out.split("\n").filter(Boolean);
const foreign = [];
const contract = [];
const other = [];
const team = [];
for (const file of staged) {
  const zone = classify(file);
  if (zone.zone === "lane" && zone.owner !== me) foreign.push(`${file}  (${label(zone.owner)})`);
  else if (zone.zone === "contract") contract.push(file);
  else {
    other.push(file);
    if (zone.zone === "team") team.push(file);
  }
}

if (foreign.length) {
  fail(`these files are in other agents' lanes:\n  ${foreign.join("\n  ")}\nUnstage them (git restore --staged <file>) and ask the owner instead: npm run hive:ask -- <A1..A4> "…"`);
}
if (contract.length && other.length) {
  fail(`contract changes go in a commit of their own (contract.md §8).\n  contract: ${contract.join(", ")}\n  other:    ${other.join(", ")}\nCommit the contract files first ("contract: … (vX.Y.Z)"), then the rest.`);
}
if (team.length) console.warn(`hive: heads-up, this commit changes team-wide files: ${team.join(", ")}. Make sure the team agreed.`);
