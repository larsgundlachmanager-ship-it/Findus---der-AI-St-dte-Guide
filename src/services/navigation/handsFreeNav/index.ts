/**
 * Hands-Free Nav Core — SSOT exports.
 */

export type {
  HandsFreeRouteSnapshot,
  CuePhase,
  ScheduledCue,
  PaceSample,
  HandsFreeTickContext,
} from './types';

export {
  resetHandsFreeEta,
  noteHandsFreeEtaGps,
  getActiveDistanceM,
  isInDwell,
  resolveCruisePaceMPerMin,
  etaMinutesFromRoute,
  initialEtaFromRoutedDistanceM,
  PACE_SWITCH_ACTIVE_M,
} from './eta';

export {
  resetCueScheduler,
  estimateSpeechSec,
  speakStartDistanceM,
  findNextTurnWaypoint,
  remainingAlongWaypointsM,
  buildFinalCueText,
  buildComplexWarnText,
  buildConfirmText,
  buildReassureText,
  pickCueForTick,
  warmDistanceM,
  FINISH_BEFORE_TURN_SEC,
  COMPLEX_WARN_FOOT_M,
} from './cueScheduler';

export {
  resetHandsFreeCompass,
  pushAdaptiveHeading,
  shouldDisableCompassWatch,
} from './compass';

export {
  alignWaypointsForUserSide,
  spacingForSegmentM,
  arrowTargetFromWaypoint,
  lateralOffsetM,
  SIDEWALK_OFFSET_M,
} from './pathAlign';

export {
  fetchProgressiveRoute,
  type ProgressiveRouteResult,
} from './routeEngine';

export {
  resolveStartLandmark,
  polishAllTurnsOsmFirst,
} from './landmarks';

export { silentOsrmReroute } from './reroute';

export {
  commitHandsFreeNavStart,
  progressiveEnrichRoute,
  getLastProgressiveStartMeta,
} from './startNav';

export {
  planTransitHandsFree,
  startTransitHandsFree,
} from './transitBridge';

export { runHandsFreeReplayHarness } from './replayHarness';
export type { HarnessReport } from './replayHarness';

export {
  beginHandsFreeTickCoach,
  resetHandsFreeTickCoach,
  onHandsFreeNavTick,
} from './tickCoach';
