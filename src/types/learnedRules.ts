/**
 * Gelernte Antwort-Regeln aus User-Korrekturen.
 * Struktur/Constraints — nie feste Wortlaut-Scripts (Dynamic-Structure-Doktrin).
 */

export type LearnedRuleIntentFamily =
  | 'activity_poi'
  | 'dining'
  | 'events'
  | 'hotel'
  | 'navigation'
  | 'knowledge'
  | 'planning'
  | 'booking'
  | 'packing'
  | 'general';

/** Was die Antwort strukturell liefern / betonen soll. */
export type LearnedRuleExpect =
  | 'prices'
  | 'duration'
  | 'booking_url'
  | 'website'
  | 'life_now'
  | 'short_history'
  | 'answer_first'
  | 'concrete_place'
  | 'route_button'
  | 'alternatives'
  | 'times_hours'
  | 'menu'
  | 'tickets'
  | 'sky_conditions'
  | 'temp_range'
  | 'rain_timing'
  | 'clothing_tip'
  | 'casual_tone'
  | 'woven_clothing'
  | 'brief_speech'
  | 'complete_sentences'
  | 'pack_prefs';

/** Was die Antwort vermeiden / zurückstellen soll. */
export type LearnedRuleAvoid =
  | 'long_history'
  | 'address_unless_asked'
  | 'gps_coords'
  | 'fake_promises'
  | 'permission_questions'
  | 'meta_app_pitch'
  | 'vague_filler'
  | 'nav_auto_start'
  | 'station_board_fallback'
  | 'aushang'
  | 'invent_storm'
  | 'dry_list'
  | 'sun_as_day_at_night'
  | 'parenthetical_aside'
  | 'new_pitch'
  | 'boilerplate_opener'
  | 'essay'
  | 'pack_unwanted_items';

export type LearnedRule = {
  id: string;
  scope: 'user';
  intentFamily: LearnedRuleIntentFamily;
  tags: string[];
  expect: LearnedRuleExpect[];
  avoid: LearnedRuleAvoid[];
  /** Einzeiler für Prompt — abstrakte Struktur, kein Script. */
  summary: string;
  /** 0.2 … 1.0 — steigt bei Wiederholung / erfolgreichem Match. */
  strength: number;
  hitCount: number;
  createdAt: string;
  updatedAt: string;
  lastMatchedAt?: string;
  /** Kurzer Digest der Korrektur (Debug / Dedup). */
  evidenceDigest?: string;
};

export const MAX_LEARNED_RULES = 24;

export const LEARNED_RULE_EXPECT_LABELS: Record<LearnedRuleExpect, string> = {
  prices: 'belegte Preise nennen',
  duration: 'Dauer/Zeitaufwand nennen wenn belegt',
  booking_url: 'Buchungs-/Website-Link priorisieren (Button)',
  website: 'Website anbieten wenn belegt',
  life_now: 'Schwerpunkt Leben jetzt / Angebot, nicht Historie',
  short_history: 'Historie nur kurz',
  answer_first: 'klare Antwort vorne, Tipps hinten',
  concrete_place: 'konkreten Ort/Namen nennen',
  route_button: 'Route-Button wenn Ort genannt',
  alternatives: 'kurze Alternative hinten',
  times_hours: 'Öffnungs-/Uhrzeiten wenn belegt',
  menu: 'Speisekarte/Angebot wenn URL belegt',
  tickets: 'Ticket-Info/Link wenn belegt',
  sky_conditions: 'Himmel/Bedingungen nur belegt',
  temp_range: 'Temperaturspanne nennen wenn belegt',
  rain_timing: 'Regen-Zeitfenster wenn belegt',
  clothing_tip: 'Kleidungstipp aus belegtem Wetter',
  casual_tone: 'lockerer Alltagston',
  woven_clothing: 'Kleidung im Fließtext weben, keine Klammern',
  brief_speech: 'kurz und verdichtet — wenige Sätze, kein Aufblasen',
  complete_sentences: 'vollständige Fließtext-Sätze, kein Telegramm-Stakkato',
  pack_prefs: 'persönliche Pack-Prefs (nie/immer) respektieren',
};

export const LEARNED_RULE_AVOID_LABELS: Record<LearnedRuleAvoid, string> = {
  long_history: 'keine lange Historie vor der Lösung',
  address_unless_asked: 'keine Adresse/GPS außer User fragt',
  gps_coords: 'keine Koordinaten vorlesen',
  fake_promises: 'nichts erfinden / keine Fake-Versprechen',
  permission_questions: 'keine „Soll ich…?“-Permission-Fragen',
  meta_app_pitch: 'kein App-/Mikro-Selbstvorschlag',
  vague_filler: 'kein vages Vorgeplänkel / keine Warte-Meta („gleich fertig“)',
  nav_auto_start: 'Navigation nicht ungefragt starten',
  station_board_fallback: 'kein Aushang/Bahnhof als Wetter-Fallback',
  aushang: 'kein „schau am Aushang“',
  invent_storm: 'kein erfundenes Unwetter',
  dry_list: 'keine trockene Aufzählungsliste vorlesen',
  sun_as_day_at_night: 'nach Sunset/vor Sunrise keine Sonne als Tag-Wetter',
  parenthetical_aside: 'keine Outfit-/Tipp-Parenthesen im Speech',
  new_pitch: 'kein neuer Auswahl-Pitch nach klarer Entscheidung',
  boilerplate_opener: 'kein App-Opener („Also in X sieht es so aus“, „Zusammengefasst“)',
  essay: 'kein Essay / keine unnötige Länge',
  pack_unwanted_items: 'keine unerwünschten Pack-Items (User-Prefs)',
};
