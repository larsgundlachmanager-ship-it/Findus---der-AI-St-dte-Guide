/**
 * Kaltstart → Settled-Karte (Ziel: fertig liegen, kein Dauer-Nachladen).
 *
 * Kern ≤5 s: Display-Extract + Places + GPS.
 * Danach: still — Reload nur bei Pan ≥ RECLIP_M / Stadtwechsel / Nav.
 */

/** Orte sofort nach Extract-Ready — Pin-Index ist schon warm. */
export const HOME_MAP_PLACES_AFTER_EXTRACT_MS = 0;

/** Gebäude/Hausnummern nach Core-Straßen (Zwei-Phasen-Paint). */
export const HOME_MAP_BUILDINGS_AFTER_CORE_MS = 320;

/** Welt-GeoJSON (~5 MB) einmal nach erstem Straßen-Paint. */
export const HOME_MAP_WORLD_AFTER_CORE_MS = 550;

/** Footprints einmal nach Kern — kein Ring-Ladder. */
export const HOME_MAP_FOOTPRINTS_AFTER_MS = 2_400;

/** Einmaliger Near-User-Warmup (kein 2/10-km-Expand). */
export const HOME_MAP_WARMUP_RINGS_AFTER_MS = 3_200;

/** Regional DE/EU erst wenn kein Stadt-Extract — Boot-Delay. */
export const HOME_MAP_REGIONAL_AFTER_MS = 5_000;

/**
 * Places neu zeichnen erst wenn Viewport-Mitte so weit gewandert ist.
 * Kleiner als Extract-RECLIP (1.4 km): Pins folgen Pan etwas früher, ohne Zitter-Churn.
 */
export const HOME_MAP_PLACES_REINJECT_MIN_M = 900;

/** Zoom-Delta (Stufen), ab dem Places trotzdem neu. */
export const HOME_MAP_PLACES_REINJECT_ZOOM = 0.6;
