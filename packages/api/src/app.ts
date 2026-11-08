import express, { type ErrorRequestHandler, type Request } from "express";
import { ZodError } from "zod";
import {
  API_ROUTES,
  CONTRACT_VERSION,
  parseNetworkQuery,
  parseOperationsQuery,
  parseRecommendationQuery,
  parseSignalQuery,
  toIsoUtc,
  type Engine,
  type Health,
  type RailProvider,
  type SignalProvider,
} from "@tot/shared";

export interface AppDeps {
  signals: SignalProvider;
  rail: RailProvider;
  engine: Engine;
  /** Used when a real lane throws, so the demo never shows a 500 (contract.md A3.4). Typically the fixture providers. */
  fallback?: { signals: SignalProvider; rail: RailProvider; engine: Engine };
  /** How long an identical search is served from memory. Default 5 minutes; 0 turns the cache off. */
  cacheMs?: number;
}

const searchParams = (req: Request) => new URL(req.originalUrl, "http://localhost").searchParams;
const isZodError = (err: unknown): err is ZodError => err instanceof ZodError || (err instanceof Error && err.name === "ZodError");
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * The HTTP API (contract.md §5.3). Every response validates against the shared schemas. If a lane throws we answer
 * from its fallback with a warning instead of failing; only bad input gets an error (400).
 */
export function createApp({ signals, rail, engine, fallback, cacheMs = 5 * 60_000 }: AppDeps) {
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    next();
  });

  /** Runs `real`; if it throws and there's a fallback, logs and runs that instead. */
  async function guarded<T>(what: string, real: () => Promise<T>, backup: (() => Promise<T>) | undefined): Promise<{ value: T; degraded: boolean }> {
    try {
      return { value: await real(), degraded: false };
    } catch (err) {
      if (!backup) throw err;
      console.error(`${what} failed, using the fallback:`, errorText(err));
      return { value: await backup(), degraded: true };
    }
  }

  const cache = new Map<string, { at: number; body: unknown }>();

  /** Serves an identical request from memory for `cacheMs`; a degraded (fallback) answer is never cached. */
  async function cached<T extends { warnings: string[] }>(key: string, what: string, real: () => Promise<T>, backup: (() => Promise<T>) | undefined): Promise<T> {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < cacheMs) return hit.body as T;
    const { value, degraded } = await guarded(what, real, backup);
    const body: T = degraded ? { ...value, warnings: [...value.warnings, "The live engine failed, so this answer comes from demo fixtures."] } : value;
    if (!degraded && cacheMs > 0) cache.set(key, { at: Date.now(), body });
    return body;
  }

  app.get(API_ROUTES.health, (_req, res) => {
    const health: Health = {
      ok: true,
      contractVersion: CONTRACT_VERSION,
      time: toIsoUtc(new Date()),
      providers: { signals: signals.name, rail: rail.name, engine: engine.name },
    };
    res.json(health);
  });

  app.get(API_ROUTES.stations, async (req, res) => {
    const params = searchParams(req);
    const q = params.get("q") ?? "";
    const limit = Math.min(20, Math.max(1, Number(params.get("limit")) || 8));
    const { value } = await guarded("rail.searchStations", () => rail.searchStations(q, limit), fallback && (() => fallback.rail.searchStations(q, limit)));
    res.json(value);
  });

  app.get(API_ROUTES.recommendations, async (req, res) => {
    const q = parseRecommendationQuery(searchParams(req));
    res.json(await cached(`rec:${JSON.stringify(q)}`, "engine.recommend", () => engine.recommend(q), fallback && (() => fallback.engine.recommend(q))));
  });

  app.get(API_ROUTES.operations, async (req, res) => {
    const q = parseOperationsQuery(searchParams(req));
    res.json(await cached(`ops:${JSON.stringify(q)}`, "engine.operations", () => engine.operations(q), fallback && (() => fallback.engine.operations(q))));
  });

  app.get(API_ROUTES.network, async (req, res) => {
    const q = parseNetworkQuery(searchParams(req));
    res.json(await cached(`net:${JSON.stringify(q)}`, "engine.network", () => engine.network(q), fallback && (() => fallback.engine.network(q))));
  });

  app.get(API_ROUTES.inputs, async (req, res) => {
    const q = parseNetworkQuery(searchParams(req));
    res.json(await cached(`inp:${JSON.stringify(q)}`, "engine.inputs", () => engine.inputs(q), fallback && (() => fallback.engine.inputs(q))));
  });

  app.get(API_ROUTES.signals, async (req, res) => {
    const q = parseSignalQuery(searchParams(req));
    const { value } = await guarded("signals.getSignals", () => signals.getSignals(q), fallback && (() => fallback.signals.getSignals(q)));
    res.json(value);
  });

  app.get(API_ROUTES.sources, async (_req, res) => {
    const [fromSignals, fromRail] = await Promise.all([
      guarded("signals.listSources", () => signals.listSources(), fallback && (() => fallback.signals.listSources())),
      guarded("rail.listSources", () => rail.listSources(), fallback && (() => fallback.rail.listSources())),
    ]);
    res.json([...fromSignals.value, ...fromRail.value]);
  });

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: { code: "not_found", message: "No such endpoint (contract.md §5.3)" } });
  });

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (isZodError(err)) {
      res.status(400).json({ error: { code: "bad_request", message: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), details: err.issues } });
      return;
    }
    console.error(err);
    res.status(500).json({ error: { code: "internal", message: errorText(err) } });
  };
  app.use(onError);

  return app;
}
