#!/usr/bin/env node
// npm run hive:sync — pull the team's work (rebase + autostash), reinstall when dependencies moved, show status.
import { spawnSync } from "node:child_process";
import { ROOT, git, renderStatus } from "./lib.mjs";

if (!git(["remote"]).out) {
  console.log("hive: no git remote yet, nothing to pull. (Lead: push to GitHub; others: git remote add origin <url>.)");
} else {
  const before = git(["rev-parse", "HEAD"]).out;
  const pull = spawnSync("git", ["pull", "--rebase", "--autostash"], { cwd: ROOT, stdio: "inherit" });
  if (pull.status !== 0) {
    console.error(`
hive: ✋ the pull stopped. If it is a rebase conflict, resolve it and run \`git rebase --continue\`:
  • package-lock.json        → git checkout --ours package-lock.json && npm install && git add package-lock.json
  • a file in YOUR lane      → merge by hand (keep both sides' intent), then git add <file>
  • a file outside your lane → you shouldn't have changed it: git checkout --ours <file> && git add <file>
  (during a rebase --ours is the team's version from origin, --theirs is your commit)
  Stuck? \`git rebase --abort\` puts you back where you were.`);
    process.exit(1);
  }
  const after = git(["rev-parse", "HEAD"]).out;
  if (before && after && before !== after && git(["diff", "--name-only", before, after, "--", "package-lock.json"]).out) {
    console.log("hive: dependencies changed upstream → npm install");
    spawnSync("npm", ["install", "--no-audit", "--no-fund"], { cwd: ROOT, stdio: "inherit" });
  }
}
console.log(`\n${renderStatus()}`);
