import { describe, expect, it } from "vitest";
import { cleanStationName, loadStations } from "./stations";

describe("cleanStationName", () => {
  it("lowercases joiners inside hyphenated names", () => {
    expect(cleanStationName("Stoke-On-Trent")).toEqual({ name: "Stoke-on-Trent", fixes: ["name_case_normalised"] });
    expect(cleanStationName("Berwick-Upon-Tweed").name).toBe("Berwick-upon-Tweed");
    expect(cleanStationName("Ashton-Under-Lyne").name).toBe("Ashton-under-Lyne");
  });

  it("restores King's apostrophes, and leaves other names alone", () => {
    expect(cleanStationName("London Kings Cross")).toEqual({ name: "London King's Cross", fixes: ["apostrophe_restored"] });
    expect(cleanStationName("Kings Norton").name).toBe("King's Norton");
    expect(cleanStationName("Manchester Piccadilly")).toEqual({ name: "Manchester Piccadilly", fixes: [] });
  });

  it("trims stray whitespace", () => {
    expect(cleanStationName("  Leeds  ")).toEqual({ name: "Leeds", fixes: ["whitespace_trimmed"] });
  });
});

describe("the station index (real dataset)", () => {
  const stations = loadStations();

  it("loads every station and accounts for each row", () => {
    expect(stations.stations).toHaveLength(2609);
    const { rowsIn, rowsOut, dropped } = stations.quality;
    expect(rowsIn - rowsOut).toBe(Object.values(dropped).reduce((a, b) => a + b, 0));
    expect(stations.quality.fixed["name_case_normalised"]).toBeGreaterThan(20);
  });

  it("puts the station people mean first", () => {
    expect(stations.search("manc", 8)[0]?.crs).toBe("MAN");
    expect(stations.search("edin", 3)[0]?.crs).toBe("EDB");
    expect(stations.search("london", 3).map((s) => s.crs)).toEqual(["EUS", "KGX", "PAD"]);
    expect(stations.search("kings cross", 1)[0]?.crs).toBe("KGX");
    expect(stations.search("piccadilly", 1)[0]?.crs).toBe("MAN");
  });

  it("puts an exact CRS first, and ignores case, punctuation and empty queries", () => {
    expect(stations.search("eus", 5)[0]?.crs).toBe("EUS");
    expect(stations.search("  STOKE-on-trent ", 1)[0]?.crs).toBe("SOT");
    expect(stations.search("", 5)).toEqual([]);
    expect(stations.search("qqqqzzzz", 5)).toEqual([]);
  });

  it("looks stations up by exact name or alias", () => {
    expect(stations.findByName("London Euston")?.crs).toBe("EUS");
    expect(stations.findByName("manchester piccadilly")?.crs).toBe("MAN");
    expect(stations.findByName("Edinburgh Waverley")?.crs).toBe("EDB");
    expect(stations.findByName("Not A Station")).toBeUndefined();
  });
});
