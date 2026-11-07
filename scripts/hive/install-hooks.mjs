#!/usr/bin/env node
// Points git at the versioned hooks in .githooks (pre-commit: lane check, pre-push: npm run check). Runs on `npm install`.
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, git } from "./lib.mjs";

export function installHooks() {
  if (!existsSync(path.join(ROOT, ".git"))) return false;
  const r = git(["config", "core.hooksPath", ".githooks"]);
  if (!r.ok) console.warn(`hive: could not set core.hooksPath (${r.err}). Run it yourself: git config core.hooksPath .githooks`);
  return r.ok;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) installHooks();
