#!/usr/bin/env node
// npm run hive:ask -- <A1|A2|A3|A4|ALL> "what you need" → creates a request file for another lane.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { AGENT_IDS, ROOT, label, whoami } from "./lib.mjs";

const fail = (msg) => {
  console.error(`hive: ${msg}`);
  process.exit(1);
};

const [toArg = "", ...words] = process.argv.slice(2);
const to = toArg.toUpperCase();
const title = words.join(" ").trim();
const me = whoami();
if (!me) fail("this checkout has no identity yet: npm run hive:join -- A<n>");
if (![...AGENT_IDS, "ALL"].includes(to) || !title) fail('usage: npm run hive:ask -- <A1|A2|A3|A4|ALL> "what you need"');

const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
let slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
if (slug.length > 40) slug = slug.slice(0, 40).replace(/-[^-]*$/, "");
const rel = `hivemind/requests/${day.replaceAll("-", "")}-${time.replace(":", "")}-${me}-to-${to}-${slug}.md`;
const file = path.join(ROOT, rel);
if (existsSync(file)) fail(`${rel} already exists`);

const template = readFileSync(path.join(ROOT, "hivemind/requests/_TEMPLATE.md"), "utf8");
writeFileSync(
  file,
  template.replace("{{from}}", me).replace("{{to}}", to).replace("{{created}}", `${day} ${time}`).replace("{{title}}", title),
);
console.log(`hive: created ${rel}
Next: fill in "What I need" and "Why", then commit and push it:
  git add "${rel}" && git commit -m "${me}(ask): ${title}" && npm run hive:sync && git push
and tell your human so they can ping ${to === "ALL" ? "the team" : `${label(to)}'s human`}. Keep working meanwhile (stub it in your lane).`);
