#!/usr/bin/env node
// Claude Code PreToolUse hook (.claude/settings.json) that keeps each agent inside its lane.
//   own lane, open files, anything outside the repo → normal permission flow
//   another agent's lane                         → denied, with how to ask for the change instead
//   shared contract or team-wide files           → the human is asked to approve
import { OWNERSHIP, classify, label, repoPath, whoami } from "./lib.mjs";

const decide = (permissionDecision, permissionDecisionReason) => {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision, permissionDecisionReason } }));
  process.exit(0);
};
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const { tool_name: tool, tool_input: input = {}, cwd } = JSON.parse(raw || "{}");
const me = whoami();
if (me === "LEAD") process.exit(0);

if (tool === "Bash") checkBash(String(input.command ?? ""));
else checkPath(input.file_path ?? input.notebook_path);
process.exit(0);

function checkPath(target) {
  if (!target) return;
  const rel = repoPath(target, cwd);
  if (!rel) return;
  if (!me || !OWNERSHIP.agents[me]) {
    decide("deny", "This checkout has no hivemind identity. Stop and ask your human which lane you are (A1–A4); they run `npm run hive:join -- A<n>`. Don't create .hive/agent yourself.");
  }
  const zone = classify(rel);
  if (zone.zone === "lane" && zone.owner !== me) {
    decide(
      "deny",
      `${rel} is in ${label(zone.owner)}'s lane and you are ${label(me)}. Don't edit it or work around this guard. ` +
        `Ask instead: \`npm run hive:ask -- ${zone.owner} "<what you need>"\`, stub what you need inside your own package, and keep going.`,
    );
  }
  if (zone.zone === "contract") {
    decide("ask", `${label(me)} wants to change the SHARED CONTRACT (${rel}). Approve only an additive change the team agreed on (contract.md §8): in its own "contract: …" commit, with CONTRACT_VERSION and changelog bumped.`);
  }
  if (zone.zone === "team") {
    decide("ask", `${label(me)} wants to change a team-wide file (${rel}). Approve only if the whole team agreed.`);
  }
}

function checkBash(command) {
  if (/hive:join|\.hive\/agent/.test(command)) {
    decide("ask", "This command sets or changes which lane this checkout belongs to. Approve only if you (the human) asked for it.");
  }
  if (!me || !OWNERSHIP.agents[me]) return;
  for (const [owner, agent] of Object.entries(OWNERSHIP.agents)) {
    if (owner === me) continue;
    for (const p of agent.paths) {
      const lane = escapeRegExp(p.replace(/\/$/, ""));
      const writesIntoLane = [
        new RegExp(`>{1,2}\\s*["']?[^|;&]*?\\b${lane}`),
        new RegExp(`\\b(sed|perl)\\b[^|;&]*\\s-i[^|;&]*\\b${lane}`),
        new RegExp(`\\b(rm|mv|touch|tee|truncate|mkdir)\\b[^|;&]*\\b${lane}`),
        new RegExp(`\\bgit\\s+(rm|mv|apply)\\b[^|;&]*\\b${lane}`),
      ];
      if (writesIntoLane.some((re) => re.test(command))) {
        decide(
          "deny",
          `This command looks like it writes into ${p}, which is ${label(owner)}'s lane. If you only meant to read, use a read-only command. ` +
            `If you need a change there: \`npm run hive:ask -- ${owner} "<what you need>"\`.`,
        );
      }
    }
  }
}
