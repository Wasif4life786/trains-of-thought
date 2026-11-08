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

  it("GET /api/operations prices Delay Repay risk for the hero route and cites only signals it returns", async () => {
    const r = await api.operations({ origin: "EUS", destination: "MAN", dateFrom: FIXTURE_QUERY.dateFrom, dateTo: FIXTURE_QUERY.dateTo, earliest: "05:00", latest: "23:30" });
    expect(r.services.length).toBeGreaterThan(0);
    expect(r.totals.expectedCostPence).toBe(r.services.reduce((n, s) => n + s.compensation.expectedCostPence, 0));
    const ids = new Set(r.signals.map((s) => s.id));
    for (const s of r.services) for (const x of [...s.reasons, ...s.mitigations]) if (x.signalId) expect(ids.has(x.signalId)).toBe(true);
  });

  it("GET /api/network sweeps every route, biggest exposure first", async () => {
    const r = await api.network({ dateFrom: FIXTURE_QUERY.dateFrom, dateTo: FIXTURE_QUERY.dateTo });
    expect(r.routes.length).toBeGreaterThanOrEqual(16);
    const costs = r.routes.map((x) => x.expectedCostPence);
    expect(costs).toEqual([...costs].sort((a, b) => b - a));
  });

  it("GET /api/inputs gives the map every corridor, its stations and the signals on it", async () => {
    const r = await api.inputs({ dateFrom: FIXTURE_QUERY.dateFrom, dateTo: FIXTURE_QUERY.dateTo });
    expect(r.corridors.length).toBeGreaterThanOrEqual(8);
    const placed = new Set(r.stations.map((s) => s.crs));
    for (const c of r.corridors) for (const crs of c.stops) expect(placed.has(crs)).toBe(true);
    expect(r.signals.length).toBeGreaterThan(0);
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
