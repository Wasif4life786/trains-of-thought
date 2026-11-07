import { describe, expect, it } from "vitest";
import {
  addDays,
  datesBetween,
  daysBetween,
  formatPence,
  isOffline,
  londonToUtc,
  parsePounds,
  parseRecommendationQuery,
  parseSignalQuery,
  toIsoUtc,
  toSearchParams,
  utcToLondon,
} from "../src/index";

describe("time", () => {
  it("converts London wall clock to UTC in winter (GMT) and summer (BST)", () => {
    expect(londonToUtc("2026-11-21", "15:00")).toBe("2026-11-21T15:00:00Z");
    expect(londonToUtc("2026-07-01", "09:00")).toBe("2026-07-01T08:00:00Z");
  });

  it("converts UTC to London parts, weekday 1 = Monday", () => {
    expect(utcToLondon("2026-07-01T08:00:00Z")).toEqual({ date: "2026-07-01", time: "09:00", hour: 9, minute: 0, weekday: 3 });
    expect(utcToLondon("2026-11-21T15:00:00Z").weekday).toBe(6);
  });

  it("handles the night the clocks go back (25 Oct 2026)", () => {
    expect(utcToLondon("2026-10-25T00:30:00Z").time).toBe("01:30");
    expect(utcToLondon("2026-10-25T01:30:00Z").time).toBe("01:30");
    expect(utcToLondon("2026-10-24T23:30:00Z").date).toBe("2026-10-25");
  });

  it("does date arithmetic on London dates", () => {
    expect(datesBetween("2026-11-20", "2026-11-22")).toEqual(["2026-11-20", "2026-11-21", "2026-11-22"]);
    expect(daysBetween("2026-11-07", "2026-11-21")).toBe(14);
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
  });

  it("keeps second precision", () => {
    expect(toIsoUtc(new Date("2026-11-21T15:00:00.123Z"))).toBe("2026-11-21T15:00:00Z");
  });
});

describe("money", () => {
  it("formats pence with integer maths", () => {
    expect(formatPence(3450)).toBe("£34.50");
    expect(formatPence(5)).toBe("£0.05");
    expect(formatPence(123456)).toBe("£1,234.56");
  });

  it("parses messy fare text into pence", () => {
    expect(parsePounds("£34.50")).toBe(3450);
    expect(parsePounds(" 34.5 ")).toBe(3450);
    expect(parsePounds("£1,234")).toBe(123400);
    expect(parsePounds(12.3)).toBe(1230);
    expect(parsePounds("about a tenner")).toBeNull();
  });
});

describe("HTTP params", () => {
  it("fills defaults and upper-cases station codes", () => {
    expect(parseRecommendationQuery(new URLSearchParams("origin=eus&destination=man&dateFrom=2026-11-20"))).toEqual({
      origin: "EUS",
      destination: "MAN",
      dateFrom: "2026-11-20",
      dateTo: "2026-11-20",
      earliest: "06:00",
      latest: "22:00",
      priority: 0.5,
    });
  });

  it("rejects backwards or over-long ranges and junk priorities", () => {
    const base = { origin: "EUS", destination: "MAN", dateFrom: "2026-11-20" };
    expect(() => parseRecommendationQuery({ ...base, dateTo: "2026-11-19" })).toThrow();
    expect(() => parseRecommendationQuery({ ...base, dateTo: "2026-12-20" })).toThrow();
    expect(() => parseRecommendationQuery({ ...base, priority: "lots" })).toThrow();
  });

  it("round-trips signal queries", () => {
    const q = { from: "2026-11-20T00:00:00Z", to: "2026-11-22T23:59:59Z", stations: ["EUS", "MAN"], kinds: ["football" as const] };
    expect(parseSignalQuery(toSearchParams(q))).toEqual(q);
  });
});

describe("env", () => {
  it("is offline under Vitest, so tests never hit the network", () => {
    expect(isOffline()).toBe(true);
  });
});
