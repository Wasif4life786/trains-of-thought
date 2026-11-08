import { RAILCARD_IDS, TICKET_TYPES, type Fare, type RailcardId } from "./schemas";
import { utcToLondon } from "./time";

/**
 * Railcards (contract.md §5.2, v1.5.0): a third off every fare the card is valid for. Estimates only: minimum-fare rules
 * (e.g. 16-25 and 26-30 before 10:00 on weekdays), bank holidays and regional cards aren't modelled.
 */
export interface Railcard {
  id: RailcardId;
  name: string;
  /** Shown to people under the picker. */
  note: string;
  /** weekday: 1 = Monday … 7 = Sunday; time: London "HH:mm" of departure. */
  validAt: (weekday: number, time: string) => boolean;
}

const anyTime = () => true;
const notBeforeHalfNineOnWeekdays = (weekday: number, time: string) => weekday >= 6 || time >= "09:30";

export const RAILCARDS: readonly Railcard[] = [
  { id: "16-25", name: "16-25 Railcard", note: "A third off, any time.", validAt: anyTime },
  { id: "26-30", name: "26-30 Railcard", note: "A third off, any time.", validAt: anyTime },
  { id: "senior", name: "Senior Railcard", note: "A third off, but not on weekday trains before 09:30.", validAt: notBeforeHalfNineOnWeekdays },
  { id: "two-together", name: "Two Together Railcard", note: "A third off for two named people travelling together, but not on weekday trains before 09:30.", validAt: notBeforeHalfNineOnWeekdays },
  { id: "family-friends", name: "Family & Friends Railcard", note: "A third off adult fares, any time (children get 60% off).", validAt: anyTime },
  { id: "disabled", name: "Disabled Persons Railcard", note: "A third off, any time.", validAt: anyTime },
  { id: "veterans", name: "Veterans Railcard", note: "A third off, any time.", validAt: anyTime },
];

// Every id in the schema has rules, and every rule has an id in the schema.
if (RAILCARDS.length !== RAILCARD_IDS.length || RAILCARDS.some((c) => !RAILCARD_IDS.includes(c.id))) throw new Error("RAILCARDS and RAILCARD_IDS disagree");

/** A third off, as integer pence (2/3 of the price, rounded to the nearest penny). */
export const oneThirdOff = (pence: number): number => Math.floor((pence * 2 + 1) / 3);

/** The fares with the railcard applied when it's valid on this train; otherwise unchanged. Still cheapest first. */
export function discountFares(fares: Fare[], railcardId: RailcardId, departAt: string): Fare[] {
  const card = RAILCARDS.find((c) => c.id === railcardId);
  const { weekday, time } = utcToLondon(departAt);
  if (!card || !card.validAt(weekday, time)) return fares;
  const order = (f: Fare) => TICKET_TYPES.indexOf(f.ticketType);
  return fares.map((f) => ({ ...f, pricePence: oneThirdOff(f.pricePence) })).sort((a, b) => a.pricePence - b.pricePence || order(a) - order(b));
}
