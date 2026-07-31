/**
 * Modul 5 — öffentliche API.
 */

export {
  ingestModule2IntoDayPlan,
  noteNavigationStarted,
  noteNavigationArrived,
  notePlaceLeft,
  replanForRainWindows,
  speakPlanChangeExplanation,
  formatDayPlanForPrompt,
  bootstrapModule5Today,
  importTourStopsIntoDayPlan,
  importSessionPlanIntoDayPlan,
} from './engine';

export {
  buildReverseScheduleFromDeadline,
  buildReverseScheduleFromDeadlineAsync,
  buildStayBlock,
} from './reverseScheduler';

export {
  canModule5Speak,
  scheduleModule5FollowUp,
  MODULE5_AFTER_M2_MS,
} from './module5Priority';

export {
  roundUpTo5Min,
  floorMsTo5Min,
  snapMsTo5Min,
  walkMinutesPlan,
  bikeMinutesPlan,
  bufferMinutesForKind,
  arriveByFromDeadline,
  leaveByFromArrive,
  defaultStayMinutes,
  describeCurrentPace,
} from './bufferMath';

export {
  hydratePaceProfile,
  pushPaceSample,
  getPlanWalkKmh,
  getPlanBikeKmh,
  getPlanWalkMPerMin,
  getPlanBikeMPerMin,
  formatPaceForPrompt,
  setPaceChangeListener,
  DEFAULT_WALK_KMH,
  DEFAULT_BIKE_KMH,
} from './paceProfile';

export { researchRealisticTiming } from './researchTiming';
export { refreshDayPlanTravelTimes } from './refreshTravelTimes';
export {
  resolveStayMinutesForPlace,
  recordActualDwell,
  fetchGoogleDwellRangeHint,
} from './dwellLearning';
export {
  pickLiveTransitBeforeDeadline,
  checkDeadlineTrainDelay,
} from './liveTransitPlan';

export {
  syncRainIntoDayPlan,
  fillLogisticsGaps,
} from './smartLogistics';

export {
  rememberParkedCar,
  clearParkedCar,
  getParkedCar,
  getParkedCarSync,
  ingestParkedCarFromText,
  syncParkedCarIntoDayPlan,
  parkedCarConstraintMs,
} from './parkedCar';

export {
  extractFlightCode,
  syncLiveFlightIntoDayPlan,
} from './liveFlightPlan';

export {
  registerFlightWatch,
  tickAdaptiveFlightPolls,
  stopAdaptiveFlightPolls,
} from './adaptiveFlightPoll';

export {
  startLeaveByTransitPolls,
  tickLeaveByTransitPolls,
  refreshTransitWatchesFromDayPlan,
} from './leaveByTransitPoll';

export {
  unlockWeatherPlanForUserRevert,
  canAutoRevertWeatherPlan,
  lockWeatherRainSwap,
  rainWindowsFingerprint,
  shouldWeatherStayAlert,
} from './weatherPlanHysteresis';

export {
  saveWeatherPlanSnapshot,
  restoreWeatherPlanSnapshot,
  wantsPlanSnapshotRestore,
} from './planSnapshot';

export {
  enqueueProactiveSpeech,
  summarizeProactiveBatch,
  PROACTIVE_SPEECH_BUDGET_MS,
} from './proactiveSpeechQueue';

export {
  patchFlightIntoDayPlan,
  decideFlightDelta,
} from './flightDeltaPatch';

export {
  stampTransitHardMeta,
  isTransitWatchItem,
  TRANSIT_META_TYPE,
} from './transitHardMeta';

export {
  appendPlanInput,
  getPlanInputLog,
  formatPlanInputLogForPrompt,
} from './planInputLog';
export type { PlanInputLogEntry } from './planInputLog';

export {
  dedupeDayPlanItems,
  applyDedupeToDay,
} from './dayPlanDedupe';

export {
  buildPlanTalkAfterCommit,
  ASK_TRANSIT_WALK_MIN,
} from './planTalkPolicy';
export type { PlanTalkResult } from './planTalkPolicy';

export {
  extractLongFormPlan,
  heuristicLongFormExtract,
  buildDefaultConfirmSpeech,
} from './longFormPlanExtractor';
export type {
  LongFormPlanExtract,
  LongFormExtractResult,
  LongFormBlock,
} from './longFormPlanExtractor';

export {
  processVoicePlanTranscript,
  startVoicePlanDictation,
  stopVoicePlanDictation,
  commitVoicePlanDraft,
  buildVoicePlanDiff,
  formatVoiceDraftBadges,
} from './voicePlanMode';
export type {
  VoicePlanDraft,
  VoicePlanDiffItem,
  DictationPhase,
} from './voicePlanMode';

export {
  propagatePlanDelay,
  applyNavStartActual,
  applyNavArriveActual,
  applyPlaceLeftActual,
  effectiveTimes,
} from './planVsActual';

export {
  classifyTimelineItem,
  detectConflict,
  transportEmojiForItem,
  TIMELINE_LEGEND,
} from './timelineVisual';
export type { TimelineTone, TimelineVisual } from './timelineVisual';

export {
  applyUserPlanOverrides,
  parseRejectedCategories,
  isFindusOwnedPlanItem,
  markAsFindusSuggestion,
  markAsUserRequested,
  USER_BOSS_PLAN_POLICY,
} from './userBossPlan';
export type { RejectCategory } from './userBossPlan';

export {
  buildOptimizePreview,
  acceptOptimizePreview,
  regenerateOptimizePreview,
  restoreOptimizeSnapshot,
  clearOptimizePreviewFlags,
  getOptimizeFailCount,
  resetOptimizeFailCount,
} from './optimizePreview';
export type { OptimizePreviewResult } from './optimizePreview';

export {
  buildUnifiedDayAxis,
  noteModule1PlaceOnAxis,
  formatNowLabel,
  isWishItem,
  markTourStopsAsWishes,
} from './unifiedDayAxis';
export type { AxisEntry, AxisBucket } from './unifiedDayAxis';
