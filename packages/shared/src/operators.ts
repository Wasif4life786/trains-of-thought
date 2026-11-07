/** Train operators by ATOC code (contract.md §4.1). Data uses the code; the UI shows the name. */
export const OPERATORS: Record<string, string> = {
  AW: "Transport for Wales",
  CC: "c2c",
  CH: "Chiltern Railways",
  CS: "Caledonian Sleeper",
  EM: "East Midlands Railway",
  GC: "Grand Central",
  GN: "Great Northern",
  GR: "LNER",
  GW: "Great Western Railway",
  GX: "Gatwick Express",
  HT: "Hull Trains",
  HX: "Heathrow Express",
  IL: "Island Line",
  LD: "Lumo",
  LE: "Greater Anglia",
  LM: "West Midlands Railway",
  LO: "London Overground",
  ME: "Merseyrail",
  NT: "Northern",
  SE: "Southeastern",
  SN: "Southern",
  SR: "ScotRail",
  SW: "South Western Railway",
  TL: "Thameslink",
  TP: "TransPennine Express",
  VT: "Avanti West Coast",
  XC: "CrossCountry",
  XR: "Elizabeth line",
};

export function operatorName(code: string): string {
  return OPERATORS[code] ?? code;
}
