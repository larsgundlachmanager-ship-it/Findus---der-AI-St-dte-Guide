/**
 * Hands-Free Nav Core — shared types (SSOT for reboot pipeline).
 */

import type { NavWaypoint, TransportMode } from '../navigationTypes';

export type HandsFreeRouteSnapshot = {
  distanceM: number;
  etaMin: number;
  /** Profile average until 1 km, then cruise. */
  paceSource: 'profile' | 'user_cruise';
  lightBufferMin: number;
  waypoints: NavWaypoint[];
  travelMode: 'walking' | 'bicycling' | 'transit';
};

export type CuePhase = 'warm' | 'warn' | 'final' | 'confirm' | 'reassure';

export type ScheduledCue = {
  phase: CuePhase;
  waypointIndex: number;
  text: string;
  /** Distance along route at which speaking should START. */
  speakStartDistanceM: number;
  /** Estimated TTS duration seconds. */
  speechSec: number;
};

export type PaceSample = {
  atMs: number;
  speedMps: number;
  moving: boolean;
};

export type HandsFreeTickContext = {
  lat: number;
  lng: number;
  speedMps: number | null;
  headingDeg: number | null;
  transportMode: TransportMode;
  remainingRouteM: number;
  distanceToNextTurnM: number;
  nextTurnManeuver: string | null;
  nextTurnLandmark: string | null;
  nextTurnWaypointIndex: number;
  onRoute: boolean;
  screenInteractive: boolean;
  pocketLikely: boolean;
};
