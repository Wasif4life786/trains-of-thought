import { describe, expect, it } from "vitest";
import { trainlineLink, trainlineReturnLink, trainlineRouteLink } from "./trainline";

describe("trainlineLink", () => {
  it("fills in Trainline's station ids and the London departure time", () => {
    const link = trainlineLink({ origin: "EUS", destination: "MAN", departAt: "2026-11-21T09:00:00Z" });
    const params = new URL(link.url).searchParams;
    expect(link.prefilled).toBe(true);
    expect(new URL(link.url).pathname).toBe("/book/results");
    expect(params.get("origin")).toBe("urn:trainline:generic:loc:EUS1444gb");
    expect(params.get("destination")).toBe("urn:trainline:generic:loc:MAN2968gb");
    expect(params.get("outwardDate")).toBe("2026-11-21T09:00:00");
    expect(params.get("outwardDateType")).toBe("departAfter");
  });

  it("converts to London time in summer (BST)", () => {
    const link = trainlineLink({ origin: "EUS", destination: "MAN", departAt: "2026-07-01T08:00:00Z" });
    expect(new URL(link.url).searchParams.get("outwardDate")).toBe("2026-07-01T09:00:00");
  });

  it("builds a return search from the outward and inward legs", () => {
    const outward = { origin: "EUS", destination: "MAN", departAt: "2026-11-21T09:00:00Z" };
    const inward = { origin: "MAN", destination: "EUS", departAt: "2026-11-22T16:20:00Z" };
    const params = new URL(trainlineReturnLink(outward, inward).url).searchParams;
    expect(params.get("journeySearchType")).toBe("return");
    expect(params.get("origin")).toBe("urn:trainline:generic:loc:EUS1444gb");
    expect(params.get("destination")).toBe("urn:trainline:generic:loc:MAN2968gb");
    expect(params.get("outwardDate")).toBe("2026-11-21T09:00:00");
    expect(params.get("inwardDate")).toBe("2026-11-22T16:20:00");
    expect(params.get("inwardDateType")).toBe("departAfter");
  });

  it("searches a route we have no trains for (Edinburgh → Manchester), one way and return", () => {
    const single = new URL(trainlineRouteLink({ origin: "EDB", destination: "MAN", date: "2026-11-20", time: "06:00" }).url).searchParams;
    expect(single.get("journeySearchType")).toBe("single");
    expect(single.get("origin")).toBe("urn:trainline:generic:loc:EDB9328gb");
    expect(single.get("destination")).toBe("urn:trainline:generic:loc:MAN2968gb");
    expect(single.get("outwardDate")).toBe("2026-11-20T06:00:00");

    const both = new URL(trainlineRouteLink({ origin: "EDB", destination: "MAN", date: "2026-11-20", time: "06:00" }, { date: "2026-11-22", time: "06:00" }).url).searchParams;
    expect(both.get("journeySearchType")).toBe("return");
    expect(both.get("inwardDate")).toBe("2026-11-22T06:00:00");
  });

  it("falls back to Trainline's home page for stations it has no id for", () => {
    expect(trainlineLink({ origin: "EUS", destination: "ZZZ", departAt: "2026-11-21T09:00:00Z" })).toEqual({ url: "https://www.thetrainline.com/", prefilled: false });
  });
});
