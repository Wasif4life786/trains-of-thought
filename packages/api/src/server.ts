import { fileURLToPath } from "node:url";
import { createEngine } from "@tot/engine";
import { createRailProvider } from "@tot/rail";
import { createSignalProvider } from "@tot/signals";
import { createApp } from "./app";

try {
  process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
} catch {
  // .env is optional (copy .env.example)
}

// The one place where the lanes meet.
const signals = createSignalProvider();
const rail = createRailProvider();
const engine = createEngine({ signals, rail });
const port = Number(process.env.API_PORT ?? 8787);

createApp({ signals, rail, engine }).listen(port, () => {
  console.log(`🚆 API on http://localhost:${port}  (signals: ${signals.name} · rail: ${rail.name} · engine: ${engine.name})`);
});
