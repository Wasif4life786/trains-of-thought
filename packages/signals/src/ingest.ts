// npm run ingest -w @tot/signals            refresh every source live (filling data/cache) and print the data-quality table
// npm run ingest -w @tot/signals -- --snapshot   also freeze what was fetched into data/raw/signals/snapshot/ so the
//                                           demo runs without Wi-Fi (TOT_OFFLINE=1 then uses it as the seed)
import { createSignalProvider } from "./index";

if (process.argv.includes("--snapshot")) process.env.TOT_SNAPSHOT = "1";

const sources = await createSignalProvider({ offline: false }).listSources();
console.table(
  sources.map((s) => ({
    source: s.id,
    mode: s.mode,
    in: s.quality.rowsIn,
    out: s.quality.rowsOut,
    fixed: JSON.stringify(s.quality.fixed),
    dropped: JSON.stringify(s.quality.dropped),
  })),
);
if (sources.some((s) => s.mode === "down")) process.exitCode = 1;
if (process.env.TOT_SNAPSHOT === "1") console.log("Snapshot written to data/raw/signals/snapshot/ (commit it before the demo).");
