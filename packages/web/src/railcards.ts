import { utcToLondon, type Fare, type JourneyOption, type TicketType } from "@tot/shared";

// Display-only estimates, applied on top of the fares the API returns: a third off every fare the card is valid for.
// Not modelled: minimum-fare rules (e.g. 16-25 and 26-30 before 10:00 on weekdays), bank holidays, regional cards.

export interface Railcard {
  id: string;
  name: string;
  /** Shown to the user under the picker. */
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
  {
    id: "two-together",
    name: "Two Together Railcard",
    note: "A third off for two named people travelling together, but not on weekday trains before 09:30.",
    validAt: notBeforeHalfNineOnWeekdays,
  },
  { id: "family-friends", name: "Family & Friends Railcard", note: "A third off adult fares, any time (children get 60% off).", validAt: anyTime },
  { id: "disabled", name: "Disabled Persons Railcard", note: "A third off, any time.", validAt: anyTime },
  { id: "veterans", name: "Veterans Railcard", note: "A third off, any time.", validAt: anyTime },
];

export interface PricedFare {
  /** What to show and sort by: the railcard price when it applies, else the normal price. */
  pricePence: number;
  ticketType: TicketType;
  /** The cheapest normal fare, before any railcard. */
  fullPence: number;
  /** A railcard discount was applied. */
  applied: boolean;
  /** A railcard is selected but isn't valid on this train. */
  blocked: boolean;
}

/** A third off, as integer pence (2/3 of the price, rounded to the nearest penny). */
export const oneThirdOff = (pence: number) => Math.floor((pence * 2 + 1) / 3);

const cheapest = (fares: Fare[]) => fares.reduce((a, b) => (b.pricePence < a.pricePence ? b : a));

/** The cheapest fare for a journey, with the railcard's discount when it's valid on that train. */
export function priceWithRailcard(journey: JourneyOption, card: Railcard | null): PricedFare {
  const normal = cheapest(journey.fares);
  const base = { pricePence: normal.pricePence, ticketType: normal.ticketType, fullPence: normal.pricePence };
  if (!card) return { ...base, applied: false, blocked: false };

  const { weekday, time } = utcToLondon(journey.departAt);
  if (!card.validAt(weekday, time)) return { ...base, applied: false, blocked: true };

  const discounted = cheapest(journey.fares.map((f) => ({ ...f, pricePence: oneThirdOff(f.pricePence) })));
  return { ...base, pricePence: discounted.pricePence, ticketType: discounted.ticketType, applied: true, blocked: false };
}
