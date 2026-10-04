/**
 * Playbooks — SituationBlueprint + runtime match (P6).
 */

import type { SituationBlueprint } from '../../types/situationBlueprints';
import type { LearnedRule } from '../../types/learnedRules';

export type PlaybookSource = 'owner_gold' | 'beta' | 'learned' | 'shadow';

export type PlaybookRecord = SituationBlueprint & {
  sourceLayer: PlaybookSource;
  /** Shadow = matched but not yet promoted to product pack */
  shadow?: boolean;
  uniqueContributors?: number;
  evidenceHints?: string[];
};

export type PlaybookMatch = {
  playbook: PlaybookRecord;
  score: number;
};

export type PlaybookQualityVerdict = {
  ok: boolean;
  reasons: string[];
};

export type PlaybookCandidate = PlaybookRecord & {
  status: 'pending' | 'shadow' | 'promoted' | 'rejected';
  eventCount: number;
  uniqueContributors: number;
  hasEvidence: boolean;
  hasBookingLink: boolean;
};

export type UnifiedLearnFacade = {
  rules: LearnedRule[];
  playbooks: PlaybookRecord[];
  promptBlock: string;
};
