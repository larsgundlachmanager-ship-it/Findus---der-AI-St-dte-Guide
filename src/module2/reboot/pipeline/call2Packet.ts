/**
 * Call-2 Pflichtpaket: User-Satz 1:1, Bridge 1:1, strukturierte Fakten, Slot-Warum.
 * Beat 2 setzt die Bridge fort — kein zweites Intro.
 */

import type { FindusJobId } from '../../jobs/types';
import type { OrchestratedTurn } from './orchestrateSlots';
import type { HelpFirstMoment } from '../../../services/affiliate/helpFirstMonetization';

export type Call2Fact = {
  job: FindusJobId;
  why: string;
  facts: Record<string, string | number | boolean | null>;
};

export type Call2Packet = {
  userText: string;
  spokenBridge: string | null;
  jobsWhy: Array<{ job: FindusJobId; why: string }>;
  facts: Call2Fact[];
  thinkAhead: OrchestratedTurn['thinkAhead'];
  weaveDayPlan: boolean;
  /** Deterministische Partner-Hilfe-Momente (Code-Detect = SSOT). */
  partnerHints?: HelpFirstMoment[];
  /** Kompakter ready-Katalog für Call-2. */
  partnerCatalogSnippet?: string;
};

export function buildCall2Packet(opts: {
  userText: string;
  spokenBridge: string | null;
  orch: OrchestratedTurn;
  facts: Call2Fact[];
  partnerHints?: HelpFirstMoment[];
  partnerCatalogSnippet?: string;
}): Call2Packet {
  return {
    userText: opts.userText,
    spokenBridge: opts.spokenBridge,
    jobsWhy: opts.orch.slots.map((s) => ({
      job: s.job,
      why: `${s.kind}:${s.title}`,
    })),
    facts: opts.facts,
    thinkAhead: opts.orch.thinkAhead,
    weaveDayPlan: opts.orch.weaveDayPlan,
    partnerHints: opts.partnerHints?.slice(0, 2),
    partnerCatalogSnippet: opts.partnerCatalogSnippet,
  };
}

export function formatCall2PacketForPrompt(packet: Call2Packet): string {
  const factsJson = JSON.stringify(
    packet.facts.map((f) => ({ job: f.job, why: f.why, facts: f.facts })),
  );
  const moments =
    packet.partnerHints?.length
      ? `ACTIVE_HELP_MOMENTS: ${packet.partnerHints
          .map((m) => `${m.kind} (p${m.priority})`)
          .join(', ')}`
      : 'ACTIVE_HELP_MOMENTS: none';
  return [
    `USER: ${packet.userText}`,
    packet.spokenBridge
      ? `BRIDGE (schon gesprochen — Verstanden/Zusagen, nicht wiederholen): ${packet.spokenBridge}`
      : 'BRIDGE: keine',
    `JOBS_WHY: ${JSON.stringify(packet.jobsWhy)}`,
    `THINK_AHEAD: ${packet.thinkAhead.join(',') || '—'}`,
    `WEAVE_DAY_PLAN: ${packet.weaveDayPlan ? 'yes' : 'no'}`,
    `FACTS: ${factsJson}`,
    packet.partnerCatalogSnippet || '',
    moments,
    'Partner-Hilfe: max 1–2 Buttons; Taxi/Uber nur bei explizitem Taxi-Intent; Smalltalk/reine Fakten ohne Reise-Lücke → keine Partner.',
    'Beat 2 = Fortsetzung. Nur Belegtes. Kein zweites Intro. Lücken ehrlich.',
  ]
    .filter(Boolean)
    .join('\n');
}
