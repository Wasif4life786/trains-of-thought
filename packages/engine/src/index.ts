import type { Engine, EngineDeps } from "@tot/shared";
import { createFixtureEngine } from "@tot/shared/fixtures";

/**
 * A3 · Controller: the scoring engine. It only sees the injected providers; never import @tot/signals or @tot/rail here.
 * TODO(A3): implement the default model in contract.md §5.5 (reference maths: packages/shared/scripts/generate-fixtures.ts).
 */
export function createEngine(_deps: EngineDeps): Engine {
  return createFixtureEngine();
}
