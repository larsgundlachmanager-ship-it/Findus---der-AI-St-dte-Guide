/**
 * Auswahl-Pitch Modul — Contract (kein Mic-Einstieg, keine Bridge).
 * Parent (M2/M5) liefert Brief; Pitch filtert, rankt, pitcht, hängt Deep nach.
 */

import type { QuickAction } from '../../types/concierge';

export type PitchSearchMode =
  | 'here_now'
  | 'on_route'
  | 'between_stops'
  | 'landmark'
  | 'future_place'
  | 'city_best';

export type PitchWishHardness = 'must' | 'nice';

export type PitchWish = {
  text: string;
  hardness: PitchWishHardness;
  /** z. B. cuisine / dish / amenity / vibe */
  kind?: string;
  /** Call-1 Ranking-Gewicht 1–30 — wenn gesetzt, steuert candidateRank */
  weight?: number;
};

/** Call-1 Such-Kriterium (kein Venue-Score). */
export type PitchCall1Criterion = {
  key: string;
  role: 'must' | 'nice' | 'soft';
  weight: number;
};

export type PitchLatLng = { lat: number; lng: number };

export type PitchRouteBrief = {
  start: PitchLatLng;
  end: PitchLatLng;
  /** Vorhandene Nav-Polyline (lng/lat pairs) — optional */
  polyline?: Array<[number, number]> | null;
  /** User-Position wenn Nav läuft */
  user?: PitchLatLng | null;
};

export type PitchLandmarkBrief = {
  name: string;
  lat: number;
  lng: number;
};

export type PitchPrefSlice = {
  allergies?: string[];
  diet?: string[];
  budgetHint?: string | null;
  avoidCategories?: string[];
  cuisineLikes?: string[];
};

export type PitchKind =
  | 'food'
  | 'hotel'
  | 'tour'
  | 'sight'
  | 'cinema'
  | 'bar'
  | 'generic';

/** Parent → Pitch */
export type PitchRequest = {
  requestId: string;
  title: string;
  context: string;
  kind: PitchKind;
  searchMode: PitchSearchMode;
  /** Besuchsmoment (ms) — open_at / Dwell */
  visitAtMs: number;
  stayMin?: number;
  wishes: PitchWish[];
  prefs: PitchPrefSlice;
  /** GPS / Anker für here_now / city_best */
  anchor: PitchLatLng;
  cityHint?: string | null;
  route?: PitchRouteBrief | null;
  landmark?: PitchLandmarkBrief | null;
  /** UI: Timeline gestapelt vs Live split */
  uiLayout: 'timeline_stack' | 'live_split';
  /** Parent hat Bridge schon gesprochen / startet parallel */
  bridgeAlreadySpoken?: boolean;
  /** Gesprochene Einleitung — Pitch setzt flüssig an, kein zweites Intro */
  continueFromBridge?: string | null;
  signal?: AbortSignal;
  /** Call-1: was der User JETZT will — Speech/Call-2 folgt dem */
  authorIntent?: string | null;
  /** Call-1 Must-Haves (Hard-Filter-Labels) */
  call1MustHaves?: string[];
  /** Call-1 Kriterien + Gewichte für Ranking (keine Ortsnamen) */
  call1Criteria?: PitchCall1Criterion[];
  /** Backend Shortlist vor Speak (Default 5) */
  shortlistSize?: number;
};

export type PitchCandidate = {
  name: string;
  lat: number;
  lng: number;
  placeId?: string | null;
  rating?: number | null;
  ratingCount?: number | null;
  address?: string | null;
  mapsUrl: string;
  openNow?: boolean | null;
  opensAtMin?: number | null;
  closesAtMin?: number | null;
  /** Kein Period für den Besuchstag (z. B. Sommerpause laut Maps) */
  closedOnVisitDay?: boolean | null;
  /** Soft dish / pack hints */
  softTags?: string[];
  /** Kurze Insider-Hooks aus Website/Places (für Pitch) */
  hookNotes?: string[];
  hardEvidence?: string[];
  /** Konkreter Preis-Hinweis zum Wunschgericht (Menue-Beleg) */
  dishPriceHint?: string | null;
  source: 'pack' | 'places' | 'osm' | 'stay22';
  /** Stay22 live total for the stay window */
  priceTotalEur?: number | null;
  pricePerNightEur?: number | null;
  nights?: number | null;
  checkin?: string | null;
  checkout?: string | null;
  detourPrio?: number;
  detourMinApprox?: number;
  sideM?: number;
  distFromAnchorM?: number;
  /** Places websiteUri — Speisekarte-Seed / Deep-Append */
  websiteUrl?: string | null;
  /** Hotel Stay22/Expedia Deep-Link wenn bekannt */
  bookingUrl?: string | null;
};

export type PitchOptionCard = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  placeId?: string | null;
  role: 'favorite' | 'alternative' | 'out_of_box';
  speechPitch: string;
  bullets: string[];
  mapsUrl: string;
  menuUrl?: string | null;
  bookingUrl?: string | null;
  ticketUrl?: string | null;
  websiteUrl?: string | null;
  rating?: number | null;
  actions: QuickAction[];
  /** Benannter Laden: Route schon vor der Kartenwahl zeigen */
  showNavBeforeSelect?: boolean;
};

export type PitchResult = {
  requestId: string;
  softFail: boolean;
  /** Spoken main pitch (beide Optionen) */
  spokenText: string;
  summary?: string;
  options: PitchOptionCard[];
  /** Out-of-box Zusatz (optional, oft in options mit role) */
  outOfBoxHint?: string | null;
  uiLayout: 'timeline_stack' | 'live_split';
};

export type PitchUiLayout = PitchRequest['uiLayout'];

export type PitchDeepAppend = {
  requestId: string;
  /** Nur gewählte Option-ID oder null = beide */
  optionId: string | null;
  spokenAppend: string;
  bulletUpdates?: Record<string, string[]>;
  actionUpdates?: Record<string, QuickAction[]>;
  menuUrls?: Record<string, string | null>;
};
