/**
 * Feature-Tips / Selbsterklärung (Phase 9).
 * Einmalige App-Potenzial-Hinweise — situativ, max. einer pro Story.
 * Zero user-facing templates: Prompt-Parameter für Gemini, kein Hardcoding.
 */

import type { PoiWithFacts } from '../db/types';
import type { PoiImportance } from '../types/userProfile';
import { getPoiWithFacts } from '../db/database';
import { useFinnusStore } from '../store/useFinnusStore';
import { resolvePoiImportance } from '../services/personaEngine';
import {
  detectSpokenTipsInText,
  formatFeatureTipsForPrompt,
  loadFeatureTipState,
  markFeatureTipSpoken,
  markFeatureTipCompleted,
  markHandsFreeNavExplained,
  markInterestPatternExplained,
  planFeatureTips,
  shouldExplainHandsFreeNav,
  shouldExplainInterestPattern,
  type FeatureTipId,
  type FeatureTipPlan,
} from '../services/ai/featureTips';

export type {
  FeatureTipId,
  FeatureTipPlan,
} from '../services/ai/featureTips';

export {
  markFeatureTipCompleted,
  markNavigationUsed,
  markHandsFreeNavExplained,
  shouldExplainHandsFreeNav,
  shouldExplainInterestPattern,
  markInterestPatternExplained,
} from '../services/ai/featureTips';

let lastNarrationTipPlan: FeatureTipPlan | null = null;

/** Prompt-Block: langsamer werden → volle Geschichte (einmal pro Install). */
export function interestPatternPromptBlock(): string {
  return [
    'INTEREST-PATTERN (einmalig, beiläufig, max. ein Halbsatz):',
    'Erkläre kurz, dass langsamer werden oder kurz stehenbleiben automatisch die volle Geschichte auslöst.',
    'Natürlich formulieren — kein Handbuch, kein „Feature“.',
  ].join('\n');
}

/** Modul 2: höchstens ein offener Tip im Concierge-Prompt. */
export async function buildConciergeFeatureTipsPromptBlock(): Promise<string> {
  await loadFeatureTipState();
  const store = useFinnusStore.getState();
  const sessionCount = store.visitedHistory.length;
  const poi =
    store.currentPoiId != null
      ? await getPoiWithFacts(store.currentPoiId)
      : null;
  const plan = planFeatureTips({
    poi:
      poi ??
      ({
        id: -1,
        name: store.currentLocationName ?? 'Ort',
        lat: store.lastGpsLat ?? 0,
        lng: store.lastGpsLng ?? 0,
        radius_meters: 25,
        facts: [],
        kind: 'area',
        category: null,
        tags_json: null,
        teaser_text: null,
        spot_key: null,
        parent_poi_id: null,
      } as PoiWithFacts),
    importance: poi ? resolvePoiImportance(poi) : 'minor',
    isFirstPoi: sessionCount === 0,
    kind: poi?.kind ?? null,
  });

  if (!plan.tip) {
    return [
      '=== APP-POTENZIAL (CONCIERGE) ===',
      '- Kein neuer einmaliger App-Hinweis — nur die User-Frage beantworten.',
    ].join('\n');
  }

  return [
    '=== APP-POTENZIAL (CONCIERGE, DOSIERT) ===',
    formatFeatureTipsForPrompt({ ...plan, surplusExampleQuestion: null }),
    '- Nur wenn es natürlich passt — sonst weglassen.',
  ].join('\n');
}

export async function prepareNarrationFeatureTips(input: {
  poi: PoiWithFacts;
  importance?: PoiImportance;
  isFirstPoi?: boolean;
  kind?: string | null;
  parentIsMajor?: boolean;
  /** Modul-1-Story: keine App-Selbstwerbung im Audio. */
  muteAppTips?: boolean;
}): Promise<FeatureTipPlan> {
  await loadFeatureTipState();
  if (input.muteAppTips) {
    const muted: FeatureTipPlan = {
      tip: null,
      surplusExampleQuestion: null,
      allowNavReminder: false,
    };
    lastNarrationTipPlan = muted;
    return muted;
  }
  const sessionCount =
    input.isFirstPoi != null
      ? input.isFirstPoi
        ? 0
        : 1
      : useFinnusStore.getState().visitedHistory.length;
  const isFirstPoi =
    input.isFirstPoi ?? sessionCount === 0;
  const importance =
    input.importance ?? resolvePoiImportance(input.poi);

  const planned = planFeatureTips({
    poi: input.poi,
    importance,
    isFirstPoi,
    kind: input.kind ?? input.poi.kind,
    parentIsMajor: input.parentIsMajor,
  });

  const tipPlan: FeatureTipPlan = {
    ...planned,
    tip:
      planned.surplusExampleQuestion && planned.tip === 'ask_followups'
        ? null
        : planned.tip,
  };

  lastNarrationTipPlan = tipPlan;
  return tipPlan;
}

export function formatNarrationFeatureTipsBlock(plan: FeatureTipPlan): string {
  return formatFeatureTipsForPrompt(plan);
}

export function getLastNarrationFeatureTipPlan(): FeatureTipPlan | null {
  return lastNarrationTipPlan;
}

/** Nach Story/Teaser: gesprochene Tips abhaken. */
export async function commitNarrationFeatureTips(
  spokenText: string,
): Promise<void> {
  const plan = lastNarrationTipPlan;
  const detected = detectSpokenTipsInText(spokenText);
  const toMark = new Set<FeatureTipId>(detected);
  if (plan?.tip) toMark.add(plan.tip);
  if (plan?.surplusExampleQuestion) toMark.add('ask_followups');
  if (plan?.allowNavReminder && detected.includes('navigation')) {
    toMark.add('navigation');
  }
  for (const id of toMark) {
    await markFeatureTipSpoken(id);
  }
}

/** Optional extra instruction für Approach-Teaser (Interest-Pattern). */
export async function resolveApproachExtraInstruction(): Promise<string | null> {
  if (!(await shouldExplainInterestPattern())) return null;
  return interestPatternPromptBlock();
}

export async function onApproachInterestPatternUsed(): Promise<void> {
  await markInterestPatternExplained();
}
