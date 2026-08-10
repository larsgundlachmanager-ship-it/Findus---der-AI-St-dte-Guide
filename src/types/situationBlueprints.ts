/**
 * Beta Situation Blueprints — Crowd-Korrekturen → Product-Struktur.
 * Doctrine: nur Struktur/Constraints, keine Scripts / Orts-Hardcodes.
 */

import type {
  LearnedRuleAvoid,
  LearnedRuleExpect,
  LearnedRuleIntentFamily,
} from './learnedRules';

export type SituationBlueprintStatus =
  | 'pending'
  | 'auto_ready'
  | 'promoted'
  | 'rejected';

export type BetaSituationEvent = {
  eventId: string;
  contributorHash: string;
  situationKey: string;
  intentFamily: LearnedRuleIntentFamily;
  tags: string[];
  expect: LearnedRuleExpect[];
  avoid: LearnedRuleAvoid[];
  summary: string;
  userTypeHint: {
    answerStyle?: string | null;
    diningLevel?: string | null;
    persona?: string | null;
  };
  correctionDigest: string;
  priorUserDigest?: string;
  createdAt: string;
};

export type SituationBlueprint = {
  situationKey: string;
  intentFamily: LearnedRuleIntentFamily;
  tags: string[];
  expect: LearnedRuleExpect[];
  avoid: LearnedRuleAvoid[];
  summary: string;
  source: 'auto_3plus' | 'manual' | string;
  version: number;
  updatedAt?: string;
};

export type SituationBlueprintCandidate = SituationBlueprint & {
  uniqueContributors: number;
  eventCount: number;
  status: SituationBlueprintStatus;
  sampleDigests: string[];
  promotedAt?: string | null;
  promotedBy?: string | null;
};

/** Min. verschiedene Beta-User für Auto-Promote. */
export const BETA_SITUATION_AUTO_PROMOTE_USERS = 3;
