// End-to-end contract test: the REAL lanes on main, wired exactly like server.ts. The shared client validates every
// response against the zod schemas, so if any lane drifts from the contract this fails on the next push.
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiClient, type ApiClient } from "@tot/shared";
import { FIXTURE_QUERY } from "@tot/shared/fixtures";
import { createEngine } from "@tot/engine";
import { createRailProvider } from "@tot/rail";
import { createSignalProvider } from "@tot/signals";
import { createApp } from "./app";

describe("HTTP API (all lanes wired together)", () => {
  let server: Server;
  let api: ApiClient;

  beforeAll(async () => {
    const signals = createSignalProvider();
    const rail = createRailProvider();
    server = createApp({ signals, rail, engine: createEngine({ signals, rail }), cacheMs: 0 }).listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    api = createApiClient({ baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("GET /api/health", async () => {
    expect((await api.health()).ok).toBe(true);
  });

  it("GET /api/stations", async () => {
    expect((await api.stations("manchester")).map((s) => s.crs)).toContain("MAN");
  });

  it("GET /api/recommendations answers the hero query and cites only signals it returns", async () => {
    const r = await api.recommendations(FIXTURE_QUERY);
    expect(r.options.length).toBeGreaterThan(0);
    const ids = new Set(r.signals.map((s) => s.id));
    for (const o of r.options) for (const reason of o.reasons) if (reason.signalId) expect(ids.has(reason.signalId)).toBe(true);
  });

  it("GET /api/signals", async () => {
    const signals = await api.signals({ from: "2026-11-20T00:00:00Z", to: "2026-11-22T23:59:59Z", stations: ["MAN"] });
    expect(signals.length).toBeGreaterThan(0);
  });

  it("GET /api/sources", async () => {
    const sources = await api.sources();
    expect(sources.some((s) => s.lane === "signals") && sources.some((s) => s.lane === "rail")).toBe(true);
  });

  it("rejects bad input with 400 bad_request", async () => {
    await expect(api.recommendations({ ...FIXTURE_QUERY, origin: "nope" })).rejects.toMatchObject({ status: 400, code: "bad_request" });
  });
});
