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
  | 'tickets';

/** Was die Antwort vermeiden / zurückstellen soll. */
export type LearnedRuleAvoid =
  | 'long_history'
  | 'address_unless_asked'
  | 'gps_coords'
  | 'fake_promises'
  | 'permission_questions'
  | 'meta_app_pitch'
  | 'vague_filler'
  | 'nav_auto_start';

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
};

export const LEARNED_RULE_AVOID_LABELS: Record<LearnedRuleAvoid, string> = {
  long_history: 'keine lange Historie vor der Lösung',
  address_unless_asked: 'keine Adresse/GPS außer User fragt',
  gps_coords: 'keine Koordinaten vorlesen',
  fake_promises: 'nichts erfinden / keine Fake-Versprechen',
  permission_questions: 'keine „Soll ich…?“-Permission-Fragen',
  meta_app_pitch: 'kein App-/Mikro-Selbstvorschlag',
  vague_filler: 'kein vages Vorgeplänkel statt Antwort',
  nav_auto_start: 'Navigation nicht ungefragt starten',
};
