/**
 * Playbook promote gate — evidence + link + crowd≥3 or owner (P6).
 */

import { BETA_SITUATION_AUTO_PROMOTE_USERS } from '../../types/situationBlueprints';
import type { PlaybookCandidate, PlaybookQualityVerdict } from './playbookTypes';

export function evaluatePlaybookQuality(
  candidate: PlaybookCandidate,
): PlaybookQualityVerdict {
  const reasons: string[] = [];
  if (!candidate.summary?.trim()) reasons.push('missing_summary');
  if (!candidate.expect?.length && !candidate.avoid?.length) {
    reasons.push('missing_structure');
  }
  if (!candidate.hasEvidence) reasons.push('missing_evidence');
  if (!candidate.hasBookingLink) reasons.push('missing_link');
  const owner = candidate.sourceLayer === 'owner_gold' || candidate.source === 'manual';
  const crowdOk =
    candidate.uniqueContributors >= BETA_SITUATION_AUTO_PROMOTE_USERS ||
    candidate.source === 'auto_3plus';
  if (!owner && !crowdOk) reasons.push('crowd_below_3');
  return { ok: reasons.length === 0, reasons };
}

export function shouldShadowPromote(candidate: PlaybookCandidate): boolean {
  const v = evaluatePlaybookQuality(candidate);
  return v.ok && candidate.status === 'shadow';
}
