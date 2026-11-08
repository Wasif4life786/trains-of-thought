#!/usr/bin/env node
// npm run demo:check: proves the stack is ready to demo. Hits the same URLs the browser will (through the Vite proxy),
// checks each operator view has data, that no source is down, and that both demo windows have what the story needs.
//   --offline   expect saved data only (TOT_OFFLINE=1): fails if anything claims to be live
import { pathToFileURL } from "node:url";

export const WEB = process.env.DEMO_URL ?? "http://localhost:5173";
export const WEEKEND = { origin: "EUS", destination: "MAN", dateFrom: "2026-11-20", dateTo: "2026-11-22" };
/** The storm window: gusts of 43–58 mph across the network on Mon 16 Nov (in the 7 Nov–8 Nov forecasts). */
export const STORM = { origin: "EUS", destination: "MAN", dateFrom: "2026-11-14", dateTo: "2026-11-16" };

const pounds = (pence) => `£${Math.round(pence / 100).toLocaleString("en-GB")}`;

async function get(path, params) {
  const url = `${WEB}${path}${params ? `?${new URLSearchParams(params)}` : ""}`;
  const t = performance.now();
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  const ms = Math.round(performance.now() - t);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${path}: ${text.slice(0, 120)}`);
  return { ms, body: path.startsWith("/api") ? JSON.parse(text) : text };
}

/** Runs every check, printing one line each. Returns true when all pass (warnings don't fail). */
export async function runPreflight({ offline = false } = {}) {
  let failed = 0;
  const check = async (name, fn) => {
    try {
      const { detail, warn } = await fn();
      console.log(`${warn ? " ⚠️ " : " ✓ "} ${name.padEnd(24)} ${detail}`);
    } catch (e) {
      failed++;
      console.log(` ✗  ${name.padEnd(24)} ${e instanceof Error ? e.message : e}`);
    }
  };
  const need = (cond, msg) => {
    if (!cond) throw new Error(msg);
  };

  console.log(`\nDemo preflight · ${WEB}${offline ? " · offline mode" : ""}\n`);

  await check("website", async () => {
    const { body, ms } = await get("/");
    need(body.includes('id="root"'), "the page didn't load the app");
    return { detail: `up (${ms} ms)` };
  });

  await check("API health", async () => {
    const { body } = await get("/api/health");
    const p = body.providers;
    const real = p.signals === "signals" && p.rail === "rail-model" && p.engine === "engine";
    return { detail: `contract v${body.contractVersion} · signals ${p.signals} · rail ${p.rail} · engine ${p.engine}${real ? "" : "  (a lane is on fixtures!)"}`, warn: !real };
  });

  await check("Route risk board", async () => {
    const { body, ms } = await get("/api/operations", WEEKEND);
    need(body.services.length > 0 && body.totals.services > 0, "no services");
    return { detail: `${body.totals.services} services · ${body.totals.highRiskServices} high risk · ${pounds(body.totals.expectedCostPence)} expected Delay Repay (${ms} ms)` };
  });

  let alerts = 0;
  await check("Network alerts", async () => {
    const { body, ms } = await get("/api/network", WEEKEND);
    need(body.alerts.length > 0 && body.routes.length > 0, "no alerts or routes");
    alerts = body.alerts.length;
    return { detail: `${body.alerts.length} alerts · ${body.routes.length} routes · ${pounds(body.totals.expectedCostPence)} (${ms} ms)` };
  });

  await check("Data inputs (weekend)", async () => {
    const { body, ms } = await get("/api/inputs", WEEKEND);
    need(body.corridors.length > 0 && body.signals.length > 0 && body.timeline.length > 0, "map, signals or timeline missing");
    const kinds = [...new Set(body.signals.map((s) => s.signal.kind))].join(", ");
    return { detail: `${body.corridors.length} corridors · ${body.signals.length} signals (${kinds}) (${ms} ms)` };
  });

  await check("Storm window (weather)", async () => {
    const { body } = await get("/api/network", STORM);
    const weather = body.alerts.filter((a) => a.signal.kind === "weather");
    need(weather.length > 0, "no weather alerts for 14–16 Nov: the snapshot or forecast changed; pick another demo window");
    const top = weather.reduce((a, b) => (b.expectedCostPence > a.expectedCostPence ? b : a));
    return { detail: `${weather.length} weather alerts · biggest "${top.signal.title}" adds ${pounds(top.expectedCostPence)}` };
  });

  await check("Data sources", async () => {
    const { body } = await get("/api/sources");
    const down = body.filter((s) => s.mode === "down");
    need(down.length === 0, `down: ${down.map((s) => s.id).join(", ")}`);
    const live = body.filter((s) => s.mode === "live").length;
    if (offline) {
      need(live === 0, `${live} source(s) are live; expected saved data only (start with TOT_OFFLINE=1)`);
      return { detail: `${body.length} sources, all from saved data` };
    }
    return { detail: `${body.length} sources · ${live} live · ${body.length - live} saved${live === 0 ? "  (no network? running on the snapshot)" : ""}`, warn: live === 0 };
  });

  console.log(failed === 0 ? `\n Ready. ${alerts} network alerts on the weekend view.\n` : `\n ${failed} check(s) failed: fix those before demoing.\n`);
  return failed === 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit((await runPreflight({ offline: process.argv.includes("--offline") })) ? 0 : 1);
}
