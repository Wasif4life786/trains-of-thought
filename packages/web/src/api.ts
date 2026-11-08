import { createApiClient, type InputsResponse, type NetworkQuery, type NetworkResponse, type OperationsQuery, type OperationsResponse, type Station } from "@tot/shared";

/** VITE_USE_FIXTURES=1 → answer from @tot/shared/fixtures without the API (offline demo, or before A3's API is up). */
export const usingFixtures = import.meta.env.VITE_USE_FIXTURES === "1";

const http = createApiClient();
const fixtures = () => import("@tot/shared/fixtures");

export const api = {
  operations: async (q: OperationsQuery): Promise<OperationsResponse> => (usingFixtures ? (await fixtures()).createFixtureEngine().operations(q) : http.operations(q)),
  network: async (q: NetworkQuery): Promise<NetworkResponse> => (usingFixtures ? (await fixtures()).createFixtureEngine().network(q) : http.network(q)),
  inputs: async (q: NetworkQuery): Promise<InputsResponse> => (usingFixtures ? (await fixtures()).createFixtureEngine().inputs(q) : http.inputs(q)),
  stations: async (q: string): Promise<Station[]> => (usingFixtures ? (await fixtures()).createFixtureRailProvider().searchStations(q) : http.stations(q)),
};
