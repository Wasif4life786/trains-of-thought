// How the API behaves when things go wrong or repeat: a failing lane must never become a 500, and repeats are cached.
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createApiClient, type Engine } from "@tot/shared";
import { FIXTURE_QUERY, createFixtureEngine, createFixtureRailProvider, createFixtureSignalProvider } from "@tot/shared/fixtures";
import { createEngine } from "@tot/engine";
import { createRailProvider } from "@tot/rail";
import { createSignalProvider } from "@tot/signals";
import { createApp, type AppDeps } from "./app";

const fixtures = { signals: createFixtureSignalProvider(), rail: createFixtureRailProvider(), engine: createFixtureEngine() };
const servers: Server[] = [];

async function start(deps: Partial<AppDeps> & Pick<AppDeps, "engine">) {
  const server = createApp({ signals: fixtures.signals, rail: fixtures.rail, ...deps }).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  servers.push(server);
  return createApiClient({ baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
});

describe("a failing lane", () => {
  const explode = async () => Promise.reject(new Error("engine exploded"));
  const broken: Engine = { name: "broken", recommend: explode, operations: explode, network: explode, inputs: explode };

  it("falls back to the fixtures with a warning instead of a 500", async () => {
    const api = await start({ engine: broken, fallback: fixtures });
    const r = await api.recommendations(FIXTURE_QUERY);
    expect(r.options.length).toBeGreaterThan(0);
    expect(r.warnings.at(-1)).toMatch(/live engine failed/);
  });

  it("falls back for the operator endpoints too", async () => {
    const api = await start({ engine: broken, fallback: fixtures });
    const ops = await api.operations({ ...FIXTURE_QUERY, earliest: "05:00", latest: "23:30" });
    expect(ops.services.length).toBeGreaterThan(0);
    expect(ops.warnings.at(-1)).toMatch(/live engine failed/);
    expect((await api.network({ dateFrom: FIXTURE_QUERY.dateFrom, dateTo: FIXTURE_QUERY.dateTo })).alerts.length).toBeGreaterThan(0);
  });

  it("is a 500 only when there's no fallback to give", async () => {
    const api = await start({ engine: broken });
    await expect(api.recommendations(FIXTURE_QUERY)).rejects.toMatchObject({ status: 500, code: "internal" });
  });

  it("covers the other endpoints too", async () => {
    const dead = { name: "dead", searchStations: async () => Promise.reject(new Error("x")), listSources: async () => Promise.reject(new Error("x")) };
    const api = await start({ engine: broken, rail: { ...fixtures.rail, ...dead }, fallback: fixtures });
    expect((await api.stations("manchester")).map((s) => s.crs)).toContain("MAN");
    expect((await api.sources()).length).toBeGreaterThan(0);
  });
});

describe("the cache", () => {
  const counting = () => {
    const calls = { n: 0 };
    const engine: Engine = { ...fixtures.engine, name: "counting", recommend: async (q) => (calls.n++, fixtures.engine.recommend(q)) };
    return { calls, engine };
  };

  it("serves an identical search from memory", async () => {
    const { calls, engine } = counting();
    const api = await start({ engine });
    await api.recommendations(FIXTURE_QUERY);
    await api.recommendations(FIXTURE_QUERY);
    expect(calls.n).toBe(1);
    await api.recommendations({ ...FIXTURE_QUERY, priority: 0.9 });
    expect(calls.n).toBe(2);
  });

  it("can be turned off", async () => {
    const { calls, engine } = counting();
    const api = await start({ engine, cacheMs: 0 });
    await api.recommendations(FIXTURE_QUERY);
    await api.recommendations(FIXTURE_QUERY);
    expect(calls.n).toBe(2);
  });
});

describe("the second scenario, through every real lane", () => {
  it("answers Edinburgh ⇄ Manchester with scored trains in both directions", async () => {
    const signals = createSignalProvider();
    const rail = createRailProvider();
    const api = await start({ signals, rail, engine: createEngine({ signals, rail }), cacheMs: 0 });
    for (const [origin, destination] of [["EDB", "MAN"], ["MAN", "EDB"]]) {
      const r = await api.recommendations({ ...FIXTURE_QUERY, origin, destination });
      expect(r.options.length, `${origin}→${destination}`).toBe(42);
      expect(r.options.every((o) => o.journey.origin === origin && o.journey.destination === destination)).toBe(true);
      expect(r.best?.journey.origin).toBe(origin);
      expect(r.bookingAdvice?.journeyId).toBe(r.best?.journey.id);
      expect(r.warnings.join(" ")).not.toMatch(/canned/);
    }
  });
});
