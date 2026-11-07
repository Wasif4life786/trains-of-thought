// npm run ingest -w @tot/signals: refresh every source and print the data-quality table.
// TODO(A1): write live results to data/cache/signals/ and support --snapshot for the offline demo (contract.md A1.9).
import { createSignalProvider } from "./index";

const sources = await createSignalProvider().listSources();
console.table(
  sources.map((s) => ({ source: s.id, mode: s.mode, in: s.quality.rowsIn, out: s.quality.rowsOut, fixed: JSON.stringify(s.quality.fixed), dropped: JSON.stringify(s.quality.dropped) })),
);
