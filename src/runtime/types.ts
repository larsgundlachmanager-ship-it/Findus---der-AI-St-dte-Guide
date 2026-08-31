/**
 * Yorro Runtime — shared types (Phase 0).
 * SSOT for module state, interruption policy, cooldowns.
 */

/** Three independent core modules + orchestrator overlay. */
export type RuntimeModule = 'explore' | 'questions' | 'navigation' | 'idle';

/** Who initiated the current audio / focus shift. */
export type RuntimeTriggerKind =
  | 'gps_poi'
  | 'user_voice'
  | 'user_text'
  | 'nav_turn'
  | 'nav_presence'
  | 'proactive'
  | 'system';

/**
 * GPS triggers queue behind TTS; user voice interrupts immediately.
 */
export type InterruptionPolicy = 'queue' | 'interrupt';

export type CooldownKey =
  | 'after_user_question'
  | 'during_navigation'
  | 'after_poi_complete'
  | 'after_speech';

/** Cooldown durations (ms).
 * after_user_question = 60s → Modul 1 pausiert, während der User eine Frage stellt/beantwortet bekommt.
 * after_poi_complete = 10s Pause nach Hauptpunkt (Masterbook: Stille nach M1).
 * after_speech = Buchhaltung nach TTS; GPS-Gate nutzt das nicht (Wegweiser→Haupt via Policy).
 */
export const RUNTIME_COOLDOWNS_MS: Record<CooldownKey, number> = {
  after_user_question: 60_000,
  during_navigation: 5_000,
  after_poi_complete: 10_000,
  after_speech: 8_000,
};

export type RuntimeContext = {
  module: RuntimeModule;
  isSpeaking: boolean;
  isListening: boolean;
  isGenerating: boolean;
  navActive: boolean;
  /** Last time a cooldown bucket was set (epoch ms). */
  cooldownUntil: Partial<Record<CooldownKey, number>>;
  /** GPS triggers waiting while TTS finishes. */
  queuedGpsTriggerId: number | null;
  online: boolean;
};

export type GpsSample = {
  lat: number;
  lng: number;
  speedMs?: number | null;
  headingDeg?: number | null;
  accuracyM?: number | null;
  timestampMs?: number;
};

export type GpsPollPolicy = {
  intervalMs: number;
  reason: string;
};

export type RelevanceVerdict = 'allow' | 'skip' | 'soft_pitch';

/** POI side — extensible metadata bag, no hardcoded categories. */
export type PoiSchema = {
  id: number;
  tags: string[];
  category: string;
  /** Open key-value attributes (cuisine, religion, meal_slot, …). */
  attributes: Record<string, string | number | boolean | null>;
};

/** User side — profile + live context for schema matching. */
export type UserRelevanceContext = {
  /** experiencePrefs, dietary, mobility, persona keys — open map. */
  preferences: Record<string, string | boolean | number | null>;
  /** Learned skip patterns from behavior (not hardcoded vocab). */
  skipPatterns: Array<{ tagKeys: string[]; confidence: number }>;
  /** Session-plan semantic boosts (shopping / needs) — highest priority while free-roaming. */
  boostTagKeys?: string[];
  /** Recent activity slots — e.g. last meal timestamp. */
  activity: Record<string, number | string | null>;
  partySize?: number | null;
};

export type RelevanceResult = {
  verdict: RelevanceVerdict;
  /** Machine reason code for logging/tests — not user-facing text. */
  reasonCode: string;
  score: number;
};

export type OrchestratorDecision =
  | { action: 'run_gps_trigger'; poiId: number }
  | { action: 'queue_gps_trigger'; poiId: number }
  | { action: 'skip_gps_trigger'; reason: string; remainingMs?: number }
  | { action: 'interrupt_for_user' }
  | { action: 'noop'; reason: string };

export const OFFLINE_TEST_CITY_ID = 'prisdorf';

export const CURRENCY_RULE = 'EUR' as const;
