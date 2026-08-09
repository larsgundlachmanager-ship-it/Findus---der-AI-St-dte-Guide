/**
 * Findus Job Contracts — Absicht → Pflicht-Paket (nicht 400 Scripts).
 * SSOT für Classifier, Bridge, Completeness, Speech-Budget, Fast/Slow-Lane.
 */

import type { AgentIntent } from '../types';

/** Die ~22 Job-Typen (400 Touristenfragen kollabieren hierhin). */
export type FindusJobId =
  | 'nav_route'
  | 'transit_live'
  | 'mobility_rent'
  | 'taxi_rideshare'
  | 'parking_ev'
  | 'dining_open'
  | 'dining_hard_match'
  | 'stay_search'
  | 'luggage_practical'
  | 'emergency_care'
  | 'safety_lost'
  | 'friction_now'
  | 'sight_recommend'
  | 'poi_identify'
  | 'museum_theme'
  | 'tonight_live'
  | 'nightlife_vibe'
  | 'shopping_errand'
  | 'activity_sport'
  | 'weather_outfit'
  | 'day_plan_budget'
  | 'fact_number'
  | 'smalltalk_general';

export type CommitmentStage = 'exploring' | 'committed' | 'urgent';

/** Fakten-Keys für Completeness (Heuristik auf Draft/Meta/Buttons). */
export type JobFactKey =
  | 'concrete_place'
  | 'venue_options'
  | 'hard_match_evidence'
  | 'showtimes_future'
  | 'price_eur'
  | 'ticket_or_info_url'
  | 'route_or_nav'
  | 'transit_connection'
  | 'open_now_or_hours'
  | 'phone_or_nav'
  | 'emergency_right_facility'
  | 'number_answer'
  | 'weather_or_outfit'
  | 'booking_deep_link'
  | 'activity_fit'
  | 'alternative_offered';

export type JobActionKey =
  | 'START_NAVIGATION'
  | 'OPEN_URL'
  | 'DIAL_PHONE'
  | 'BOOK_STAY22'
  | 'BOOK_UBER'
  | 'SHOW_MORE';

export type JobContract = {
  id: FindusJobId;
  /** Primärer Modul-2-Agent */
  agentIntent: AgentIntent;
  label: string;
  /** Max Zeichen Haupt-Speech (nach Bridge) */
  speechBudgetChars: number;
  commitmentDefault: CommitmentStage;
  /** Sofort / Fast Lane */
  fastFacts: JobFactKey[];
  /** Darf nachgeliefert werden */
  slowFacts: JobFactKey[];
  /** Buttons die idealerweise da sind (soft wenn Slow noch läuft) */
  requiredActions: JobActionKey[];
  /** Bridge-Stil */
  bridgeMode: 'cheer' | 'motivate' | 'calm_help' | 'fact_ack' | 'urgency';
};

export type JobClassification = {
  jobId: FindusJobId;
  contract: JobContract;
  commitment: CommitmentStage;
  mustHaves: string[];
  confidence: number;
  /** Parallel-Jobs bei Kombi-Fragen */
  secondaryJobIds: FindusJobId[];
};

export type CompletenessIssue = {
  key: JobFactKey | JobActionKey;
  lane: 'fast' | 'slow';
  severity: 'must' | 'should';
  note: string;
};

export type CompletenessReport = {
  jobId: FindusJobId;
  ok: boolean;
  missing: CompletenessIssue[];
  /** UI: Buttons die noch nachladen dürfen */
  pendingActionHints: JobActionKey[];
};
