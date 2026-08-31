/**
 * Strukturierte Concierge-Antwort: Ohr (speech) + Display (bullets/actions).
 */

export type QuickActionType =
  | 'START_NAVIGATION'
  | 'DIAL_PHONE'
  | 'OPEN_URL'
  | 'SHOW_MORE'
  | 'CONFIRM_API_RESERVATION'
  | 'SEND_RESERVATION_EMAIL'
  | 'TRIGGER_AI_CALL'
  | 'OPEN_GYG_WIDGET'
  | 'BOOK_UBER'
  | 'BOOK_CAR_RENTAL'
  | 'BOOK_BOUNCE_LUGGAGE'
  | 'BOOK_STAY22'
  | 'BOOK_ESIM'
  | 'COMPLETE_SHOPPING_TASK'
  | 'SNOOZE_SHOPPING_TASK'
  | 'SET_WAKE_ALARM'
  /** Countdown / Eieruhr */
  | 'SET_TIMER'
  /** Leave-by Erinnerung (Flug / Termin) — scheduleFlightDepartureReminder */
  | 'SET_DEPARTURE_REMINDER'
  /** Street View Bild lazy laden (nur nach Tap) */
  | 'SHOW_STREET_VIEW';

export type QuickActionPayload = {
  /** Numerische DB-ID oder spot_key */
  targetPoiId?: string | number;
  phoneNumber?: string;
  url?: string;
  textPrompt?: string;
  partySize?: number;
  timeLabel?: string;
  dateIso?: string;
  /** Timer-Dauer in ms (SET_TIMER) */
  durationMs?: number;
  /** GetYourGuide Tour-Slug oder Pfad */
  gygTourSlug?: string;
  /** GetYourGuide Location-ID */
  gygLocationId?: string;
  /** Uber Dropoff */
  destLat?: number;
  destLng?: number;
  destName?: string;
  /** Laufende Nav ersetzen (Tour-Modus: „Route neu“). */
  replaceRoute?: boolean;
  /** Als Stopp einsortieren, Reihenfolge neu optimieren. */
  addStop?: boolean;
  /** Uber: formatierte Zieladresse (Anzeige in Uber-App). */
  dropoffFormattedAddress?: string;
  /** Uber: gewünschte Abholzeit HH:mm → Reserve-Deep-Link mit pickup_formatted_time. */
  pickupTimeLabel?: string;
  /** Stay22 Zielstadt / Adresse */
  destination?: string;
  /** Hotel: vorausgefüllte Daten (Stay22 / Expedia) */
  checkin?: string;
  checkout?: string;
  adults?: number;
  /** Street View heading */
  headingDeg?: number;
  /** Closing-gate bypass after explicit „trotzdem“ */
  skipClosingGate?: boolean;
  /** Fernziel-Verify überspringen (User hat Pin/Ja bestätigt) */
  skipDestVerify?: boolean;
  /** ÖPNV door-to-door: gecachte Journey starten */
  journeyNav?: boolean;
  /** Nach Navigation Karte/Stichpunkte behalten (Arzt/Notfall) */
  keepCard?: boolean;
  /** Modul-1 „Mehr Historie“ → Deep-Dive am aktuellen POI (nicht Modul-2/Planung) */
  module1DeepDive?: boolean;
  /** Shopping / Errand task id */
  taskId?: string;
  /** Store place id that triggered the reminder */
  placeId?: string;
  /** Trigger offline compass navigation without API fetches */
  offlineOnly?: boolean;
  /** Radweg / Bike-Empfehlung → Session auf Zweirad umstellen */
  preferBike?: boolean;
  /** User hat explizit Zu-Fuß gewählt (keine erneute ÖPNV-Wahl) */
  preferWalk?: boolean;
  /** User hat explizit ÖPNV gewählt (Journey planen/starten, kein Auto-Fuß) */
  preferTransit?: boolean;
  /** Local post-action flow, e.g. after choosing a restaurant */
  autoFollowUp?: 'reservation';
  /** Multi-Stop: Essen → Aussicht usw. (Action startet Tour) */
  multiStop?: Array<{
    name: string;
    lat: number;
    lng: number;
    poiId?: number;
  }>;
  /** Wecker: bestehenden ersetzen, zweiten hinzufügen, oder löschen */
  wakeMode?: 'replace' | 'add' | 'cancel';
  /** Alter Wecker-Zeitpunkt beim Ersetzen / Löschen */
  replaceWakeAtMs?: number;
  /** ActionBoard: stabile Slot-ID für Deep-Patch */
  actionBoardId?: string;
  /** ActionBoard: Chip lädt noch (nicht klickbar) */
  pending?: boolean;
  pendingKind?: string;
  /** Gebundene Entity (Label/URL-Guard) */
  entityName?: string;
  entityRank?: 1 | 2;
  /** Expand-Typ für „Noch mehr“ */
  expandKind?: 'poi_history' | 'activity' | 'knowledge' | 'offer';
  /** Affiliate-Kennzeichnung */
  affiliateMarked?: boolean;
  /** Tap-Chip ohne Mic (continueTurnFromChoice) */
  choiceTap?: {
    parentTurnId: string;
    choiceId: string;
    slotKey: string;
    label: string;
  };
};

export type QuickAction = {
  type: QuickActionType;
  label: string;
  payload: QuickActionPayload;
};

/** Hintergrund-Tasks — Orchestrator führt sie VOR der Speech aus. */
export type BackgroundTaskType = 'SET_NATIVE_ALARM';

export type BackgroundTask = {
  type: BackgroundTaskType;
  /** "07:30" */
  time?: string;
  label?: string;
  /** Alternative zu time */
  dateIso?: string;
  wakeAtMs?: number;
};

export type GeminiConciergeResponse = {
  speechText: string;
  visualBullets: string[];
  quickActions: QuickAction[];
  /** Optionaler Kartentitel */
  cardTitle?: string;
  /** Optionaler Untertitel (z. B. Kategorie unter dem Pin-Namen) */
  cardSubtitle?: string;
  /**
   * Native Side-Effects (Wecker etc.).
   * Müssen erfolgreich laufen, bevor speechText Erfolg behauptet.
   */
  backgroundTasks?: BackgroundTask[];
};

export type ConciergeCardState = GeminiConciergeResponse & {
  id: string;
  createdAtMs: number;
};
