/**
 * Session plan — multi-intent free-roam + timed stops + semantic shopping.
 * No hardcoded place names / times / items — all from Gemini JSON.
 */

export type SessionPlanStopKind = 'fixed' | 'dynamic' | 'hotel';

export type SessionPlanStop = {
  id: string;
  kind: SessionPlanStopKind;
  /** Display / geocode label from Gemini */
  label: string;
  /** Absolute arrive-by deadline (epoch ms), if any */
  arriveByMs: number | null;
  /** Optional lat/lng once resolved */
  lat: number | null;
  lng: number | null;
  /** Semantic place types for dynamic stops (OSM/Google categories) */
  placeTypes: string[];
  /** Raw shopping / need items (for speech & shopping tasks) */
  items: string[];
  done: boolean;
};

export type SessionPlan = {
  id: string;
  createdAtMs: number;
  /** Free-roam until leave-by */
  freeRoam: boolean;
  /** When buffer hits zero → Modul 3 takes over */
  leaveByMs: number | null;
  /** Soft buffer minutes Gemini suggested (or default) */
  bufferMinutes: number;
  /** Tags boosted in Modul 1 relevance while free-roaming */
  boostPlaceTypes: string[];
  stops: SessionPlanStop[];
  /** User-facing confirmation (Gemini-generated) */
  confirmSpeech: string;
  /** Active until deadline fired or cleared */
  active: boolean;
  deadlineFired: boolean;
  /**
   * Planung für später: gesamte Tour speichern, noch nicht aktiv steuern.
   * activateAtMs = wann Findus den Plan wieder aufgreifen soll.
   */
  savedForLater?: boolean;
  activateAtMs?: number | null;
};

export type CompoundPlanParseResult = {
  isCompound: boolean;
  freeRoam: boolean;
  bufferMinutes: number;
  confirmSpeech: string;
  stops: Array<{
    kind: SessionPlanStopKind;
    label: string;
    /** ISO local time "HH:MM" or null */
    arriveByLocal: string | null;
    placeTypes: string[];
    items: string[];
  }>;
};
