/**
 * Yorro Reisebüro — Slot-Ledger und Suchbrief.
 * Struktur, kein Wortlaut.
 */

export type ReiseMode =
  | 'unknown'
  | 'fly'
  | 'drive'
  | 'train'
  | 'bike'
  | 'hike'
  | 'daytrip'
  | 'camping'
  | 'mix';

export type SlotSource = 'user' | 'profile' | 'default' | 'inferred';
export type SlotHardness = 'must' | 'wish' | 'optional' | 'inferred';

export type EnergyKind = 'chill_pool' | 'active_out' | 'mixed' | null;
export type LocationBias = 'quiet_outskirts' | 'cheap_central' | 'near_activity' | null;
export type LodgingQuality = 'nicer_base' | 'cheap_box' | null;
export type LodgingKind = 'hostel' | 'airbnb' | 'hotel' | 'apartment' | 'ferienhaus' | null;
export type BudgetVibe = 'cheap' | 'mid' | 'flex' | null;
export type BudgetScope = 'total' | 'per_person';
export type BudgetIncludes = 'stay' | 'stay_transport' | 'all';

export type LedgerEntry<T> = {
  value: T;
  source: SlotSource;
  hardness: SlotHardness;
};

export type MustHaveId =
  | 'pool'
  | 'sand'
  | 'padel'
  | 'paddle'
  | 'spikeball'
  | 'sea'
  | 'view'
  | 'no_carpet'
  | 'ferienhaus'
  | 'apartment'
  | 'hotel'
  | 'camping'
  | 'party'
  | 'vegan'
  | 'grill'
  | 'boat'
  | 'rental_car'
  | 'warm'
  | 'spa'
  | 'sauna'
  | 'massage'
  | 'tennis'
  | 'wine'
  | 'cruise'
  | 'kids_club'
  | 'adult_only'
  | 'riding'
  | 'parking'
  | 'baby_bed'
  | 'breakfast'
  | 'half_board'
  | 'quiet'
  | 'short_transfer'
  | 'small_hotel';

export type TravelerChip = {
  name: string;
  canDrive: boolean | null;
};

export type ReiseLedger = {
  mode: LedgerEntry<ReiseMode> | null;
  /** Zweite Wahl, z. B. Bahn lieber, sonst Auto. */
  modeFallback: LedgerEntry<ReiseMode> | null;
  originCity: LedgerEntry<string> | null;
  originLat: LedgerEntry<number> | null;
  originLng: LedgerEntry<number> | null;
  airportIata: LedgerEntry<string> | null;
  destinationHint: LedgerEntry<string> | null;
  corridor: LedgerEntry<string> | null;
  dateStart: LedgerEntry<string> | null;
  dateEnd: LedgerEntry<string> | null;
  dateFlex: LedgerEntry<'exact' | 'weekend' | 'month' | 'open'> | null;
  /** YYYY-MM — Monat ohne Fake-Tag, z. B. Wochenende im September. */
  dateMonth: LedgerEntry<string> | null;
  datePart: LedgerEntry<'early' | 'mid' | 'late'> | null;
  stayDays: LedgerEntry<number> | null;
  stayNights: LedgerEntry<number> | null;
  adults: LedgerEntry<number> | null;
  children: LedgerEntry<number> | null;
  bedrooms: LedgerEntry<number> | null;
  beds: LedgerEntry<number> | null;
  budgetEur: LedgerEntry<number> | null;
  budgetScope: LedgerEntry<BudgetScope> | null;
  budgetIncludes: LedgerEntry<BudgetIncludes> | null;
  purpose: LedgerEntry<string> | null;
  energy: LedgerEntry<EnergyKind> | null;
  locationBias: LedgerEntry<LocationBias> | null;
  lodgingQuality: LedgerEntry<LodgingQuality> | null;
  lodgingKind: LedgerEntry<LodgingKind> | null;
  /** Typ egal — Hotel oder Apartment, Hauptsache Rest passt. */
  lodgingOpen: LedgerEntry<boolean> | null;
  /** Zweite Wahl, z. B. Apartment lieber, Hotel geht auch. */
  lodgingFallback: LedgerEntry<LodgingKind> | null;
  budgetVibe: LedgerEntry<BudgetVibe> | null;
  inspiration: LedgerEntry<string> | null;
  maxDriveHours: LedgerEntry<number> | null;
  /** Ab wann Los (Stunde 0–23), z. B. 16 nach der Arbeit. */
  departAfterHour: LedgerEntry<number> | null;
  /** Späteste Ankunft (Stunde 0–23), z. B. 20 noch was in der Stadt. */
  arriveBeforeHour: LedgerEntry<number> | null;
  directFlight: LedgerEntry<boolean> | null;
  ownBikes: LedgerEntry<boolean> | null;
  openJaw: LedgerEntry<boolean> | null;
  driverName: LedgerEntry<string> | null;
  mustHaves: LedgerEntry<MustHaveId[]> | null;
  wishHaves: LedgerEntry<MustHaveId[]> | null;
  /** Optional — weiß aufs Board, kein Muss. */
  niceHaves: LedgerEntry<MustHaveId[]> | null;
  /** Harte Absagen — rot aufs Board, unten. */
  hardNos: LedgerEntry<MustHaveId[]> | null;
  lastHighlight: LedgerEntry<string> | null;
  highlightWant: LedgerEntry<string> | null;
  dealbreaker: LedgerEntry<string> | null;
  extraWishes: LedgerEntry<string> | null;
  /** Wie gefeiert wird — Clubs, Bars, Live-Musik… */
  partyStyle: LedgerEntry<string> | null;
  /** Spa-Korn: Pool, Meer, Massage, Sauna, Adult-only… */
  spaStyle: LedgerEntry<string> | null;
  /** Kinder-Setup: Kids-Club, Familienhotel, was die Kinder mögen. */
  kidsStyle: LedgerEntry<string> | null;
  /** Ein Hub, Hopping, Roadtrip, Kreuzfahrt, Tour. */
  tripShape: LedgerEntry<'stay' | 'hop' | 'cruise' | 'tour' | 'roadtrip'> | null;
  /** Eine vorgeschlagene Idee, die der User angenommen oder abgelehnt hat. */
  ideaHook: LedgerEntry<string> | null;
  rentalCar: LedgerEntry<boolean> | null;
  weatherWant: LedgerEntry<'warm' | 'mild' | 'cool' | 'egal'> | null;
  meals: LedgerEntry<'self' | 'breakfast' | 'half' | 'all'> | null;
  travelers: LedgerEntry<TravelerChip[]> | null;
  recapDone: LedgerEntry<boolean> | null;
};

export type ChatTurn = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  atMs: number;
};

export type StoryStop = {
  id: string;
  title: string;
  why: string;
  lat?: number;
  lng?: number;
  photoUrl?: string | null;
  kind: 'origin' | 'transfer' | 'stay' | 'poi';
};

export type FactThumb = {
  id: string;
  emoji: string;
  label: string;
  met: boolean;
};

export type ReiseOption = {
  id: string;
  title: string;
  placeName: string;
  lat: number;
  lng: number;
  totalEur: number | null;
  budgetDeltaEur: number | null;
  pricePerPerson: number | null;
  priceIncludes: string | null;
  restBudgetEur: number | null;
  restBudgetHint: string | null;
  matchScore: number;
  whyBlurb: string;
  facts: FactThumb[];
  whyMatch: [string, string] | [string];
  gaps: string[];
  photoUrl: string | null;
  stayName?: string | null;
  stayBookUrl?: string | null;
  stayPriceEur?: number | null;
  flightBookUrl?: string | null;
  flightPriceEur?: number | null;
  carBookUrl?: string | null;
  stops: StoryStop[];
};

export type FunnelLogLine = {
  stage: string;
  detail: string;
};

export type ReiseTrip = {
  id: string;
  name: string;
  createdAtMs: number;
  updatedAtMs: number;
  ledger: ReiseLedger;
  askedSlotKeys: string[];
  frozen: boolean;
  refineCount: number;
  /** Erste Funnel-Auswahl hat Pro verbraucht — Korrekturen = Lite. */
  initialProSearchDone: boolean;
  chat: ChatTurn[];
  options: ReiseOption[];
  funnelLog: FunnelLogLine[];
  searching: boolean;
  searchError: string | null;
  selectedOptionId: string | null;
  questionHint: string;
};

export const EMPTY_LEDGER: ReiseLedger = {
  mode: null,
  modeFallback: null,
  originCity: null,
  originLat: null,
  originLng: null,
  airportIata: null,
  destinationHint: null,
  corridor: null,
  dateStart: null,
  dateEnd: null,
  dateFlex: null,
  dateMonth: null,
  datePart: null,
  stayDays: null,
  stayNights: null,
  adults: null,
  children: null,
  bedrooms: null,
  beds: null,
  budgetEur: null,
  budgetScope: null,
  budgetIncludes: null,
  purpose: null,
  energy: null,
  locationBias: null,
  lodgingQuality: null,
  lodgingKind: null,
  lodgingOpen: null,
  lodgingFallback: null,
  budgetVibe: null,
  inspiration: null,
  maxDriveHours: null,
  departAfterHour: null,
  arriveBeforeHour: null,
  directFlight: null,
  ownBikes: null,
  openJaw: null,
  driverName: null,
  mustHaves: null,
  wishHaves: null,
  niceHaves: null,
  hardNos: null,
  lastHighlight: null,
  highlightWant: null,
  dealbreaker: null,
  extraWishes: null,
  partyStyle: null,
  spaStyle: null,
  kidsStyle: null,
  tripShape: null,
  ideaHook: null,
  rentalCar: null,
  weatherWant: null,
  meals: null,
  travelers: null,
  recapDone: null,
};
