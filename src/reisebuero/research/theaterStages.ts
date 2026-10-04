/**
 * Akt-3 Theater — offen→eng Checkliste (SSOT Stages).
 * Legacy-Funnel-Stages werden hierhin gemappt.
 */

export const THEATER_STATUS_RAIL = [
  { stage: 'brief_plan', title: 'Brief-Plan' },
  { stage: 'open_space', title: 'Optionenraum' },
  { stage: 'access_filter', title: 'Zugang-Filter' },
  { stage: 'shortlist', title: 'Shortlist' },
  { stage: 'stay_tracks', title: 'Stay-Spuren' },
  { stage: 'flight_matrix', title: 'Flug-Matrix' },
  { stage: 'score_compare', title: 'Score-Compare' },
  { stage: 'feeder', title: 'Zubringer' },
  { stage: 'package_pick', title: '2–4 Pakete' },
] as const;

export type TheaterStage = (typeof THEATER_STATUS_RAIL)[number]['stage'];

/** Alte Funnel-/Pace-Keys → Theater-Stage. */
export const LEGACY_TO_THEATER: Record<string, TheaterStage> = {
  // Klima/Prefs/Events gehören zum offenen Raum — nicht zurück auf brief_plan
  climate: 'open_space',
  soft: 'open_space',
  discover: 'open_space',
  events: 'open_space',
  flights: 'flight_matrix',
  calendar: 'flight_matrix',
  stay: 'stay_tracks',
  transfer: 'feeder',
  compare: 'score_compare',
  qa: 'package_pick',
  // schon neue Namen
  brief_plan: 'brief_plan',
  open_space: 'open_space',
  access_filter: 'access_filter',
  shortlist: 'shortlist',
  stay_tracks: 'stay_tracks',
  flight_matrix: 'flight_matrix',
  score_compare: 'score_compare',
  feeder: 'feeder',
  package_pick: 'package_pick',
};

/**
 * Welche Raw-Keys dürfen die Theater-Stage wirklich auf done setzen.
 * Zwischen-Aliase (discover/events) nur Detail — sonst wäre open_space zu früh fertig.
 */
export const THEATER_STAGE_CLOSERS: Record<TheaterStage, readonly string[]> = {
  brief_plan: ['brief_plan'],
  open_space: ['open_space', 'soft'],
  access_filter: ['access_filter'],
  shortlist: ['shortlist'],
  stay_tracks: ['stay_tracks', 'stay'],
  flight_matrix: ['flight_matrix', 'flights', 'calendar'],
  score_compare: ['score_compare', 'compare'],
  feeder: ['feeder', 'transfer'],
  package_pick: ['package_pick', 'qa'],
};

export function normalizeTheaterStage(stage: string): TheaterStage {
  return LEGACY_TO_THEATER[stage] || (stage as TheaterStage) || 'brief_plan';
}

export function canFinishTheaterStage(rawStage: string, normalized?: TheaterStage): boolean {
  const norm = normalized || normalizeTheaterStage(rawStage);
  const closers = THEATER_STAGE_CLOSERS[norm];
  if (!closers) return true;
  return closers.includes(rawStage);
}

export function theaterStageIndex(stage: string): number {
  const norm = normalizeTheaterStage(stage);
  return THEATER_STATUS_RAIL.findIndex((r) => r.stage === norm);
}

export const THEATER_STAGE_MS: Record<string, number> = {
  brief_plan: 12_000,
  open_space: 55_000,
  access_filter: 18_000,
  shortlist: 25_000,
  stay_tracks: 160_000,
  flight_matrix: 140_000,
  score_compare: 45_000,
  feeder: 12_000,
  package_pick: 50_000,
  // Legacy-Keys (gleiche Budgets, falls Pace noch alt speichert)
  climate: 12_000,
  soft: 10_000,
  discover: 55_000,
  events: 20_000,
  flights: 140_000,
  calendar: 40_000,
  stay: 160_000,
  transfer: 12_000,
  compare: 45_000,
  qa: 50_000,
};
