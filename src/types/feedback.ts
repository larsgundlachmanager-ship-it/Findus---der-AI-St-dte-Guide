import type { QuickActionPayload, QuickActionType } from './concierge';

export type QuickActionLite = {
  type: QuickActionType;
  label: string;
  payload: Partial<QuickActionPayload>;
};

export type FindusActionsTriggeredRound = {
  atMs: number;
  generated: QuickActionLite[];
  clicked: QuickActionLite[];
};

export type NavWaypointLite = {
  lat: number;
  lng: number;
  maneuver?: string | null;
  roadName?: string | null;
  landmark?: string | null;
  cue?: string | null;
  instruction?: string | null;
  isStation?: boolean;
  stationName?: string | null;
};

export type NavUserGpsFix = {
  lat: number;
  lng: number;
  atMs: number;
};

export type NavExecutionTracking = {
  nav_active_atMs: number;
  nav_target_coordinates: { lat: number; lng: number } | null;
  nav_waypoints_generated: NavWaypointLite[];
  nav_user_gps_track: NavUserGpsFix[];
  /**
   * nav_audio_cues_success:
   * - true, wenn mindestens ein Cue erfolgreich abgespielt wurde
   * - false, wenn alle Cues in der Session fehlgeschlagen sind
   */
  nav_audio_cues_success: boolean;
  nav_audio_cues_success_count: number;
  nav_audio_cues_failed_count: number;
  nav_audio_cues_errors: string[];
};

/** Compact Concierge snapshot for Judge before/after. */
export type JudgeOutputSnapshot = {
  speechText: string;
  cardTitle?: string;
  visualBullets: string[];
  quickActions: QuickActionLite[];
};

/**
 * One Law- & Action-Button-Judge run in the rolling 10-min telemetry window.
 * Used to see which intents/prompts need the most corrections.
 */
export type JudgeTelemetryEvent = {
  atMs: number;
  judge_executed: boolean;
  /** Broken law / guard IDs that were repaired (e.g. LAW_BAD_BUTTON_PAYLOAD). */
  judge_corrections_made: string[];
  /** Pass-2 (or prebuilt) state before Judge. */
  raw_pass2_output: JudgeOutputSnapshot;
  /** State after Judge (buttons + optional LLM repair). */
  repaired_output: JudgeOutputSnapshot;
  /** Optional context for filtering in feedback analysis. */
  user_text_preview?: string;
  skipped?: boolean;
  skip_reason?: string;
  llm_repaired?: boolean;
};

/** Rolling telemetry snapshot attached to each feedback upload. */
export type FeedbackTelemetrySnapshot = {
  llm_prompts: string[];
  llm_responses: string[];
  ui_states: string[];
  last_actions: string[];

  /** Raw STT transcript before any trim/correction pipeline. */
  user_speech_exact: string[];
  /** Prepared text that was sent into the TTS pipeline. */
  findus_speech_exact: string[];

  /**
   * Generated concierge button sets and which action(s) the user actually clicked.
   * (We only log user clicks; auto-start actions are captured via nav tracking.)
   */
  findus_actions_triggered: FindusActionsTriggeredRound[];

  /** Deep nav execution tracking (only while/after navigation was active recently). */
  nav_execution_tracking: NavExecutionTracking | null;

  /**
   * Law- & Action-Button-Judge Läufe (rolling 10 min).
   * Zeigt welche Intents/Prompts oft Korrekturen brauchen.
   */
  judge_passes: JudgeTelemetryEvent[];
};

/** Single feedback record in master_feedback.json. */
export type FeedbackRecord = {
  feedback_id: string;
  timestamp: string;
  user_name: string;
  issue_description: string;
  desired_behavior: string;
  telemetry_10min: FeedbackTelemetrySnapshot;
};

/** Local draft before cloud upload. */
export type LocalFeedbackEntry = {
  feedbackId: string;
  timestamp: string;
  userName: string;
  issueDescription: string;
  desiredBehavior: string;
  telemetryJson: string;
  uploaded: 0 | 1;
};
