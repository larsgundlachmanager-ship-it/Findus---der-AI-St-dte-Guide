/**
 * Manager-Turn (Call-1) — LLM-Analyse: Route, Session, Bridge, Tasks.
 */

export type ManagerRoute =
  | 'm1_poi'
  | 'm3_nav_start'
  | 'm3_nav_query'
  | 'm5_plan'
  | 'memory'
  | 'blueprint'
  | 'smalltalk';

export type ManagerSession = 'new' | 'continue' | 'resume';

export type ManagerPace = 'instant' | 'standard' | 'cover';

export type ManagerLanePlan =
  | 'fast_only'
  | 'fast_plus_silent_slow'
  | 'fast_then_spoken_slow';

export type ManagerTaskPriority = 'fast' | 'silent_slow' | 'spoken_slow';

export type ManagerTaskLane =
  | 'weather'
  | 'pack'
  | 'places'
  | 'hours'
  | 'walk_eta'
  | 'web_events'
  | 'grocery_on_way'
  | 'dining'
  | 'cinema'
  | 'amenity'
  | 'parking'
  | 'combo'
  | 'knowledge'
  | 'instagram'
  | 'other';

export type ManagerTask = {
  id: string;
  lane: ManagerTaskLane;
  brief: string;
  priority: ManagerTaskPriority;
  thinkAhead?: boolean;
  /** false → never announce latency in bridge */
  affectsSpeech: boolean;
  filters?: Record<string, string | number | boolean>;
  searchHints?: string[];
};

export type ManagerAnalysis = {
  intentSummary: string;
  route: ManagerRoute;
  blueprintId: string | null;
  blueprintStage: string | null;
  session: ManagerSession;
  threadMatchId: string | null;
  subject: string | null;
  bridge: string | null;
  lanePlan: ManagerLanePlan;
  pace: ManagerPace;
  bridgeMaxWords: number;
  fastDeadlineMs: number;
  latencyHintSec: number | null;
  tasks: ManagerTask[];
  openLoops: string[];
  nameAllowed: boolean;
  /** Job hint for legacy fact lanes / contracts */
  jobHint: string | null;
  /** Barge-in correction merge */
  isCorrection?: boolean;
};

export type ManagerTaskResult = {
  task: ManagerTask;
  status: 'ok' | 'timeout' | 'error' | 'skipped';
  draftText: string;
  bullets: string[];
  buttons: Array<{ id: string; label: string; url?: string; pending?: boolean }>;
  meta?: Record<string, unknown>;
  elapsedMs: number;
};
