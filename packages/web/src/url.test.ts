import { describe, expect, it } from "vitest";
import { DEFAULT_STATE, readState, writeState, type FormState } from "./url";

describe("URL state", () => {
  const state: FormState = {
    query: { origin: "EDB", destination: "MAN", dateFrom: "2026-11-21", dateTo: "2026-11-22", earliest: "07:00", latest: "20:00", priority: 0.8 },
    trip: "return",
    returnDates: { from: "2026-11-23", to: "2026-11-24" },
    railcard: "16-25",
  };

  it("round-trips a search, with the API's own parameter names", () => {
    const search = writeState(state);
    expect(search).toContain("origin=EDB&destination=MAN&dateFrom=2026-11-21");
    expect(readState(search)).toEqual(state);
  });

  it("leaves out what doesn't apply: one-way trips have no return dates, and no railcard means no parameter", () => {
    const search = writeState({ ...state, trip: "single", railcard: "" });
    expect(search).not.toMatch(/trip|returnFrom|returnTo|railcard/);
    expect(readState(search)).toMatchObject({ trip: "single", railcard: "" });
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
      earliest: "06:00",
      latest: "22:00",
      priority: 0.5,
    });
  });

  it("ignores return dates that are malformed or backwards", () => {
    expect(readState("?trip=return&returnFrom=2026-11-24&returnTo=2026-11-23").returnDates).toEqual(DEFAULT_STATE.returnDates);
    expect(readState("?trip=return&returnFrom=soon&returnTo=later").returnDates).toEqual(DEFAULT_STATE.returnDates);
  });
});
