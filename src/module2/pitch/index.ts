/**
 * Auswahl-Pitch Modul — öffentliche API.
 */

export type {
  PitchRequest,
  PitchResult,
  PitchSearchMode,
  PitchKind,
  PitchWish,
  PitchOptionCard,
  PitchDeepAppend,
  PitchPrefSlice,
} from './types';

export { runPitchModule } from './runPitchModule';
export {
  detectCityBestIntent,
  detectPitchKind,
  resolveSearchMode,
  resolveVisitAtMs,
  buildPrefSliceForPitch,
  parseWishesFromText,
  mergeProfileDietIntoWishes,
  dietLabelsFromProfile,
  buildPitchParentBridge,
  clampBridgeWords,
} from './parentBrief';
export {
  scoreDetourOnRoute,
  scoreDetourLandmark,
  hereNowPrio,
  DETOUR_PRIO_BANDS_MIN,
  HERE_NOW_RINGS_M,
} from './detourHeuristic';
export {
  useLivePitchStore,
  publishPitchResult,
  publishPitchToTimeline,
  publishPitchToLive,
} from './publishPitchUi';
export {
  selectPitchOption,
  getPitchSession,
  clearPitchSession,
} from './pitchDeepAppend';
export { buildPitchActions } from './pitchActions';
export { filterAndRank, filterAndRankPool } from './wishFilterRank';
export { shouldHandoffToPitchModule } from './shouldHandoffPitch';
export {
  looksLikePicnicQuery,
  isPicnicUnsuitableVenue,
} from './picnicIntent';
export { researchPitchAsAgentResult } from './pitchFactLane';
export {
  buildPitchRequestFromText,
  buildPitchRequestFromWish,
} from './buildPitchRequest';
export {
  parseCall1Criteria,
  mergeCall1Criteria,
  formatCall1CriteriaForPrompt,
  visitAtMsFromCall1When,
} from './call1Criteria';
export type { Call1Criterion, Call1CriterionRole } from './call1Criteria';
