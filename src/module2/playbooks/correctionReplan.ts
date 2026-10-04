/**
 * User correction → replan hint + playbook candidate (P6).
 */

import type { LearnedRule } from '../../types/learnedRules';
import type { PlaybookCandidate } from './playbookTypes';
import { evaluatePlaybookQuality } from './qualityGate';

export function replanHintFromCorrection(rule: LearnedRule): string {
  const exp = rule.expect?.length ? `Erwarte: ${rule.expect.join(', ')}.` : '';
  const av = rule.avoid?.length ? `Vermeide: ${rule.avoid.join(', ')}.` : '';
  const base = rule.summary?.trim() || 'Korrektur beachten.';
  return [base, exp, av].filter(Boolean).join(' ');
}

export function playbookCandidateFromCorrection(
  rule: LearnedRule,
  opts?: { uniqueContributors?: number; hasBookingLink?: boolean },
): PlaybookCandidate {
  const candidate: PlaybookCandidate = {
    situationKey: `corr_${rule.id}`,
    intentFamily: rule.intentFamily,
    tags: rule.tags ?? [],
    expect: rule.expect ?? [],
    avoid: rule.avoid ?? [],
    summary: rule.summary || 'Korrektur-Struktur',
    source: 'correction',
    version: 1,
    sourceLayer: 'learned',
    shadow: true,
    status: 'shadow',
    eventCount: 1,
    uniqueContributors: opts?.uniqueContributors ?? 1,
    hasEvidence: Boolean(rule.summary?.trim()),
    hasBookingLink: opts?.hasBookingLink === true,
  };
  const gate = evaluatePlaybookQuality({
    ...candidate,
    uniqueContributors: Math.max(
      candidate.uniqueContributors,
      opts?.uniqueContributors ?? 1,
    ),
    hasBookingLink:
      candidate.hasBookingLink ||
      (rule.expect ?? []).includes('booking_url'),
  });
  if (gate.ok) candidate.status = 'pending';
  return candidate;
}
