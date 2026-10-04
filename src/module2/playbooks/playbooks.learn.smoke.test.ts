/**
 * P6 playbooks: match, gate, facade, correction replan.
 * Run: npx tsx src/module2/playbooks/playbooks.learn.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { matchPlaybooksBeforeTurn, formatPlaybookPromptBlock } from './matchPlaybooks';
import { evaluatePlaybookQuality, shouldShadowPromote } from './qualityGate';
import { playbookCandidateFromCorrection, replanHintFromCorrection } from './correctionReplan';
import { buildCandidateFromNovelSuccess } from './selfTeach';
import type { PlaybookCandidate } from './playbookTypes';

{
  const matches = matchPlaybooksBeforeTurn({
    userText: 'günstige Flüge von Hamburg nach Split im März',
    intentFamily: 'booking',
    catalog: [
      {
        situationKey: 'bp_flight',
        intentFamily: 'booking',
        tags: ['flug'],
        expect: ['booking_url', 'answer_first'],
        avoid: [],
        summary: 'Flugwunsch: Links zuerst, dann Fenster',
        source: 'manual',
        version: 1,
        sourceLayer: 'owner_gold',
      },
    ],
  });
  assert.ok(matches.length >= 1, 'match playbook');
  assert.ok(formatPlaybookPromptBlock(matches).includes('PLAYBOOK'), 'prompt block');
}

{
  const ownerOk: PlaybookCandidate = {
    situationKey: 'o1',
    intentFamily: 'dining',
    tags: [],
    expect: ['prices'],
    avoid: ['long_history'],
    summary: 'Preise vorne',
    source: 'manual',
    version: 1,
    sourceLayer: 'owner_gold',
    status: 'shadow',
    eventCount: 1,
    uniqueContributors: 1,
    hasEvidence: true,
    hasBookingLink: true,
  };
  assert.equal(evaluatePlaybookQuality(ownerOk).ok, true, 'owner passes gate');
  assert.equal(shouldShadowPromote({ ...ownerOk, status: 'shadow' }), true);

  const crowdFail: PlaybookCandidate = {
    ...ownerOk,
    sourceLayer: 'shadow',
    uniqueContributors: 1,
    hasEvidence: false,
    hasBookingLink: false,
    status: 'shadow',
  };
  assert.equal(evaluatePlaybookQuality(crowdFail).ok, false, 'crowd gate');
}

{
  const rule = {
    id: 'lr1',
    scope: 'user' as const,
    intentFamily: 'dining' as const,
    tags: [],
    expect: ['prices' as const, 'booking_url' as const],
    avoid: ['long_history' as const],
    summary: 'Erst Preise, keine Historie',
    strength: 0.8,
    hitCount: 0,
    createdAt: '',
    updatedAt: '',
  };
  const hint = replanHintFromCorrection(rule);
  assert.match(hint, /Preise|Historie/i);
  const cand = playbookCandidateFromCorrection(rule, { hasBookingLink: true });
  assert.ok(
    cand.status === 'pending' || cand.status === 'shadow',
    'correction candidate staged',
  );
}

{
  const novel = buildCandidateFromNovelSuccess({
    userText: 'x',
    intentFamily: 'events',
    expect: ['tickets'],
    avoid: [],
    summary: 'Event mit Ticket-Link',
    hadEvidence: true,
    hadBookingLink: true,
    uniqueContributors: 3,
  });
  assert.equal(novel.status, 'pending');
}

console.log('playbooks.learn.smoke.test.ts: ok');
