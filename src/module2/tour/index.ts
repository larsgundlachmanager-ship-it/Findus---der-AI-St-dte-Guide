/**
 * Tour-Modul — öffentliche API.
 */

export type {
  TourRequest,
  TourResult,
  TourMode,
  TourStopPlan,
  TourLegPlan,
  TourCandidate,
  TourUiLayout,
  TourEndAnchor,
  TourLiveMeta,
} from './types';

export { runTourModule, mergeDurationFollowUp } from './runTourModule';
export {
  shouldHandoffToTourModule,
} from './shouldHandoffTour';
export {
  buildTourRequestFromText,
  buildTourRequestFromWish,
  buildTourRequestFromSegment,
} from './buildTourRequest';
export {
  detectTourMode,
  shouldPreferTourOverPitch,
  parseDurationMin,
  parseDistanceKm,
  needsDurationAsk,
  clampBridgeWords,
  buildTourParentBridge,
} from './parentBrief';
export { useLiveTourStore, publishTourResult } from './tourSpeech';
export { mirrorTourToTimeline } from './mirrorTourToTimeline';
export {
  startTourLiveSupervisor,
  stopTourLiveSupervisor,
  handleTourSoftReplanAnswer,
} from './tourLiveSupervisor';
export { TOUR_MAX_ATTEMPTS, TOUR_BUFFER_MIN } from './exactValidate';
export { filterAndRankCandidates } from './filterRank';
export { coarseStopTour } from './coarsePlan';
