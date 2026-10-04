/**
 * Kaltstart → Settled-Karte (Ziel: fertig liegen, kein Dauer-Nachladen).
 *
 * Near ≤5 s: ~5 km Display-Extract + Places + GPS → Splash weg.
 * Cache-Hit (Display-Snap aus Disk): kein Full-Parse beim Boot.
 * App-Kill: GPS + Display-Snap flush → nächster Start aus Cache.
 * Danach: Stadt-Vollload; bei >60 s Zwischen-Release; Final inkl. EU.
 * Reload nur bei Stadtwechsel / Nav — nicht bei Pan in derselben Stadt.
 */

import {
  MAP_LIGHT_PINS_GRACE_MS,
  MAP_POLISH_TOUCH_GRACE_MS,
} from '../boot/interactiveBootGate';

/** Orte sofort nach Extract-Ready — Pin-Index ist schon warm. */
export const HOME_MAP_PLACES_AFTER_EXTRACT_MS = 0;

/** Gebäude nach Core-Straßen (Zwei-Phasen-Paint). */
export const HOME_MAP_BUILDINGS_AFTER_CORE_MS = 320;

/**
 * Welt/EU erst mit Stadt-Final-Release — dann einmal mit Stadt-Voll-Extract.
 * Konstante = Basis für Safety-Fallback (×3 in NativeHomeMapView).
 */
export const HOME_MAP_WORLD_AFTER_CORE_MS = 60_000;

/** Footprints einmal nach Kern — kein Ring-Ladder. */
export const HOME_MAP_FOOTPRINTS_AFTER_MS = 2_400;

/** Einmaliger Near-User-Warmup (kein 2/10-km-Expand). */
export const HOME_MAP_WARMUP_RINGS_AFTER_MS = 3_200;

/** Regional DE/EU erst wenn kein Stadt-Extract — Boot-Delay. */
export const HOME_MAP_REGIONAL_AFTER_MS = 5_000;

/**
 * Places neu zeichnen erst wenn Viewport-Mitte so weit gewandert ist.
 * Kleiner als Extract-RECLIP: Pins folgen Pan etwas früher, ohne Zitter-Churn.
 */
export const HOME_MAP_PLACES_REINJECT_MIN_M = 900;

/** Zoom-Delta (Stufen), ab dem Places trotzdem neu. */
export const HOME_MAP_PLACES_REINJECT_ZOOM = 0.6;

/**
 * Nach Finger-hoch: kurze Ruhe bevor Orte/ShapeSource (Fling ausklingen).
 * Kurz halten — Icons zack, nicht 700+ ms Leere.
 */
export const HOME_MAP_PLACES_GESTURE_QUIET_MS = 260;

/**
 * Progressive Post-Splash-Leiter (Zeiten ab Splash-Interactive):
 * 0–~1 s — Touch/Chrome/Mic (Light-Pins noch gesperrt)
 * ~1 s — Warm Pin-Index (mapLightPins)
 * ~2 s — volle Orte (mapPolish), danach Fog/Nachbar (mapIdle)
 * Timer starten erst NACH der jeweiligen Grace — sonst Queue-Burst.
 */
export const HOME_MAP_LIGHT_PINS_AFTER_SPLASH_MS = MAP_LIGHT_PINS_GRACE_MS + 80;
export const HOME_MAP_PLACES_PAINT_AFTER_SPLASH_MS =
  MAP_POLISH_TOUCH_GRACE_MS + 120;
export const HOME_MAP_FOG_AFTER_SPLASH_MS = MAP_POLISH_TOUCH_GRACE_MS + 480;
export const HOME_MAP_NEIGHBOR_WARM_AFTER_SPLASH_MS =
  MAP_POLISH_TOUCH_GRACE_MS + 1_000;
