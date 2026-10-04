/**
 * Cruise/schedule playbook — Meta + Timeline, kein Reederei-Hardtool.
 * SSOT: docs/rfc/agent-harden-contract.md
 */

import type { PlaybookCandidate } from './playbookTypes';

/** Generisches Kreuzfahrt-/Programm-Playbook (Shadow → Gate → Promote). */
export function cruiseProgramPlaybookCandidate(opts?: {
  hadEvidence?: boolean;
  hadBookingLink?: boolean;
  uniqueContributors?: number;
}): PlaybookCandidate {
  return {
    situationKey: 'cruise::program_to_timeline_v1',
    intentFamily: 'planning',
    tags: ['cruise', 'kreuzfahrt', 'timeline', 'schedule_write'],
    expect: ['times_hours', 'answer_first', 'tickets'],
    avoid: ['vague_filler', 'permission_questions', 'fake_promises'],
    summary:
      'Kreuzfahrt/Bordprogramm: Live-Research (Check-in, All-aboard, Abfahrt, Häfen, Meals nur mit Clock, Highlights, Gepäckabgabe/Shuttle am Bahnhof nur belegt) → belegte Slots in Timeline — kein Fake, Links nur belegt.',
    source: 'manual',
    version: 1,
    sourceLayer: 'shadow',
    shadow: true,
    status: 'shadow',
    eventCount: 1,
    uniqueContributors: opts?.uniqueContributors ?? 1,
    hasEvidence: opts?.hadEvidence === true,
    hasBookingLink: opts?.hadBookingLink === true,
  };
}

export function looksLikeCruiseProgramAsk(text: string): boolean {
  return /\b(kreuzfahrt|mein\s+schiff|aida|adidia|aidia|bordprogramm|tagesprogramm\s+schiff)\b/iu.test(
    String(text || ''),
  );
}
