import { describe, expect, it } from "vitest";
import { utcToLondon } from "@tot/shared";
import { findRoutes, loadRoutes, parseJourneyId, servicesOn } from "./routes";
import { loadStations } from "./stations";

describe("routes", () => {
  it("only uses stations that exist in the station dataset", () => {
    const { byCrs } = loadStations();
    for (const r of loadRoutes()) for (const crs of [r.from, r.to, ...r.patterns.flatMap((p) => p.callingPoints)]) expect(byCrs.has(crs), `${r.id}: ${crs}`).toBe(true);
  });

  it("finds a route in either direction, and nothing for unconnected stations", () => {
    expect(findRoutes("EDB", "MAN")).toMatchObject([{ route: { id: "EDB-MAN" }, reverse: false }]);
    expect(findRoutes("MAN", "EDB")).toMatchObject([{ route: { id: "EDB-MAN" }, reverse: true }]);
    expect(findRoutes("EDB", "BRI")).toEqual([]);
  });

  it("runs Edinburgh → Manchester hourly with TransPennine, and back with the calling points reversed", () => {
    const [{ route }] = findRoutes("EDB", "MAN");
    const there = servicesOn(route, false, "2026-11-21");
    const back = servicesOn(route, true, "2026-11-21");
    expect(there).toHaveLength(15);
    expect(there[0]).toMatchObject({ origin: "EDB", destination: "MAN", operator: "TP", time: "06:12", durationMin: 194, callingPoints: ["CAR", "LAN", "PRE", "WGN"] });
    expect(back[0]).toMatchObject({ origin: "MAN", destination: "EDB", callingPoints: ["WGN", "PRE", "LAN", "CAR"] });
    expect(there[0]!.arriveAt).toBe("2026-11-21T09:26:00Z");
  });

  it("starts later on a Sunday, and keeps London time across the summer clock change", () => {
    const [{ route }] = findRoutes("EDB", "MAN");
    expect(servicesOn(route, false, "2026-11-22")[0]?.time).toBe("09:12");
    const summer = servicesOn(route, false, "2026-07-01")[0]!;
    expect(summer.time).toBe("06:12");
    expect(summer.departAt).toBe("2026-07-01T05:12:00Z");
    expect(utcToLondon(summer.departAt).time).toBe("06:12");
  });

  it("only runs a pattern in its listed hours", () => {
    const [{ route }] = findRoutes("KGX", "EDB");
    expect(servicesOn(route, false, "2026-11-20").map((s) => s.time)).toEqual(["06:00", "07:30", "08:00", "09:30", "10:00", "11:30", "12:00", "13:30", "14:00", "15:30", "16:00", "17:30", "18:00"]);
  });

  it("parses journey ids", () => {
    expect(parseJourneyId("EDB-MAN-2026-11-21T06:12:00Z")).toEqual({ origin: "EDB", destination: "MAN", departAt: "2026-11-21T06:12:00Z" });
    expect(parseJourneyId("nope")).toBeNull();
    expect(parseJourneyId("EDB-MAN-2026-11-21T06:12:00.000Z")).toBeNull();
  });
});
