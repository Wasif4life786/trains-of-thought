import { createApiClient, type RecommendationQuery, type RecommendationResponse, type Station } from "@tot/shared";

/** VITE_USE_FIXTURES=1 → answer from @tot/shared/fixtures without the API (offline demo, or before A3's API is up). */
export const usingFixtures = import.meta.env.VITE_USE_FIXTURES === "1";

const http = createApiClient();
const fixtures = () => import("@tot/shared/fixtures");

export const api = {
  recommendations: async (q: RecommendationQuery): Promise<RecommendationResponse> =>
    usingFixtures ? (await fixtures()).createFixtureEngine().recommend(q) : http.recommendations(q),
  stations: async (q: string): Promise<Station[]> =>
    usingFixtures ? (await fixtures()).createFixtureRailProvider().searchStations(q) : http.stations(q),
};
