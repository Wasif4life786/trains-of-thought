import express, { type ErrorRequestHandler, type Request } from "express";
import { ZodError } from "zod";
import {
  API_ROUTES,
  CONTRACT_VERSION,
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
}

const searchParams = (req: Request) => new URL(req.originalUrl, "http://localhost").searchParams;
const isZodError = (err: unknown): err is ZodError => err instanceof ZodError || (err instanceof Error && err.name === "ZodError");

/**
 * The HTTP API (contract.md §5.3). A3 owns it; every response must validate against the shared schemas.
 * TODO(A3): when a provider throws, fall back to its fixture and add a warning instead of a 500 (contract.md A3.4).
 */
export function createApp({ signals, rail, engine }: AppDeps) {
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    next();
  });

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
    res.json(await rail.searchStations(params.get("q") ?? "", Number(params.get("limit") ?? 8)));
  });

  app.get(API_ROUTES.recommendations, async (req, res) => {
    res.json(await engine.recommend(parseRecommendationQuery(searchParams(req))));
  });

  app.get(API_ROUTES.signals, async (req, res) => {
    res.json(await signals.getSignals(parseSignalQuery(searchParams(req))));
  });

  app.get(API_ROUTES.sources, async (_req, res) => {
    res.json([...(await signals.listSources()), ...(await rail.listSources())]);
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
    res.status(500).json({ error: { code: "internal", message: err instanceof Error ? err.message : String(err) } });
  };
  app.use(onError);

  return app;
}
