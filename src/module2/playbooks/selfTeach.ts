/**
 * Novel success → playbook candidate (no APK codegen) — P6.
 */

import type { LearnedRule } from '../../types/learnedRules';
import type { PlaybookCandidate } from './playbookTypes';
import { evaluatePlaybookQuality } from './qualityGate';

export function buildCandidateFromNovelSuccess(opts: {
  userText: string;
  intentFamily: LearnedRule['intentFamily'];
  expect: LearnedRule['expect'];
  avoid: LearnedRule['avoid'];
  summary: string;
  hadEvidence?: boolean;
  hadBookingLink?: boolean;
  uniqueContributors?: number;
}): PlaybookCandidate {
  const candidate: PlaybookCandidate = {
    situationKey: `novel_${Date.now().toString(36)}`,
    intentFamily: opts.intentFamily,
    tags: [],
    expect: opts.expect,
    avoid: opts.avoid,
    summary: opts.summary,
    source: 'novel_success',
    version: 1,
    sourceLayer: 'shadow',
    shadow: true,
    status: 'shadow',
    eventCount: 1,
    uniqueContributors: opts.uniqueContributors ?? 1,
    hasEvidence: opts.hadEvidence === true,
    hasBookingLink: opts.hadBookingLink === true,
  };
  const gate = evaluatePlaybookQuality(candidate);
  if (gate.ok) candidate.status = 'pending';
  return candidate;
}

export async function enqueuePlaybookCandidateFromSuccess(
  candidate: PlaybookCandidate,
): Promise<void> {
  if (candidate.status === 'rejected') return;
  try {
    const { enqueueBetaSituationFromRule } = await import('../../services/memory/betaSituationQueue');
    await enqueueBetaSituationFromRule({
      rule: {
        id: candidate.situationKey,
        scope: 'user',
        intentFamily: candidate.intentFamily,
        tags: candidate.tags,
        expect: candidate.expect,
        avoid: candidate.avoid,
        summary: candidate.summary,
        strength: candidate.sourceLayer === 'owner_gold' ? 0.92 : 0.78,
        hitCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      correctionText: candidate.summary,
      priorUserText: null,
    });
  } catch {
    /* soft — queue optional in tests */
  }
}
