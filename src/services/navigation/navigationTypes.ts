export type NavMode = 'close_range' | 'routing';

export type AttentionCue = 'left' | 'right' | 'behind' | null;

/** Realtime-GPS-Bewegungsmodus (nicht Onboarding-Präferenz). */
export type TransportMode =
  | 'walk'
  | 'bicycle'
  | 'transit_bus'
  | 'transit_train';

export type NavWaypoint = {
  lat: number;
  lng: number;
  /** Google/OSM-Maneuver (turn-left, straight, …). */
  maneuver?: string | null;
  /** Straßenname am Abbiegepunkt. */
  roadName?: string | null;
  /** Sichtbare Landmarke (Laden, Kirche, Pack-POI). */
  landmark?: string | null;
  /** Fertiger Sprach-Hinweis für freihändige Navigation. */
  cue?: string | null;
  /** Roh-Anweisung aus Google Directions. */
  instruction?: string | null;
  /** true = Haltestelle (ÖPNV-Countdown). */
  isStation?: boolean;
  /** Anzeigename der Haltestelle. */
  stationName?: string | null;
};

export type NavDestination = {
  poiId: number;
  name: string;
  lat: number;
  lng: number;
  /** Arrival radius; defaults to POI radius or 10 m. */
  arrivalRadiusM: number;
  waypoints: NavWaypoint[];
  /** Explizite Haltestellen-Kette (sonst Waypoints mit isStation / alle WPs bei Transit). */
  stations?: NavWaypoint[];
};

export type PendingNavOffer = {
  poiId: number;
  name: string;
};

export type NavigationTick = {
  mode: NavMode;
  /** Distance to final destination (meters). */
  distanceToDestinationM: number;
  /** Distance to current arrow target (next waypoint or destination). */
  distanceToArrowM: number;
  /** Relative bearing: 0 = straight ahead, positive = turn right. */
  bearingRelDeg: number;
  targetName: string;
  arrowLat: number;
  arrowLng: number;
  arrived: boolean;
  turnImminent: boolean;
  transportMode: TransportMode;
  speedMs: number;
  /** Verbleibende Haltestellen inkl. Ziel (nur Transit). */
  remainingStations?: number | null;
};

/** Defaults (Fuß) — dynamisch überschrieben via transportMode thresholds. */
export const CLOSE_RANGE_M = 30;
/** Exit close-range only above this — avoids mode flicker from GPS drift. */
export const CLOSE_RANGE_EXIT_M = 38;
export const WAYPOINT_ADVANCE_M = 12;
export const ARRIVAL_FALLBACK_M = 10;
export const TURN_IMMINENT_M = 20;
export const TURN_IMMINENT_DEG = 45;
export const ATTENTION_CUE_MS = 1200;
/** Heading EMA alpha (0–1); lower = smoother arrow. */
export const HEADING_LOWPASS_ALPHA = 0.18;

/** High-frequency GPS while navigating / free-roam. */
export const GPS_REALTIME_INTERVAL_MS = 1000;
export const GPS_REALTIME_DISTANCE_M = 1;
/** Throttle while main POI audio plays (battery). */
export const GPS_THROTTLED_INTERVAL_MS = 5000;
export const GPS_THROTTLED_DISTANCE_M = 10;
