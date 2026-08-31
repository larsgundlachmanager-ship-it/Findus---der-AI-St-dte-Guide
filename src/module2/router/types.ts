/**
 * Manager-Turn (Call-1) — LLM-Analyse: Route, Session, Bridge, Tasks.
 */

import type { Module2ActionButton } from '../types';
import type { TurnFrame } from './turnFrame';

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
  /** Chat-first: lane after allowlist */
  chatLane?: 'chat' | 'nav' | 'm1' | 'plan' | 'pitch';
  needsResearch?: 'quick' | 'pack' | 'deep';
  personaVariant?: 'default' | 'family_kids' | 'party_nightlife' | 'solo_adult';
  nearestBlueprint?: string | null;
  intents?: Array<{
    id?: string;
    lane: 'chat' | 'nav' | 'm1' | 'plan' | 'pitch';
    blueprintId: string | null;
    brief: string;
    dependsOn?: string | null;
  }>;
  /** Call-1 Auftrag: Stadt, Zeiten, Worker. Worker führen aus, legen nicht neu aus. */
  frame?: TurnFrame;
  /** Bridge bereits während Call-1-Stream gesprochen */
  bridgeSpokenEarly?: boolean;
  /** Hybrid researchBudgetSec aus Call-1 bridgeMeta */
  researchBudgetSec?: number;
  topicScope?: {
    mode: 'new' | 'followup';
    turnsForCall2: number;
    inheritLiveInventory?: boolean;
  };
  cityScope?: {
    cityId: string | null;
    researchCity: string | null;
    packPolicy: 'use_local' | 'require_download' | 'live_bootstrap' | 'none';
  };
  memoryPolicy?: {
    shortTerm: boolean;
    longTerm: boolean;
  };
  /** Call-1 Handoff-Ziel (reisebuero, m5_plan, …) */
  handoff?: string | null;
  /**
   * Ein Backend pro Turn — Call 1 entscheidet, Code dispatcht nur.
   * @see call1Dispatch.ts
   */
  execution?:
    | 'chat_lane'
    | 'pitch_module'
    | 'flight_advisor'
    | 'plan_module'
    | 'plan_walkthrough'
    | 'tour_module'
    | 'events_research'
    | 'nav_execute'
    | 'm1_poi'
    | 'memory'
    | 'task_fanout'
    | 'reisebuero';
  /** Kurzauftrag für Call-2-Synthese (aus Call-1, nicht Code) */
  call2Brief?: string | null;
  festTypeHint?: string | null;
  bookingPlatformHint?: string | null;
  mustHaves?: string[];
  /**
   * Call-1 Ranking-Kriterien (key/role/weight) — keine Venue-Punkte.
   * Backend rankt Shortlist Top-5 danach.
   */
  criteria?: Array<{
    key: string;
    role: 'must' | 'nice' | 'soft';
    weight: number;
  }>;
  needsBlockingChoice?: boolean;
  authorIntent?: string | null;
};

export type ManagerTaskResult = {
  task: ManagerTask;
  status: 'ok' | 'timeout' | 'error' | 'skipped';
  draftText: string;
  bullets: string[];
  buttons: Array<{
    id: string;
    label: string;
    url?: string;
    pending?: boolean;
    payload?: Module2ActionButton['payload'];
  }>;
  meta?: Record<string, unknown>;
  /** Durchgereicht von Fact-Lane (z. B. system / Live-Chat). */
  agent?: string;
  elapsedMs: number;
};
