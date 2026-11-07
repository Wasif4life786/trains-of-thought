import { utcToLondon } from "@tot/shared";

// Trainline's results page needs ITS station ids ("<CRS><number>gb"); a bare CRS code opens the page with no route.
// Looked up on 2026-11-07 from Trainline's station search:
//   GET https://www.thetrainline.com/api/locations-search/v2/search?searchTerm=<name>&locale=en-GB
//   → searchLocations[].code = "urn:trainline:generic:loc:<id>"
// Stations missing here open Trainline's home page instead (add them by the same lookup).
const TRAINLINE_IDS: Record<string, string> = {
  BHI: "BHI1215gb",
  BHM: "BHM1127gb",
  BRI: "BRI3231gb",
  BTH: "BTH3271gb",
  COV: "COV1030gb",
  CRE: "CRE1243gb",
  DAR: "DAR7877gb",
  DON: "DON6417gb",
  EDB: "EDB9328gb",
  EUS: "EUS1444gb",
  KGX: "KGX6121gb",
  LDS: "LDS8487gb",
  LIV: "LIV2246gb",
  MAC: "MAC2871gb",
  MAN: "MAN2968gb",
  MCV: "MCV2970gb",
  MKC: "MKC1378gb",
  NCL: "NCL7728gb",
  NMP: "NMP1069gb",
  PAD: "PAD3087gb",
  PBO: "PBO6133gb",
  RDG: "RDG3149gb",
  RUG: "RUG1087gb",
  SOT: "SOT1314gb",
  SPT: "SPT2771gb",
  STA: "STA1268gb",
  SWI: "SWI3333gb",
  WFJ: "WFJ1402gb",
  WKF: "WKF8591gb",
  WML: "WML2774gb",
  YRK: "YRK8263gb",
};

export interface BookingLink {
  url: string;
  /** false: Trainline opens without the route filled in. */
  prefilled: boolean;
}

interface Leg {
  origin: string;
  destination: string;
  departAt: string;
}

const HOME: BookingLink = { url: "https://www.thetrainline.com/", prefilled: false };

/** London wall-clock "2026-11-21T09:00:00" for an instant. */
function londonStamp(iso: string): string {
  const { date, time } = utcToLondon(iso);
  return `${date}T${time}:00`;
}

/** Stamps are London wall-clock times like "2026-11-21T09:00:00". */
function search(type: "single" | "return", origin: string, destination: string, outwardStamp: string, inwardStamp?: string): BookingLink {
  const from = TRAINLINE_IDS[origin];
  const to = TRAINLINE_IDS[destination];
  if (!from || !to) return HOME;

  const params = new URLSearchParams({
    journeySearchType: type,
    origin: `urn:trainline:generic:loc:${from}`,
    destination: `urn:trainline:generic:loc:${to}`,
    outwardDate: outwardStamp,
    outwardDateType: "departAfter",
  });
  if (inwardStamp) {
    params.set("inwardDate", inwardStamp);
    params.set("inwardDateType", "departAfter");
  }
  return { url: `https://www.thetrainline.com/book/results?${params}`, prefilled: true };
}

/** Trainline results for trains on this route at or after the journey's departure, London time. */
export const trainlineLink = (journey: Leg): BookingLink => search("single", journey.origin, journey.destination, londonStamp(journey.departAt));

/** Trainline results for a return: the outward leg and the way back, each from its own departure time. */
export const trainlineReturnLink = (outward: Leg, inward: Leg): BookingLink =>
  search("return", outward.origin, outward.destination, londonStamp(outward.departAt), londonStamp(inward.departAt));

export interface RouteSearch {
  origin: string;
  destination: string;
  /** London date "2026-11-21" and time "06:00" to search from. */
  date: string;
  time: string;
}

/** A Trainline search for a route we have no train data for: no specific train, just the stations and when you want to go. */
export const trainlineRouteLink = (outward: RouteSearch, back?: { date: string; time: string }): BookingLink =>
  search(back ? "return" : "single", outward.origin, outward.destination, `${outward.date}T${outward.time}:00`, back && `${back.date}T${back.time}:00`);
