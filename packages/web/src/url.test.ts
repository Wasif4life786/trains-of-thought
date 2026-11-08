import { describe, expect, it } from "vitest";
import { DEFAULT_STATE, networkQuery, readState, writeState, type FormState } from "./url";

describe("URL state", () => {
  const state: FormState = {
    view: "network",
    query: { origin: "EDB", destination: "MAN", dateFrom: "2026-11-21", dateTo: "2026-11-22", earliest: "07:00", latest: "20:00" },
  };

  it("round-trips a view, with the API's own parameter names", () => {
    const search = writeState(state);
    expect(search).toContain("origin=EDB&destination=MAN&dateFrom=2026-11-21");
    expect(readState(search)).toEqual(state);
  });

  it("leaves the view out for the default route board, and keeps the data-inputs view", () => {
    expect(writeState({ ...state, view: "route" })).not.toMatch(/view=/);
    expect(readState(writeState({ ...state, view: "inputs" })).view).toBe("inputs");
    expect(readState("?view=bogus").view).toBe("route");
  });

  it("falls back to the defaults for an empty or broken link instead of failing", () => {
    expect(readState("")).toEqual(DEFAULT_STATE);
    expect(readState("?origin=nope&destination=MAN&dateFrom=tomorrow")).toEqual(DEFAULT_STATE);
    expect(readState("?origin=EUS&destination=MAN")).toEqual(DEFAULT_STATE);
  });

  it("fills in the same defaults as the API for a short link, and upper-cases stations", () => {
    expect(readState("?origin=edb&destination=man&dateFrom=2026-11-21").query).toEqual({
      origin: "EDB",
      destination: "MAN",
      dateFrom: "2026-11-21",
      dateTo: "2026-11-21",
      earliest: "05:00",
      latest: "23:30",
    });
  });

  it("caps the network view at 7 days", () => {
    expect(networkQuery({ ...state.query, dateFrom: "2026-11-20", dateTo: "2026-12-01" })).toEqual({ dateFrom: "2026-11-20", dateTo: "2026-11-26" });
    expect(networkQuery(state.query)).toEqual({ dateFrom: "2026-11-21", dateTo: "2026-11-22" });
  });
});
