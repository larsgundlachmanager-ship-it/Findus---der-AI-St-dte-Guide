/**
 * Yorros Reisebüro — Slot-Ledger und Suchbrief.
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

export type SlotSource = 'user' | 'profile' | 'shelf' | 'default' | 'inferred';
export type SlotHardness = 'must' | 'wish' | 'optional' | 'inferred';

export type EnergyKind = 'chill_pool' | 'active_out' | 'mixed' | null;
export type LocationBias = 'quiet_outskirts' | 'cheap_central' | 'near_activity' | null;
export type LodgingQuality = 'nicer_base' | 'cheap_box' | null;
export type LodgingKind = 'hostel' | 'airbnb' | 'hotel' | 'apartment' | 'ferienhaus' | null;
export type BudgetVibe = 'cheap' | 'mid' | 'flex' | null;
export type BudgetScope = 'total' | 'per_person';
export type BudgetIncludes = 'stay' | 'stay_transport' | 'all';
/** Feiern: privat unter sich / Bars / Clubs / egal. */
export type PartyGrain = 'private_house' | 'bars' | 'clubs' | 'egal';
export type ReisePhase =
  | 'briefing'
  | 'recap'
  | 'research'
  | 'results'
  | 'detail'
  | 'verify';

export type DecisionNote = {
  id: string;
  atMs: number;
  topic: string;
  detail: string;
};

export type ResearchStep = {
  id: string;
  stage: string;
  title: string;
  detail: string;
  status: 'pending' | 'active' | 'done' | 'pivot';
  emoji?: string;
};

/** Live-Chips während Recherche — Orte, Flüge, Deals, Vergleich. */
export type ResearchSpark = {
  id: string;
  kind: 'place' | 'flight' | 'stay' | 'deal' | 'compare' | 'vibe';
  emoji: string;
  label: string;
  sub?: string;
  atMs: number;
  /** Optional: Pin auf dem Akt-3-Screensaver. */
  lat?: number | null;
  lng?: number | null;
  photoUrl?: string | null;
};

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
  | 'ferry'
  | 'kids_club'
  | 'adult_only'
  | 'riding'
  | 'parking'
  | 'baby_bed'
  | 'breakfast'
  | 'half_board'
  | 'quiet'
  | 'short_transfer'
  | 'small_hotel'
  | 'water_slide'
  | 'paddle_board'
  | 'culinary'
  | 'river_cruise'
  | 'running_track'
  | 'teens_club'
  | 'seniors';

/** Kreuzfahrt: Kabinenklasse. */
export type CruiseCabinClass = 'inside' | 'oceanview' | 'balcony' | 'suite';
/** Tarif-Bundle abstrakt (Reederei-Labels nur aus Beleg). */
export type CruiseFareBundle = 'basic' | 'drinks' | 'premium_ai' | 'flex_cabin_choice';
/** Seetage vs. viele Häfen. */
export type CruiseSeaDaysBias = 'many_sea' | 'many_ports' | 'balanced';
/** Start-Hafen-Logik. */
export type CruiseEmbarkBias = 'near_home' | 'named_port' | 'cheapest_anywhere';

export type TravelerChip = {
  name: string;
  canDrive: boolean | null;
};

export type ReiseLedger = {
  mode: LedgerEntry<ReiseMode> | null;
  /** Zweite Wahl, z. B. Bahn lieber, sonst Auto. */
  modeFallback: LedgerEntry<ReiseMode> | null;
  originCity: LedgerEntry<string> | null;
  /** Mehrere mögliche Starts (Hamburg, Bremen, Berlin…). */
  originCities: LedgerEntry<string[]> | null;
  originLat: LedgerEntry<number> | null;
  originLng: LedgerEntry<number> | null;
  airportIata: LedgerEntry<string> | null;
  destinationHint: LedgerEntry<string> | null;
  corridor: LedgerEntry<string> | null;
  dateStart: LedgerEntry<string> | null;
  dateEnd: LedgerEntry<string> | null;
  dateFlex: LedgerEntry<'exact' | 'weekend' | 'month' | 'open'> | null;
  /**
   * Was das feste Datum bedeutet:
   * arrive = Anreise / los am …
   * depart = Abreise muss (Termin), oft davor flexibel
   * span = fester Zeitraum Start–Ende
   * presence = muss an diesen Tagen vor Ort sein (An-/Abreise darf drumherum flexen)
   */
  dateAnchor: LedgerEntry<'arrive' | 'depart' | 'span' | 'presence'> | null;
  /** YYYY-MM — Monat ohne Fake-Tag, z. B. Wochenende im September. */
  dateMonth: LedgerEntry<string> | null;
  datePart: LedgerEntry<'early' | 'mid' | 'late'> | null;
  stayDays: LedgerEntry<number> | null;
  stayNights: LedgerEntry<number> | null;
  /** Obere Grenze bei Spanne („3 bis 6 Nächte“) — stayNights = Minimum. */
  stayNightsMax: LedgerEntry<number> | null;
  adults: LedgerEntry<number> | null;
  children: LedgerEntry<number> | null;
  /** Kind unter 1 Jahr (Kiwi infants). */
  infants: LedgerEntry<number> | null;
  /** Handgepaeck gesamt (Kiwi cabin). */
  cabinBags: LedgerEntry<number> | null;
  /** Aufgabegepaeck gesamt (Kiwi checked). */
  checkedBags: LedgerEntry<number> | null;
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
  /** Max. Zwischenstopp in Stunden (kurze Umstiege, Default-Filter ~5). */
  maxLayoverHours: LedgerEntry<number> | null;
  /**
   * Explizit: langer Stopp als Stadt-Break (Stunden, typ. ≥16).
   * Ohne das Feld keine 8–30-h-Hänger suchen.
   */
  longLayoverExploreHours: LedgerEntry<number> | null;
  /** Explizit: Nachtflug ok, um eine Hotel-Nacht zu sparen. */
  overnightFlightOk: LedgerEntry<boolean> | null;
  /** Max. Umstiege (0 = nur Direkt, 1 = ein Stopp ok). Soft neben Direkt-Präferenz. */
  maxFlightStops: LedgerEntry<number> | null;
  /** Soft: günstige Getränke/Bier — kein Hard-No auf Nightlife. */
  cheapDrinks: LedgerEntry<boolean> | null;
  /** Soft: wie gefeiert wird. */
  partyGrain: LedgerEntry<PartyGrain> | null;
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
  /** Ein Hub, Hopping, Roadtrip, Kreuzfahrt, Fähre, Tour. */
  tripShape: LedgerEntry<'stay' | 'hop' | 'cruise' | 'ferry' | 'tour' | 'roadtrip'> | null;
  /** Kreuzfahrt: Start-Bias (Heimat-Häfen / genannter Hafen / günstigst). */
  cruiseEmbarkBias: LedgerEntry<CruiseEmbarkBias> | null;
  /** Genannter Einschiffhafen (wenn named_port). */
  cruiseEmbarkPort: LedgerEntry<string> | null;
  cruiseCabinClass: LedgerEntry<CruiseCabinClass> | null;
  cruiseFareBundle: LedgerEntry<CruiseFareBundle> | null;
  cruiseSeaDaysBias: LedgerEntry<CruiseSeaDaysBias> | null;
  /** Flusskreuzfahrt vs. Hochsee. */
  cruiseKind: LedgerEntry<'ocean' | 'river'> | null;
  /**
   * Konkretes Schiff (z. B. „Mein Schiff 7“, „AIDAnova“) —
   * 3 und 7 sind unterschiedliche Angebote.
   */
  cruiseShipName: LedgerEntry<string> | null;
  /** Reederei-Präferenz soft: aida | mein_schiff | open. */
  cruiseLinePref: LedgerEntry<'aida' | 'mein_schiff' | 'open'> | null;
  /** Eine vorgeschlagene Idee, die der User angenommen oder abgelehnt hat. */
  ideaHook: LedgerEntry<string> | null;
  rentalCar: LedgerEntry<boolean> | null;
  weatherWant: LedgerEntry<'warm' | 'mild' | 'cool' | 'egal'> | null;
  meals: LedgerEntry<'self' | 'breakfast' | 'half' | 'all'> | null;
  travelers: LedgerEntry<TravelerChip[]> | null;
  recapDone: LedgerEntry<boolean> | null;
  /** Schon gebucht / erledigt — Yorro sucht das nicht nochmal. */
  bookedStay: LedgerEntry<boolean> | null;
  bookedFlight: LedgerEntry<boolean> | null;
  bookedTransfer: LedgerEntry<boolean> | null;
  /** Bahn / Zug schon gebucht. */
  bookedRail: LedgerEntry<boolean> | null;
  /** Fernbus schon gebucht. */
  bookedBus: LedgerEntry<boolean> | null;
  /** Mietwagen schon gebucht. */
  bookedCar: LedgerEntry<boolean> | null;
  /** Explizit Mietwagen noch brauchen (gap_fill). */
  needCar: LedgerEntry<boolean> | null;
  /** Schon gebuchte Aktivitäten / Tickets (Name + optionaler Tag-Hinweis). */
  bookedActivities: LedgerEntry<import('./gapInventory').BookedActivity[]> | null;
  /**
   * Inventar-Modus: full_discover | gap_fill | add_on.
   * Meist abgeleitet — User/Parse kann explizit setzen.
   */
  inventoryMode: LedgerEntry<import('./gapInventory').InventoryMode> | null;
  /**
   * Fast-Scope: full | flight | stay | activity.
   * Nur eine Spur suchen — Brief und Funnel schrumpfen.
   */
  researchFocus: LedgerEntry<import('./gapInventory').ResearchFocus> | null;
  /** Wie vom Bahnhof/Flughafen zur Unterkunft. */
  transferPref: LedgerEntry<'taxi' | 'public' | 'rental' | 'package' | 'walk' | 'unsure'> | null;
  /**
   * Hintergründe / Intention — nicht nur der Sticker-Wert.
   * z. B. "günstig weil Studenten", "schon Hotel in Barcelona".
   */
  intentNotes: LedgerEntry<string[]> | null;
  /**
   * Flipchart-Pins: jede Antwort sofort sichtbar (Vorschau),
   * auch wenn der strukturierte Parser noch nichts setzt.
   */
  boardPins: LedgerEntry<import('./boardPins').BoardPin[]> | null;
  /** Offenes Datumsfenster: YYYY-MM oder YYYY-MM..YYYY-MM / season label. */
  dateWindow: LedgerEntry<string> | null;
  /** Tage früher anreisen ok (billigere Flüge / Puffer vor Must-Da-Sein). */
  arrivalFlexDays: LedgerEntry<number> | null;
  /** Tage länger bleiben / später abreisen ok. */
  departureFlexDays: LedgerEntry<number> | null;
  /** Anchor-POI Name (Megapark, Altstadt…). */
  anchorPoi: LedgerEntry<string> | null;
  /** Max. Distanz Stay↔Anchor in Metern. */
  radiusM: LedgerEntry<number> | null;
  /** Reisende Altersspanne für Bahn-Sparpreise. */
  travelerAges: LedgerEntry<number[]> | null;
  /** Bahncard vorhanden / Typ. */
  bahncard: LedgerEntry<'none' | '25' | '50' | '100' | 'unknown'> | null;
  /** Flug-Komfort: max Layover h, keine Nachtankunft etc. */
  flightComfort: LedgerEntry<{
    maxLayoverHours?: number;
    noNightArrival?: boolean;
    noEarlyDepart?: boolean;
    overnightOk?: boolean;
  }> | null;
  /** Bahn: früher/später/Nacht ok für Sparpreis. */
  railFlex: LedgerEntry<'strict' | 'early_late_ok' | 'overnight_ok'> | null;
  /** localMovePref — ÖPNV / Walk / Mietwagen / Mix. */
  localMovePref: LedgerEntry<'oepnv' | 'walk' | 'rental' | 'mix'> | null;
  /** Explizite Aktivitäts-Musts (Club, Museum…) — Freitext. */
  mustActivities: LedgerEntry<string[]> | null;
  /** User will eSIM / mobile Daten am Ziel. */
  needEsim: LedgerEntry<boolean> | null;
  /** Deal/Preisfehler aktiv suchen. */
  dealHunt: LedgerEntry<boolean> | null;
  /** Discover-Intent: lonely_beach, low_tourist, adventure_hike… */
  discoverIntent: LedgerEntry<string> | null;
  /**
   * Zeitfenster Prefer vs Soft (Do ab 13 ok, Rück Di schöner als Mi).
   * dateStart/End bleiben Anker; whenFlex steuert Ranking.
   */
  whenFlex: LedgerEntry<WhenFlexSpec> | null;
  /** FlixTrain≠Bus / Surface-Wahl. */
  surfacePref: LedgerEntry<SurfacePref> | null;
  /** Multi-City: Reihenfolge + Nächte je Stop. */
  hopStops: LedgerEntry<HopStop[]> | null;
  /** Max. Bahn-/Zugdauer getrennt von Auto. */
  maxRailHours: LedgerEntry<number> | null;
  /** Zugang: 70+, Rollstuhl, Mobilität — Freitext-Tags. */
  accessNeeds: LedgerEntry<string[]> | null;
  /** Spa: liegen vs. aktiv nutzen. */
  spaIntent: LedgerEntry<'lie_down' | 'active' | 'mixed'> | null;
  /** Stadt-Erwartung Freitext (Museen, Kirchen, Hop-on…). */
  cityExplore: LedgerEntry<string> | null;
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
  dayIndex?: number;
  dayKey?: string;
  timeHint?: string | null;
};

export type FactThumb = {
  id: string;
  emoji: string;
  label: string;
  met: boolean;
};

export type StayChoice = {
  id: string;
  name: string;
  priceEur: number | null;
  bookUrl: string | null;
  photoUrl: string | null;
  why: string;
  lat?: number;
  lng?: number;
  distToAnchorM?: number | null;
  dealHit?: boolean;
  /** Expedia Property-ID wenn belegt (Book-CTA-Gate). */
  expediaPropertyId?: string | null;
  /** Hotel-üblich / belegt — Check-in ab HH:MM. */
  checkInFrom?: string | null;
  /** Hotel-üblich / belegt — Check-out bis HH:MM. */
  checkOutUntil?: string | null;
};

export type TransportChoice = {
  id: string;
  kind: 'flight' | 'train' | 'bus' | 'car' | 'transfer' | 'ferry' | 'cruise';
  label: string;
  departAt: string | null;
  arriveAt: string | null;
  priceEur: number | null;
  bookUrl: string | null;
  better: boolean;
  fromIata?: string | null;
  toIata?: string | null;
  /** Bahn/Bus: Bahnhofsname Start (UI) */
  fromStation?: string | null;
  /** Bahn/Bus: Bahnhofsname Ziel (UI) */
  toStation?: string | null;
  /** Bahn: „über Berlin Hbf“ / „Direkt“ */
  viaHint?: string | null;
  durationHint?: string | null;
  compareUrl?: string | null;
  /** z. B. FR2049 */
  flightNumber?: string | null;
  /** IATA Airline z. B. FR */
  carrier?: string | null;
  transfers?: number | null;
  /** ISO-Tag der Abreise (für Zubringer / Tag-früher). */
  departDateKey?: string | null;
  /** Günstigerer Kalendertag am Ziel (nicht Hub-Vornacht). */
  earlyArrival?: boolean;
  /** Start < 07:00 → Vornacht-Hotel am Abflug-/Abfahrtshub. */
  hubPreNight?: boolean;
};

export type DayBlock = {
  id: string;
  time?: string | null;
  title: string;
  detail: string;
  costEur?: number | null;
  bookUrl?: string | null;
  photoUrl?: string | null;
  icon?: string | null;
};

export type DayPlan = {
  dayKey: string;
  title: string;
  /** Kurz: Mo / Di / … — parallel zum title. */
  weekdayLabel?: string | null;
  blocks: DayBlock[];
};

/** Wochentag DE kurz (whenFlex Prefer/Soft). */
export type WeekdayDe = 'mo' | 'di' | 'mi' | 'do' | 'fr' | 'sa' | 'so';

/** Ein Bein (Hin oder Rück) mit Prefer vs Soft. */
export type WhenFlexLeg = {
  preferWeekday?: WeekdayDe | null;
  softWeekdays?: WeekdayDe[];
  /** Früheste Abflug-/Abfahrtsstunde am Soft-Tag (z. B. Do ab 13). */
  earliestHour?: number | null;
  preferDateKey?: string | null;
  softDateKeys?: string[];
};

export type WhenFlexSpec = {
  outbound?: WhenFlexLeg | null;
  return?: WhenFlexLeg | null;
};

/** FlixTrain vs Bus — nie vermischen. */
export type SurfacePref =
  | 'train_only'
  | 'train_ok_bus_no'
  | 'bus_ok'
  | 'bus_only'
  | 'either';

export type HopStop = {
  city: string;
  nights?: number | null;
};

/** Chronologischer Magazin-Beat (Anreise / Erlebnis / Rück). */
export type JourneyBeatKind =
  | 'flight_out'
  | 'train_out'
  | 'car_out'
  | 'destination'
  | 'transfer'
  | 'stay'
  | 'activity'
  | 'flight_return'
  | 'train_return'
  | 'other';

export type JourneyBeat = {
  id: string;
  kind: JourneyBeatKind;
  title: string;
  detail: string;
  /** Finaler belegter Preis — nie „ab“. */
  priceEur?: number | null;
  durationHint?: string | null;
  photoUrl?: string | null;
  bookUrl?: string | null;
  icon?: string | null;
  /** User hat das schon — kein Partner-Link / Badge „schon gebucht“. */
  alreadyBooked?: boolean;
};

/** Wunsch-Kapitel in der Erlebnis-Mitte (Pool, Grill, Padel…). */
export type WishChapter = {
  id: string;
  mustHaveId: string;
  title: string;
  blurb: string;
  photoUrl: string | null;
  distanceHint?: string | null;
  costHint?: string | null;
  /** Konkreter Preis nach Entscheidung (belegt). */
  priceEur?: number | null;
  priceMinEur?: number | null;
  priceMaxEur?: number | null;
  lat?: number | null;
  lng?: number | null;
  met: boolean;
  bookUrl?: string | null;
  emoji?: string | null;
};

export type PriceBreakdownLine = {
  id: string;
  label: string;
  amountEur: number | null;
  /** p.P. vs Gruppe */
  scope: 'per_person' | 'group' | 'total';
};

export type StorySectionId =
  | 'hero'
  | 'anreise'
  | 'stay'
  | 'momente'
  | 'tage'
  | 'rueckflug'
  | 'kosten'
  | 'buchen';

export type StorySectionAnchor = {
  id: StorySectionId;
  label: string;
};

export type BookingCheckItem = {
  id: string;
  label: string;
  url: string | null;
  kind:
    | 'flight'
    | 'train'
    | 'stay'
    | 'transfer'
    | 'car'
    | 'activity'
    | 'package'
    | 'cruise'
    | 'ferry'
    | 'other';
  clickedAtMs?: number | null;
  /** Auswahl: Spanne; nach Klick ggf. konkreter €. */
  priceLabel?: string | null;
  /** Schon vom User gebucht — kein Partner-CTA. */
  alreadyBooked?: boolean;
};

export type ComboWindow = {
  id: string;
  checkin: string;
  checkout: string;
  flightEur: number | null;
  stayEur: number | null;
  transferEur: number | null;
  totalEur: number | null;
  label: string;
  dealHit?: boolean;
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
  /** Kurz: Hard/Soft/No-Go Fit-Zeile. */
  fitLine: string | null;
  whyBlurb: string;
  facts: FactThumb[];
  softFacts: FactThumb[];
  whyMatch: [string, string] | [string];
  gaps: string[];
  photoUrl: string | null;
  stayName?: string | null;
  stayBookUrl?: string | null;
  stayPriceEur?: number | null;
  flightBookUrl?: string | null;
  flightPriceEur?: number | null;
  carBookUrl?: string | null;
  /** Mietwagen/Camper Gesamtpreis für die Gruppe (geteilt im Buy-in). */
  carPriceEur?: number | null;
  transferBookUrl?: string | null;
  packageBookUrl?: string | null;
  originUsed?: string | null;
  decisionNotes?: string[];
  stops: StoryStop[];
  /** Buy-in p.P. (Transport + Stay + LocalMove). */
  buyInEur?: number | null;
  buyInLabel?: string | null;
  extrasEur?: number | null;
  /** 1 Nacht am Origin-Hub vor Frühflug/Frühschiff — nicht in stays[] (Ziel-Hotel). */
  hubPreNightStay?: StayChoice | null;
  /** Hotel vor Night-Train / Tour-Start — zweites Live-Hotel, nicht Ziel-Klon. */
  bookendStartStay?: StayChoice | null;
  stays?: StayChoice[];
  selectedStayId?: string | null;
  transports?: TransportChoice[];
  selectedTransportId?: string | null;
  days?: DayPlan[];
  bookingChecklist?: BookingCheckItem[];
  /**
   * Ausführliche Erlebnis-Speech für TTS (≤800 Zeichen).
   * Nicht im UI rendern — nur auto vorlesen beim Öffnen.
   */
  speechSummary?: string | null;
  /** Kurze Erlebnis-Summary für Hero-UI (≤300 Zeichen), ohne Uhrzeiten. */
  experienceSummary?: string | null;
  /** Magazin-Timeline Anreise→Stay (+ ggf. Destination). */
  journeyBeats?: JourneyBeat[];
  /** Rückreise-Beats (meist Rückflug). */
  returnBeats?: JourneyBeat[];
  /** Wunschmomente mit großen Fotos. */
  wishChapters?: WishChapter[];
  /** Kostenzeilen für das Finale (finale Preise, kein „ab“). */
  priceBreakdown?: PriceBreakdownLine[];
  /** Sprung-Nav rechts. */
  sectionAnchors?: StorySectionAnchor[];
  comboWindows?: ComboWindow[];
  dealHit?: boolean;
  transferEur?: number | null;
  /** Geschätzte/belegte Transfer-Dauer in Minuten. */
  transferMinutes?: number | null;
  /**
   * Magazin: Wetter/Temperatur am Ziel für Reisedaten
   * (Forecast oder typisch/Archiv) — nur belegt.
   */
  weatherLine?: string | null;
  weatherTempHighC?: number | null;
  weatherTempLowC?: number | null;
  weatherKind?: 'forecast' | 'typical' | null;
  /**
   * Roh-Evidenz für Wunschkapitel (Nearby/Amenities) —
   * für Re-Enrich bei Stay/Transport-Wechsel.
   */
  wishEvidence?: Array<{
    mustHaveId: string;
    name?: string | null;
    distanceM?: number | null;
    photoUrl?: string | null;
    editorial?: string | null;
    courtHint?: string | null;
    costHint?: string | null;
    lat?: number | null;
    lng?: number | null;
    met: boolean;
    onProperty: boolean;
    detail?: string | null;
  }>;
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
  researchSteps: ResearchStep[];
  /** Verspielte Live-Chips während Akt 3. */
  researchSparks: ResearchSpark[];
  decisionJournal: DecisionNote[];
  phase: ReisePhase;
  /** Kernpaket war einmal voll — Suchbutton bleibt grün. */
  searchReadySticky: boolean;
  /** Ready-Ansage wurde einmal gesprochen. */
  searchReadyAnnounced: boolean;
  searching: boolean;
  thinking: boolean;
  verifyProgress: number | null;
  /** Geschätzte Restminuten (Akt 3, gelernt) — null = aus. */
  researchEtaMin: number | null;
  searchError: string | null;
  selectedOptionId: string | null;
  questionHint: string;
  /** Flipchart-Sticker — Labels nur vom LLM (null = noch keine). */
  llmFlipchartNotes: import('./flipchartNotes').FlipchartNote[] | null;
  /** Vom Katalog ergänzte Extra-Fragen (Missverständnis / Research-kritisch). */
  catalogExtras: import('./questionCatalog').CatalogExtra[];
  /** Volle Akt-2-Zusammenfassung schon einmal gesprochen. */
  recapSpokenOnce: boolean;
  /** Ergebnis-Pitch schon gesprochen (verhindert Doppel-TTS Magazin+Funnel). */
  resultPitchSpokenKey: string | null;
  recapText: string | null;
  timelinePushedOptionId: string | null;
};

export const EMPTY_LEDGER: ReiseLedger = {
  mode: null,
  modeFallback: null,
  originCity: null,
  originCities: null,
  originLat: null,
  originLng: null,
  airportIata: null,
  destinationHint: null,
  corridor: null,
  dateStart: null,
  dateEnd: null,
  dateFlex: null,
  dateAnchor: null,
  dateMonth: null,
  datePart: null,
  stayDays: null,
  stayNights: null,
  stayNightsMax: null,
  adults: null,
  children: null,
  infants: null,
  cabinBags: null,
  checkedBags: null,
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
  maxLayoverHours: null,
  longLayoverExploreHours: null,
  overnightFlightOk: null,
  maxFlightStops: null,
  cheapDrinks: null,
  partyGrain: null,
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
  cruiseEmbarkBias: null,
  cruiseEmbarkPort: null,
  cruiseCabinClass: null,
  cruiseFareBundle: null,
  cruiseSeaDaysBias: null,
  cruiseKind: null,
  cruiseShipName: null,
  cruiseLinePref: null,
  ideaHook: null,
  rentalCar: null,
  weatherWant: null,
  meals: null,
  travelers: null,
  recapDone: null,
  bookedStay: null,
  bookedFlight: null,
  bookedTransfer: null,
  bookedRail: null,
  bookedBus: null,
  bookedCar: null,
  needCar: null,
  bookedActivities: null,
  inventoryMode: null,
  researchFocus: null,
  transferPref: null,
  intentNotes: null,
  boardPins: null,
  dateWindow: null,
  arrivalFlexDays: null,
  departureFlexDays: null,
  anchorPoi: null,
  radiusM: null,
  travelerAges: null,
  bahncard: null,
  flightComfort: null,
  railFlex: null,
  localMovePref: null,
  mustActivities: null,
  needEsim: null,
  dealHunt: null,
  discoverIntent: null,
  whenFlex: null,
  surfacePref: null,
  hopStops: null,
  maxRailHours: null,
  accessNeeds: null,
  spaIntent: null,
  cityExplore: null,
};

