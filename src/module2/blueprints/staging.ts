/**
 * Blueprint staging + gate + weekly digest hooks.
 */

import type { BlueprintContract } from './registry';

export type BlueprintStagingDraft = {
  id: string;
  createdAt: string;
  clarity: 'clear' | 'unclear';
  autoGate: 'pass' | 'fail';
  signal: string;
  patch: {
    blueprintId: string;
    stage?: string;
    addFastFacts?: string[];
    addSlowFacts?: string[];
    notes?: string;
  };
  reviewBrief: string;
};

/** Narrow whitelist: single fact add, no new stage/route/affiliate. */
export function classifyBlueprintClarity(draft: {
  isNewBlueprint?: boolean;
  changesStage?: boolean;
  touchesAffiliate?: boolean;
  factCount?: number;
  composeOnMiss?: boolean;
  thin?: boolean;
}): 'clear' | 'unclear' {
  if (
    draft.isNewBlueprint ||
    draft.changesStage ||
    draft.touchesAffiliate ||
    draft.composeOnMiss ||
    draft.thin
  ) {
    return 'unclear';
  }
  if ((draft.factCount ?? 0) <= 2) return 'clear';
  return 'unclear';
}

export function autoGateBlueprintPatch(patch: {
  addFastFacts?: string[];
  addSlowFacts?: string[];
  notes?: string;
}): 'pass' | 'fail' {
  const facts = [...(patch.addFastFacts ?? []), ...(patch.addSlowFacts ?? [])];
  if (!facts.length && !patch.notes) return 'fail';
  for (const f of facts) {
    if (f.trim().length < 8) return 'fail';
    // Hardcoded script smell
    if (/^(sag genau|du musst sagen|wortlaut:)/i.test(f)) return 'fail';
  }
  return 'pass';
}

export function buildReviewBrief(draft: BlueprintStagingDraft): string {
  return [
    `# Blueprint Review: ${draft.id}`,
    '',
    `- Clarity: **${draft.clarity}**`,
    `- Auto-Gate: **${draft.autoGate}**`,
    `- Signal: ${draft.signal}`,
    `- Blueprint: ${draft.patch.blueprintId}${draft.patch.stage ? ` / ${draft.patch.stage}` : ''}`,
    '',
    '## Proposed facts',
    ...(draft.patch.addFastFacts ?? []).map((f) => `- fast: ${f}`),
    ...(draft.patch.addSlowFacts ?? []).map((f) => `- slow: ${f}`),
    '',
    draft.clarity === 'clear' && draft.autoGate === 'pass'
      ? '_Auto-publish eligible (whitelist)._'
      : '_Needs weekly human approve._',
    '',
    draft.reviewBrief,
  ].join('\n');
}

export function shouldAutoPublish(draft: BlueprintStagingDraft): boolean {
  return draft.clarity === 'clear' && draft.autoGate === 'pass';
}

/** In-memory queue for app runtime; scripts read files under data/blueprints/staging. */
const pendingUnclear: BlueprintStagingDraft[] = [];

export function enqueueBlueprintDraft(draft: BlueprintStagingDraft): {
  autoPublished: boolean;
} {
  draft.autoGate = autoGateBlueprintPatch(draft.patch);
  if (draft.autoGate === 'fail') {
    draft.clarity = 'unclear';
  }
  if (shouldAutoPublish(draft)) {
    return { autoPublished: true };
  }
  pendingUnclear.push(draft);
  return { autoPublished: false };
}

export function listPendingBlueprintReviews(): BlueprintStagingDraft[] {
  return [...pendingUnclear];
}

export function weeklyDigestText(): string {
  const n = pendingUnclear.length;
  if (!n) return 'Keine offenen Blueprint-Reviews.';
  return `${n} Blaupausen warten auf OK:\n${pendingUnclear
    .map((d) => `- ${d.id} (${d.patch.blueprintId})`)
    .join('\n')}`;
}

export function composeEphemeralLogged(contract: BlueprintContract): void {
  try {
    // Avoid __DEV__ in Node harness paths
    if (typeof console !== 'undefined') {
      console.log(
        '[blueprint] compose on miss:',
        contract.id,
        contract.stage,
        contract.label,
      );
    }
  } catch {
    /* soft */
  }
}
