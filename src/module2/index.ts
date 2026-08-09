/**
 * Modul 2 Greenfield — öffentliche API.
 */

export { runModule2Pipeline } from './pipeline/runPipeline';
export { readRucksackSync, useRucksackStore, anchorCoords } from './rucksack/rucksackStore';
export {
  startRucksackWriters,
  stopRucksackWriters,
  refreshRucksackWeather,
} from './rucksack/rucksackWriters';
export {
  enqueueSpeech,
  bargeInFlush,
  stopVoiceOnUserTap,
  getSpeechQueueDebug,
} from './speech/speechQueue';
export { chunkTextForTts, TTS_CHUNK_MAX } from './speech/ttsChunker';
export {
  useFuturePlanStore,
  readFuturePlanSnapshot,
} from './timeline/futurePlanState';
export {
  useHistoricalTimelineStore,
  readHistoricalSnapshot,
} from './timeline/historicalTimelineState';
export {
  hydratePlanTimeline,
  startPlanTimelinePersistWatchers,
} from './timeline/planPersistence';
export {
  requestOpenPlanCalendar,
  requestClosePlanCalendar,
  usePlanCalendarUiStore,
} from './timeline/planCalendarUiStore';
export {
  startBackgroundTriggerEngine,
  stopBackgroundTriggerEngine,
  registerNativeGeofence,
  stampModule1Visit,
} from './background/triggerEngine';
export {
  MODULE2_LAYERED_LAWS,
  lawsForLayer,
  agentPromptLaws,
} from './laws/lawLayers';
export {
  runPlanningModule,
  isPlanningModuleActive,
  onPlanningModuleClosed,
  handlePlanCalendarDirect,
  overrideOpenWishFromStop,
} from './planning/runPlanningModule';
export { PRISDORF_FALLBACK } from './types';
export type {
  PipelineTurnResult,
  PipelineTask,
  AgentIntent,
} from './types';
export type { RucksackState } from './rucksack/rucksackStore';
export {
  classifyJob,
  getJobContract,
  JOB_CONTRACTS,
  judgeJobCompleteness,
  bridgeLineForJob,
} from './jobs';
export type { FindusJobId, JobClassification, CompletenessReport } from './jobs';
export {
  REBOOT_MAX_PARALLEL_FACT_JOBS,
  REBOOT_MANAGER_MODULES,
  FINDUS_REBOOT_MANAGER_THINK_AHEAD_BLOCK,
  moduleForPrimaryJob,
  buildManagerTurn,
  shouldSuppressBridge,
} from './reboot';
export type {
  ManagerModule,
  RebootRouterOut,
  RebootFactBundle,
  RebootSynthesisOut,
  RebootContextRucksack,
} from './reboot';
