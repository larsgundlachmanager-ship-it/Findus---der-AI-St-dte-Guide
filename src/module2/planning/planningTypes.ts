/**
 * Modul 5 — Typen (Lage / Task 0–1–2 / Prio / Nav / Pitch).
 */

export type PlanPriority = 1 | 2 | 3 | 4 | 5 | 6;

/** Vollständigkeit — unabhängig von Prio. */
export type TaskCompleteness = 0 | 1 | 2;

export type PlanLageMode = 'new' | 'add' | 'change';

export type GeoAnchorType = 'CURRENT_GPS' | 'HOTEL_START';

export type IngestGeoAnchor = {
  name: string;
  type: GeoAnchorType;
  needsClarification: boolean;
  lat?: number | null;
  lng?: number | null;
};

export type IngestFixedNode = {
  title: string;
  time: string | null;
  /** Ende HH:mm wenn User „von–bis“ sagt — sonst Default-Dauer */
  endTime?: string | null;
  priority: 1 | 2 | 3;
  location: string | null;
  needsClarification?: boolean;
  lat?: number | null;
  lng?: number | null;
  /** Geocodierte Adresse (nur UI/Notes — nie vorlesen) */
  address?: string | null;
};

export type IngestOpenWish = {
  title: string;
  priority: 4 | 5 | 6;
  context: string;
  id?: string;
  /** Grobes Zeitfenster HH:mm */
  estimatedTime?: string | null;
  /** Ende HH:mm bei von–bis (Training 14–20) */
  endTime?: string | null;
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
  /** Task-Vollständigkeit; default aus Zeit/Ort abgeleitet */
  completeness?: TaskCompleteness;
};

/** Einheitliche Aufgabenliste (Task 0/1/2 + Prio). */
export type PlanTask = {
  id: string;
  title: string;
  priority: PlanPriority;
  completeness: TaskCompleteness;
  timeHm: string | null;
  location: string | null;
  context: string;
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
  /** true = Prio 1–3 Fix; false = Queue/Wish */
  hard: boolean;
  status: 'open' | 'inserted' | 'needs_place' | 'queued' | 'done' | 'dropped';
};

export type IngestedPlan = {
  targetDate: string;
  geoAnchor: IngestGeoAnchor;
  /** Genannte Zielstadt (kann ≠ GPS-/Pack-Stadt sein). geoAnchor bleibt der Start. */
  destinationCity?: string | null;
  fixedNodes: IngestFixedNode[];
  openWishesQueue: IngestOpenWish[];
  /** Abgeleitete / LLM-gebaute Aufgabenliste */
  tasks: PlanTask[];
  /** new = neuer Tagplan · add = ergänzen · change = laufende Aufgabe ändern */
  lageMode: PlanLageMode;
  /**
   * Bridge: was ich gerade mache + Zusammenfassung der User-Nachricht.
   * Danach chronologisch offene Punkte / Fragen.
   */
  bridgeSpeech: string;
  /** Offene Punkte chronologisch (ohne Prio-6-Erkunden — das kommt zuletzt) */
  openQuestions: string[];
  /** Kurze Confirm-Frage am Ende der Bridge (passt das so?) */
  initialVoiceConfirm: string;
};

export type TransportMode = 'WALKING' | 'BICYCLE' | 'TRANSIT' | 'TAXI';

export type PlanNavNode = {
  id: string;
  title: string;
  coords: { lat: number; lng: number };
  plannedStartMs?: number | null;
  planPriority?: PlanPriority | null;
};

export type NavigationLeg = {
  id: string;
  mode: TransportMode;
  duration: number;
  fromId: string;
  toId: string;
  start: { lat: number; lng: number };
  end: { lat: number; lng: number };
};

export type DeepResearchUiCard = {
  name: string;
  lat: number;
  lng: number;
  placeId?: string | null;
  /** Kurzer Pitch (~180–300 Zeichen) — keine Adresse/Tel/Mail */
  speechPitch: string;
  /** Max. 3 Stichpunkte: Fakten/Zahlen zuerst */
  bulletPoints: string[];
  address?: string | null;
  actions: {
    mapsUrl: string;
    menuStatus: 'SEARCHING' | 'READY' | 'NONE';
    menuUrl?: string | null;
    ticketUrl?: string | null;
    reserveUrl?: string | null;
  };
};

export type DeepResearchPitchResult = {
  /** Kurzer Einstieg vor den zwei Pitches */
  summary?: string;
  uiCards: DeepResearchUiCard[];
};
