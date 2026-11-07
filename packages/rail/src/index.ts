import type { RailProvider } from "@tot/shared";
import { createFixtureRailProvider } from "@tot/shared/fixtures";

/**
 * A2 · Timetabler: the only thing other lanes import from this package.
 * TODO(A2): replace the fixture with the real station list, timetable, fare and punctuality models (contract.md §6.2). Keep this signature.
 */
export function createRailProvider(): RailProvider {
  return createFixtureRailProvider();
}
