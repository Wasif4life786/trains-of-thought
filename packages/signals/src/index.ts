import type { SignalProvider } from "@tot/shared";
import { createFixtureSignalProvider } from "@tot/shared/fixtures";

/**
 * A1 · Signaller: the only thing other lanes import from this package.
 * TODO(A1): replace the fixture with real source adapters (contract.md §6.1). Keep this signature.
 */
export function createSignalProvider(): SignalProvider {
  return createFixtureSignalProvider();
}
