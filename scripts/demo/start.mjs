#!/usr/bin/env node
// npm run demo            start the API + website (or reuse what's running), run the preflight, print the demo links
// npm run demo:offline    the same with TOT_OFFLINE=1: no network, everything from data/raw (the Wi-Fi-dies fallback)
//   --open                also open the main link in your browser (macOS/Linux)
import { spawn, spawnSync } from "node:child_process";
import { STORM, WEB, WEEKEND, runPreflight } from "./preflight.mjs";

const offline = process.argv.includes("--offline");
const link = (view, w) => `${WEB}/?view=${view}&origin=${w.origin}&destination=${w.destination}&dateFrom=${w.dateFrom}&dateTo=${w.dateTo}`;

const isUp = () => fetch(`${WEB}/api/health`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok).catch(() => false);

let child;
if (await isUp()) {
  console.log(`A stack is already running at ${WEB}: reusing it.${offline ? " (Stop it first if you need offline mode: it was started with its own settings.)" : ""}`);
} else {
  console.log(`Starting the API and website${offline ? " in OFFLINE mode (saved data only)" : ""}…`);
  child = spawn("npm", ["run", "dev"], { stdio: "inherit", env: { ...process.env, ...(offline ? { TOT_OFFLINE: "1" } : {}) } });
  const stop = () => child?.kill("SIGINT");
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  const deadline = Date.now() + 60_000;
  while (!(await isUp())) {
    if (child.exitCode !== null) process.exit(child.exitCode ?? 1);
    if (Date.now() > deadline) {
      console.error("The stack didn't come up within 60 s: check the output above (is port 5173 or 8787 in use?).");
      stop();
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

const ok = await runPreflight({ offline });
console.log(`Demo links
  Main (data inputs, the showpiece): ${link("inputs", WEEKEND)}
  Storm Monday (weather):            ${link("inputs", STORM)}
  Network alerts:                    ${link("network", WEEKEND)}
  Route risk board:                  ${link("route", WEEKEND)}
Click path and talk track: packages/web/DEMO.md
`);
if (ok && process.argv.includes("--open")) spawnSync(process.platform === "darwin" ? "open" : "xdg-open", [link("inputs", WEEKEND)]);
if (!child) process.exit(ok ? 0 : 1);
await new Promise((resolve) => child.on("exit", resolve));
