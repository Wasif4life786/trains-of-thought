import { describe, expect, it } from "vitest";
import { advanceMultiplier, faresFor, loadFares, parseFares, type FareTable } from "./fares";
import { loadRoutes } from "./routes";

const EUS_MAN: FareTable = { anytime: 21400, offPeak: 10850, superOffPeak: 6720, advanceMin: 2400, advanceMax: 4400 };
const types = (fares: ReturnType<typeof faresFor>) => fares.map((f) => f.ticketType);

describe("parseFares", () => {
  it("cleans messy fare rows and accounts for every row", () => {
    const { tables, quality } = parseFares(
      [
        "route,fare,amount",
        "EUS-MAN,Anytime Single,£214.00",
        "eus–man,off peak,£ 108.5",
        "EUS-MAN,SUPER OFF-PEAK SINGLE,67.2",
        "EUS-MAN,Advance from,24",
        "EUS-MAN,Advance to,TBC",
        "EUS-MAN,Advance to,£44.00",
        "EUS-MAN,Anytime Return,£390.00",
        "EUS-MAN,Anytime Single,£214.00",
        "EUS-MAN,Advance min,",
        "",
        "Season Ticket,,",
      ].join("\n"),
    );
    expect(tables.get("EUS-MAN")).toEqual({ anytime: 21400, offPeak: 10850, superOffPeak: 6720, advanceMin: 2400, advanceMax: 4400 });
    expect(quality).toMatchObject({
      rowsIn: 11,
      rowsOut: 5,
      dropped: { unparseable_amount: 1, unsupported_ticket_type: 1, duplicate: 1, missing_amount: 1, unknown_route: 1, blank_row: 1 },
      fixed: { pounds_to_pence: 5, route_code_normalised: 1 },
    });
  });

  it("gives every modelled route a complete fare table", () => {
    const { tables } = loadFares();
    for (const r of loadRoutes()) expect(tables.has(r.id), r.id).toBe(true);
  });
});

describe("advance pricing", () => {
  it("steps up as travel nears and stops 2 days out", () => {
    expect([84, 56, 40, 20, 10, 3, 1].map(advanceMultiplier)).toEqual([1, 1, 1.25, 1.6, 2.2, 3, null]);
  });

  it("only gets dearer as the train approaches", () => {
    const id = "EUS-MAN-2026-11-21T09:00:00Z";
    const prices = [84, 70, 56, 40, 28, 20, 14, 10, 7, 3].flatMap((d) => faresFor(EUS_MAN, id, 6, "09:00", d).filter((f) => f.ticketType === "advance").map((f) => f.pricePence));
    expect(prices.length).toBeGreaterThan(5);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  it("isn't on sale more than 12 weeks out, nor within 2 days", () => {
    const id = "EUS-MAN-2026-11-21T09:00:00Z";
    expect(types(faresFor(EUS_MAN, id, 6, "09:00", 90))).not.toContain("advance");
    expect(types(faresFor(EUS_MAN, id, 6, "09:00", 1))).not.toContain("advance");
  });

  it("sells out the Friday getaway weeks ahead, but not earlier than that", () => {
    const id = "EUS-MAN-2026-11-20T16:20:00Z";
    expect(types(faresFor(EUS_MAN, id, 5, "16:20", 13))).not.toContain("advance");
    expect(types(faresFor(EUS_MAN, id, 5, "16:20", 40))).toContain("advance");
  });
});

describe("walk-up fares", () => {
  it("offers only Anytime on peak trains, and everything on a quiet weekend", () => {
    const id = "EUS-MAN-2026-11-20T16:20:00Z";
    expect(types(faresFor(EUS_MAN, id, 5, "16:20", 0))).toEqual(["anytime"]);
    expect(types(faresFor(EUS_MAN, "EUS-MAN-2026-11-21T11:00:00Z", 6, "11:00", 0))).toEqual(["super_off_peak", "off_peak", "anytime"]);
  });

  it("limits Super Off-Peak on weekday mornings and afternoons", () => {
    expect(types(faresFor(EUS_MAN, "x", 3, "09:40", 0))).toEqual(["off_peak", "anytime"]);
    expect(types(faresFor(EUS_MAN, "x", 3, "11:00", 0))).toContain("super_off_peak");
    expect(types(faresFor(EUS_MAN, "x", 3, "20:00", 0))).toContain("super_off_peak");
  });

  it("lists fares cheapest first", () => {
    const fares = faresFor(EUS_MAN, "EUS-MAN-2026-11-21T09:00:00Z", 6, "09:00", 30);
    expect(fares.map((f) => f.pricePence)).toEqual([...fares.map((f) => f.pricePence)].sort((a, b) => a - b));
    expect(fares.at(-1)?.ticketType).toBe("anytime");
  });
});
