// Shared helpers for the hivemind scripts: identity, lane ownership, git, board and requests.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const OWNERSHIP = JSON.parse(readFileSync(path.join(ROOT, "hivemind/ownership.json"), "utf8"));
export const AGENT_IDS = Object.keys(OWNERSHIP.agents);
export const IDENTITY_FILE = path.join(ROOT, ".hive", "agent");
const REQUESTS_DIR = path.join(ROOT, "hivemind", "requests");

/** Which lane this checkout belongs to: $HIVE_AGENT, else .hive/agent (written by `npm run hive:join`). */
export function whoami() {
  const fromEnv = process.env.HIVE_AGENT?.trim().toUpperCase();
  if (fromEnv) return fromEnv;
  if (!existsSync(IDENTITY_FILE)) return null;
  return readFileSync(IDENTITY_FILE, "utf8").trim().toUpperCase() || null;
}

export const label = (id) => (OWNERSHIP.agents[id] ? `${id} ${OWNERSHIP.agents[id].name}` : id);

const inside = (rel, p) => (p.endsWith("/") ? rel.startsWith(p) : rel === p);

/** Zone of a repo-relative POSIX path: an agent's lane, the shared contract, open to anyone, or team-wide. */
export function classify(rel) {
  for (const [id, agent] of Object.entries(OWNERSHIP.agents)) {
    if (agent.paths.some((p) => inside(rel, p))) return { zone: "lane", owner: id };
  }
  if (OWNERSHIP.contract.some((p) => inside(rel, p))) return { zone: "contract" };
  if (OWNERSHIP.open.some((p) => inside(rel, p))) return { zone: "open" };
  return { zone: "team" };
}

/** Path (absolute, or relative to cwd) → repo-relative POSIX path, or null when it is outside the repo. */
export function repoPath(p, cwd = process.cwd()) {
  const rel = path.relative(ROOT, path.resolve(cwd, p));
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}

export function git(args, { timeout = 15_000 } = {}) {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", timeout, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}

export function contractVersion() {
  const src = readFileSync(path.join(ROOT, "packages/shared/src/schemas.ts"), "utf8");
  return /CONTRACT_VERSION\s*=\s*"([^"]+)"/.exec(src)?.[1] ?? "?";
}

function frontmatter(text) {
  const block = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
  const fields = {};
  for (const line of block.split("\n")) {
    const kv = /^(\w+):\s*([^#]*?)\s*(#.*)?$/.exec(line);
    if (kv) fields[kv[1]] = kv[2];
  }
  return fields;
}

/** Header of one agent's board: status, updated, first bullet under "## Now". */
export function readBoard(id) {
  const file = path.join(ROOT, "hivemind", "board", `${id}.md`);
  if (!existsSync(file)) return { status: "?", updated: "?", now: "" };
  const text = readFileSync(file, "utf8");
  return {
    status: /^status:\s*(.+)$/m.exec(text)?.[1].trim() ?? "?",
    updated: /^updated:\s*(.+)$/m.exec(text)?.[1].trim() ?? "?",
    now: /^## Now\s*\n+\s*-\s*(.+)$/m.exec(text)?.[1].trim() ?? "",
  };
}

export function readRequests() {
  if (!existsSync(REQUESTS_DIR)) return [];
  return readdirSync(REQUESTS_DIR)
    .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
    .sort()
    .map((f) => {
      const text = readFileSync(path.join(REQUESTS_DIR, f), "utf8");
      const fm = frontmatter(text);
      return {
        file: `hivemind/requests/${f}`,
        from: fm.from?.toUpperCase(),
        to: fm.to?.toUpperCase(),
        status: (fm.status || "open").toLowerCase(),
        title: /^# (.+)$/m.exec(text)?.[1] ?? f,
      };
    });
}

/** The briefing shown at every Claude session start and by `npm run hive:status`. */
export function renderStatus({ fetch = false } = {}) {
  const me = whoami();
  const out = ["🐝 Trains of Thought hivemind"];
  if (!me) {
    out.push(
      "⚠️  No hivemind identity on this checkout, so file edits are blocked.",
      "   Ask your human which lane you are (A1 Signaller · A2 Timetabler · A3 Controller · A4 Platform); they run: npm run hive:join -- A<n>",
    );
  } else if (me === "LEAD") {
    out.push("You are LEAD (a human integrating by hand): no lane limits. Agents never use LEAD.");
  } else if (OWNERSHIP.agents[me]) {
    const a = OWNERSHIP.agents[me];
    out.push(
      `You are ${me} · ${a.name} — ${a.role}`,
      `You own: ${a.paths.join("  ")}`,
      `Your tasks: contract.md §6 (${me}). Other lanes are read-only; contract and team files need your human's approval.`,
    );
  } else {
    out.push(`⚠️  Unknown identity "${me}" in .hive/agent. Run: npm run hive:join -- A<n>`);
  }
  out.push(`Contract: v${contractVersion()} (contract.md; changes are listed in §10)`);

  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!branch.ok && git(["symbolic-ref", "--short", "HEAD"]).ok) {
    out.push(`Git: ${git(["symbolic-ref", "--short", "HEAD"]).out} · no commits yet`);
  } else if (branch.ok) {
    if (fetch && git(["remote"]).out) git(["fetch", "--quiet"], { timeout: 8_000 });
    let line = `Git: ${branch.out}`;
    const upstream = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
    if (upstream.ok) {
      const [behind = 0, ahead = 0] = git(["rev-list", "--left-right", "--count", `${upstream.out}...HEAD`]).out.split(/\s+/).map(Number);
      line += ` · ${behind} behind, ${ahead} ahead of ${upstream.out}`;
      if (behind) line += " → run `npm run hive:sync` before you start";
    } else {
      line += " · no upstream yet";
    }
    const dirty = git(["status", "--porcelain"]).out.split("\n").filter(Boolean).length;
    if (dirty) line += ` · ${dirty} uncommitted change(s)`;
    out.push(line);
  }

  const requests = readRequests();
  const live = (r) => r.status === "open" || r.status === "accepted";
  if (me && OWNERSHIP.agents[me]) {
    const forMe = requests.filter((r) => (r.to === me || r.to === "ALL") && r.from !== me && live(r));
    const answered = requests.filter((r) => r.from === me && (r.status === "done" || r.status === "declined")).slice(-3);
    out.push(forMe.length ? `Requests for you (${forMe.length}):` : "Requests for you: none open");
    for (const r of forMe) out.push(`  • [${r.status}] ${r.title} (from ${r.from}) ${r.file}`);
    for (const r of answered) out.push(`  ✓ your request "${r.title}" is ${r.status}: ${r.file}`);
  } else {
    const open = requests.filter(live);
    out.push(`Open requests: ${open.length}`);
    for (const r of open) out.push(`  • ${r.from} → ${r.to}: ${r.title} [${r.status}]`);
  }

  out.push("Team board (hivemind/board/):");
  for (const id of AGENT_IDS) {
    const b = readBoard(id);
    out.push(`  ${label(id).padEnd(14)} ${b.status.padEnd(16)} ${b.updated.padEnd(17)} ${b.now}`);
  }
  out.push("Loop: npm run hive:sync → small change + tests → commit → hive:sync → push → update your board. Stay in your lane.");
  return out.join("\n");
}
