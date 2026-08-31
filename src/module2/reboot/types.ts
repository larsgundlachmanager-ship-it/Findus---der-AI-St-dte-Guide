/**
 * Yorro Reboot v1 — Verträge für dünnen Manager → Fact-Lane → Synthese.
 * Keine Scripts: Struktur + Pflichtfelder. Wortlaut bleibt der Synthese.
 */

import type { FindusJobId, JobActionKey, JobFactKey } from '../jobs/types';

/** Top-Level Module, die der Manager vergibt (nicht 20 Chatfenster). */
export type ManagerModule =
  | 'story' // Modul 1 / Ort + Historie / „was ist das“
  | 'nav' // irgendwo hin / Amenity / Kompass
  | 'plan' // Timeline / später / Abendessen-Slot
  | 'tour' // Explore, unbesucht, 1-h-Tour, Strand-Vergleich
  | 'care' // Parken, Todos, Leave-by, Geofence-Reminder
  | 'live_q' // jetzt: Aldi, Kino live, Outfit, Party heute
  | 'combo' // Multi-Constraint Cluster (Parken×Pizza×Förde)
  | 'smalltalk';

export type ThreadMode = 'continue' | 'new' | 'resume' | 'parallel';

/** Call-1: Manager / Router — verteilt Jobs, eine Bridge, Thread-Entscheidung. */
export type RebootRouterOut = {
  module: ManagerModule;
  /** Primäre Fact-Jobs (meist 1, max 2 parallel Code-Lanes). */
  jobs: FindusJobId[];
  /** Optionale Think-Ahead-Hints für Fact-Lane / Care (kein Extra-LLM). */
  thinkAhead: ThinkAheadHint[];
  /** Genau eine Bridge — leer = keine Bridge (Follow-up im Thread). */
  bridgeOneLiner: string | null;
  thread: ThreadMode;
  /** Stabiler Themen-Anker (POI-id, „aldi“, „kiel-combo“…). */
  topicId: string;
  /** Wenn true: Deep-Research/Links dürfen nach der Fast-Antwort nachpoppen. */
  allowSlowLane: boolean;
  /** 1 Treffer im Radius → Nav sofort starten (Amenity). */
  autoStartNavIfUnique: boolean;
};

export type ThinkAheadHint =
  | 'outfit_from_plan_and_weather' // Abendessen 5★ + Wetter → Kleidung
  | 'diet_filter' // vegetarisch → kein Steakhaus
  | 'budget_filter'
  | 'mobility_mode' // Auto / Fuß / Bahn
  | 'parking_leave_by' // Ticket speichern + OSM Leave-by
  | 'parking_invalidate_on_drive' // Auto weg → Reminder killen
  | 'pref_filter_sights' // Museen raus / Theater rein
  | 'combo_cluster' // Schnittmenge Constraints
  | 'menu_links_required' // Speisekarte nachreichen
  | 'booking_deeplink_prefill' // Stay22 Zeitraum/Zimmer
  | 'age_safe_nightlife'; // Kinder-Events raus

/** Fact-Lane Output — stilfrei, nur belegte Daten. */
export type RebootFactItem = {
  id: string;
  text: string;
  source: 'pack' | 'osm' | 'web' | 'places' | 'user' | 'code';
  placeName?: string;
  lat?: number;
  lng?: number;
  url?: string;
  priceEur?: number;
  alreadySaid?: boolean;
};

export type RebootPreparedAction = {
  type: JobActionKey;
  label: string;
  /** Ready = sofort klickbar; pending = Slow-Lane lädt noch. */
  status: 'ready' | 'pending';
  destName?: string;
  destLat?: number;
  destLng?: number;
  url?: string;
  /** Stay22 / Booking Prefill */
  meta?: Record<string, string | number | boolean | null>;
};

export type RebootFactBundle = {
  topicId: string;
  module: ManagerModule;
  facts: RebootFactItem[];
  /** Pflicht-Keys die schon erfüllt sind */
  satisfied: JobFactKey[];
  /** Noch offen — Slow-Lane darf nachliefern */
  gaps: JobFactKey[];
  actions: RebootPreparedAction[];
  /** Mehrere Pack-Kandidaten bei „was ist das“ */
  placeCandidates?: Array<{
    name: string;
    lat: number;
    lng: number;
    distanceM: number;
    score: number;
  }>;
};

/** Call-2: Synthese — Speech + UI nur aus FactBundle + Persona-Rucksack. */
export type RebootSynthesisOut = {
  speech: string;
  bullets: string[];
  actions: RebootPreparedAction[];
  /** Facts die als gesprochen gelten → Thread alreadySaid. */
  consumedFactIds: string[];
};

/** Was immer mit in Call-1 und Call-2 geht (kein Extra-Prompt-Ballast). */
export type RebootContextRucksack = {
  personaPrompt: string;
  userAgeBand: string | null;
  userGender: string | null;
  diet: string[];
  budgetDayEur: number | null;
  mobility: Array<'walk' | 'bike' | 'car' | 'transit' | 'flight'>;
  travelPace: 'relaxed' | 'balanced' | 'packed' | null;
  sightPrefs: {
    loves: string[];
    skips: string[];
  };
  weatherTonight: {
    tempC: number | null;
    windy: boolean;
    rainChance: number | null;
  } | null;
  planTonight: string | null;
  parking: {
    label: string;
    lat: number | null;
    lng: number | null;
    expiresAtMs: number | null;
  } | null;
  topicAlreadySaidFactIds: string[];
};
