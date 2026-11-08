/**
 * npm run fetch:rtt -w @tot/rail [-- --wait] [-- --snapshot] [-- --routes EUS-MAN,EDB-MAN]
 *
 * Saves real arrivals from Realtime Trains, one file per route direction per London day, into data/cache/rail/rtt/
 * (git-ignored). Resumable: days already saved are skipped, so run it again after a rate-limit stop, or pass --wait to
 * sleep through the hourly limit (free tier: 10/min, 100/hour, 1,000/day, the last 14 days only).
 * --snapshot also writes a stripped copy (only the fields we read) to data/raw/rail/rtt/ for the offline demo.
 *
 * Needs RTT_TOKEN in .env: a refresh token or a long-life access token from https://api-portal.rtt.io. The token
 * never leaves this script: it is not logged, cached or snapshotted.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { addDays, isOffline, londonToday } from "@tot/shared";
import { loadRoutes } from "./routes";
import { RTT_CACHE_DIR, RTT_SNAPSHOT_DIR } from "./rtt";

const BASE = "https://data.rtt.io";
const PACE_MS = 6_500;
/** Hero corridors first, so a rate-limit stop still leaves the demo routes covered. */
const PRIORITY = ["EUS-MAN", "MAN-EUS", "EDB-MAN", "MAN-EDB"];

try {
  process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
} catch {
  // .env is optional; RTT_TOKEN may come from the shell
}

const args = process.argv.slice(2);
const wait = args.includes("--wait");
const snapshot = args.includes("--snapshot");
const only = args.includes("--routes") ? new Set((args[args.indexOf("--routes") + 1] ?? "").split(",").filter(Boolean)) : null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class RateLimited extends Error {}

/** Bearer auth with either kind of token: use it directly if the API accepts it, else trade it for an access token. */
async function authenticator(token: string) {
  let access = token;
  let validUntil = Infinity;
  const info = async (bearer: string) => fetch(`${BASE}/api/info`, { headers: { Authorization: `Bearer ${bearer}` } });

  async function refresh() {
    const res = await fetch(`${BASE}/api/get_access_token`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`RTT_TOKEN was rejected (HTTP ${res.status}): request a new token at https://api-portal.rtt.io`);
    const body = (await res.json()) as { token: string; validUntil?: string };
    access = body.token;
    validUntil = body.validUntil ? Date.parse(body.validUntil) : Date.now() + 10 * 60_000;
  }

  let res = await info(access);
  if (res.status === 401) {
    await refresh();
    res = await info(access);
  }
  if (!res.ok) throw new Error(`Realtime Trains /api/info failed (HTTP ${res.status})`);
  const credentials = ((await res.json()) as { credentials?: { historyRestrictToDays?: number | null; namespacesAvailable?: string[] } }).credentials ?? {};
  return {
    historyDays: credentials.historyRestrictToDays ?? 14,
    namespaces: credentials.namespacesAvailable ?? [],
    async header() {
      if (validUntil !== Infinity && Date.now() > validUntil - 60_000) await refresh();
      return { Authorization: `Bearer ${access}` };
    },
  };
}

/** Only the fields parseRttDay reads: keeps the committed snapshot small and free of anything we don't use. */
function strip(body: {
  services?: { temporalData?: { arrival?: unknown }; origin?: { location?: { description?: string }; temporalData?: { scheduleAdvertised?: string; scheduleInternal?: string } }[]; scheduleMetadata?: Record<string, unknown> }[] | null;
}) {
  return {
    services: (body.services ?? []).map((s) => ({
      temporalData: { arrival: s.temporalData?.arrival },
      origin: (s.origin ?? []).slice(0, 1).map((o) => ({
        location: { description: o.location?.description },
        temporalData: { scheduleAdvertised: o.temporalData?.scheduleAdvertised, scheduleInternal: o.temporalData?.scheduleInternal },
      })),
      scheduleMetadata: {
        uniqueIdentity: s.scheduleMetadata?.uniqueIdentity,
        operator: s.scheduleMetadata?.operator,
        inPassengerService: s.scheduleMetadata?.inPassengerService,
        modeType: s.scheduleMetadata?.modeType,
      },
    })),
  };
}

function writeSnapshot() {
  let n = 0;
  if (!existsSync(RTT_CACHE_DIR)) return 0;
  for (const route of readdirSync(RTT_CACHE_DIR)) {
    if (!/^[A-Z]{3}-[A-Z]{3}$/.test(route)) continue;
    mkdirSync(`${RTT_SNAPSHOT_DIR}${route}`, { recursive: true });
    for (const f of readdirSync(`${RTT_CACHE_DIR}${route}`)) {
      if (!f.endsWith(".json")) continue;
      writeFileSync(`${RTT_SNAPSHOT_DIR}${route}/${f}`, `${JSON.stringify(strip(JSON.parse(readFileSync(`${RTT_CACHE_DIR}${route}/${f}`, "utf8"))))}\n`);
      n++;
    }
  }
  return n;
}

async function main() {
  if (isOffline()) {
    console.error("TOT_OFFLINE=1: not fetching. Unset it to talk to Realtime Trains.");
    process.exit(1);
  }
  const token = process.env.RTT_TOKEN?.trim();
  if (!token) {
    console.error("RTT_TOKEN is not set. Get a token at https://api-portal.rtt.io and add RTT_TOKEN=… to .env (never commit it).");
    process.exit(1);
  }

  const auth = await authenticator(token);
  if (!auth.namespaces.includes("gb-nr")) console.warn(`Warning: this token lists namespaces ${auth.namespaces.join(", ") || "none"}; gb-nr is needed.`);

  const today = londonToday();
  // The lookback counts today, so a 14-day key reaches 13 full past days (asking for the 14th is HTTP 400).
  const dates = Array.from({ length: Math.max(1, auth.historyDays - 1) }, (_, i) => addDays(today, -(i + 1)));
  const directions = loadRoutes()
    .flatMap((r) => [`${r.from}-${r.to}`, `${r.to}-${r.from}`])
    .filter((d) => !only || only.has(d))
    .sort((a, b) => (PRIORITY.indexOf(a) + 1 || 99) - (PRIORITY.indexOf(b) + 1 || 99));

  const todo = directions.flatMap((dir) => dates.map((date) => ({ dir, date }))).filter(({ dir, date }) => !existsSync(`${RTT_CACHE_DIR}${dir}/${date}.json`));
  console.log(`Realtime Trains: ${directions.length} directions × ${dates.length} days (${dates.at(-1)} → ${dates[0]}); ${todo.length} still to fetch.`);

  let done = 0;
  for (const { dir, date } of todo) {
    const [origin, dest] = dir.split("-") as [string, string];
    const url = `${BASE}/gb-nr/location?code=${dest}&filterFrom=${origin}&timeFrom=${date}T00:00:00&timeTo=${date}T23:59:00`;
    for (;;) {
      try {
        const res = await fetch(url, { headers: await auth.header(), signal: AbortSignal.timeout(20_000) });
        const hourLeft = Number(res.headers.get("x-ratelimit-remaining-hour") ?? "1");
        if (res.status === 429) throw new RateLimited();
        if (!res.ok) {
          console.warn(`  ${dir} ${date}: HTTP ${res.status}, skipped`);
          break;
        }
        const body = await res.json();
        mkdirSync(`${RTT_CACHE_DIR}${dir}`, { recursive: true });
        writeFileSync(`${RTT_CACHE_DIR}${dir}/${date}.json`, JSON.stringify(body));
        done++;
        console.log(`  ${dir} ${date}: ${(body as { services?: unknown[] }).services?.length ?? 0} services (${done}/${todo.length}, ${hourLeft} left this hour)`);
        if (hourLeft <= 0) throw new RateLimited();
        break;
      } catch (err) {
        if (!(err instanceof RateLimited)) throw err;
        if (!wait) {
          console.log(`Hourly limit reached after ${done} requests. Run again later (or with --wait); saved days are kept.`);
          return finish();
        }
        const next = new Date();
        next.setUTCMinutes(61, 0, 0);
        console.log(`Hourly limit reached: waiting until ${next.toISOString().slice(11, 16)} UTC…`);
        await sleep(next.getTime() - Date.now());
      }
    }
    await sleep(PACE_MS);
  }
  console.log(`Done: ${done} days fetched.`);
  finish();
}

function finish() {
  if (snapshot) console.log(`Snapshot: ${writeSnapshot()} files written to data/raw/rail/rtt/ (commit them before the demo).`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
