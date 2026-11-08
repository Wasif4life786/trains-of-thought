/**
 * Writes packages/shared/fixtures/operations.json and network.json: the real engine's operator answers for the hero
 * scenario, run on the fake providers so they're deterministic. A contract file: commit it in a "contract: …" commit.
 *   npm run fixtures:ops -w @tot/engine
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FIXTURE_BOOKING_DATE, FIXTURE_QUERY, createFixtureRailProvider, createFixtureSignalProvider } from "@tot/shared/fixtures";
import { InputsResponseSchema, NetworkResponseSchema, OperationsResponseSchema } from "@tot/shared";
import { createEngine } from "../src/index";

const engine = createEngine({ signals: createFixtureSignalProvider(), rail: createFixtureRailProvider(), now: () => new Date("2026-11-07T12:00:00Z") });
const dates = { dateFrom: FIXTURE_QUERY.dateFrom, dateTo: FIXTURE_QUERY.dateTo, bookingDate: FIXTURE_BOOKING_DATE };

const operations = OperationsResponseSchema.parse(
  await engine.operations({ origin: FIXTURE_QUERY.origin, destination: FIXTURE_QUERY.destination, earliest: "05:00", latest: "23:30", ...dates }),
);
const network = NetworkResponseSchema.parse(await engine.network(dates));
const inputs = InputsResponseSchema.parse(await engine.inputs(dates));

const out = (file: string) => fileURLToPath(new URL(`../../shared/fixtures/${file}`, import.meta.url));
writeFileSync(out("operations.json"), `${JSON.stringify(operations, null, 1)}\n`);
writeFileSync(out("network.json"), `${JSON.stringify(network, null, 1)}\n`);
writeFileSync(out("inputs.json"), `${JSON.stringify(inputs, null, 1)}\n`);
console.log(
  `operations.json: ${operations.services.length} services · network.json: ${network.alerts.length} alerts, ${network.routes.length} routes · inputs.json: ${inputs.signals.length} signals, ${inputs.stations.length} stations`,
);
