/**
 * Live-Pitch UI Store (M2 split A|B) + Publish in Timeline.
 */

import { create } from 'zustand';
import type { QuickAction } from '../../types/concierge';
import {
  usePlanCalendarUiStore,
  type PlanChoiceCard,
  type PlanPendingChoice,
} from '../timeline/planCalendarUiStore';
import type { PitchOptionCard, PitchResult, PitchUiLayout } from './types';
import { selectPitchOption } from './pitchDeepAppend';

export type LivePitchState = {
  requestId: string | null;
  layout: PitchUiLayout;
  headline: string;
  options: PitchOptionCard[];
  softFail: boolean;
  selectedOptionId: string | null;
  setPitch: (r: PitchResult, headline?: string) => void;
  selectOption: (optionId: string) => void;
  patchOption: (
    optionId: string,
    patch: Partial<PitchOptionCard>,
  ) => void;
  clear: () => void;
};

export const useLivePitchStore = create<LivePitchState>((set, get) => ({
  requestId: null,
  layout: 'live_split',
  headline: '',
  options: [],
  softFail: false,
  selectedOptionId: null,
  setPitch: (r, headline) =>
    set({
      requestId: r.requestId,
      layout: r.uiLayout,
      headline: headline || r.summary || 'Zwei Optionen',
      options: r.options,
      softFail: r.softFail,
      selectedOptionId: null,
    }),
  selectOption: (optionId) => {
    const id = get().requestId;
    if (id) selectPitchOption(id, optionId);
    set({ selectedOptionId: optionId });
  },
  patchOption: (optionId, patch) =>
    set((s) => ({
      options: s.options.map((o) =>
        o.id === optionId ? { ...o, ...patch } : o,
      ),
    })),
  clear: () =>
    set({
      requestId: null,
      options: [],
      softFail: false,
      selectedOptionId: null,
      headline: '',
    }),
}));

function toPlanCard(
  o: PitchOptionCard,
  stepKey: string,
  side: 'left' | 'right',
): PlanChoiceCard {
  return {
    id: o.id || `choice_${stepKey}_${side}`,
    title: `${o.role === 'favorite' ? '🥇' : o.role === 'out_of_box' ? '✨' : '🥈'} ${o.name}`,
    lat: o.lat,
    lng: o.lng,
    subtitle: (o.bullets ?? []).join('\n'),
    bullets: o.bullets ?? [],
    mapsUrl: o.mapsUrl,
    menuUrl: o.menuUrl ?? null,
    placeId: o.placeId ?? null,
    rating: o.rating ?? null,
    proposalRole: o.role === 'out_of_box' ? 'alternative' : o.role,
    actionCards: o.actions
      .filter((a) => a.type === 'OPEN_URL')
      .slice(0, 2)
      .map((a, i) => ({
        id: `${o.id}_act_${i}`,
        label: a.label,
        url:
          a.payload && typeof a.payload === 'object' && 'url' in a.payload
            ? String((a.payload as { url?: string }).url ?? '')
            : '',
      }))
      .filter((x) => x.url),
  };
}

/** Timeline: gestapelte pendingChoice (A dann B). */
export function publishPitchToTimeline(
  result: PitchResult,
  opts: { stepKey: string; headline: string; anchorTimeMs?: number | null },
): void {
  const a = result.options[0];
  const b = result.options[1] ?? result.options[0];
  if (!a) return;
  const left = toPlanCard(a, opts.stepKey, 'left');
  const right = toPlanCard(b || a, opts.stepKey, 'right');
  const pending: PlanPendingChoice = {
    stepKey: opts.stepKey,
    headline: opts.headline,
    anchorTimeMs: opts.anchorTimeMs ?? null,
    anchorTimeLabel: null,
    options: [left, right],
    uiPhase: 'proposal',
  };
  usePlanCalendarUiStore.getState().setPendingChoice(pending);
  const mirrored: QuickAction[] = [];
  for (const o of result.options) {
    for (const act of o.actions) mirrored.push(act);
  }
  usePlanCalendarUiStore.getState().setMirroredActions(mirrored.slice(0, 6));
}

/** Live M2: split store. */
export function publishPitchToLive(result: PitchResult, headline?: string): void {
  useLivePitchStore.getState().setPitch(result, headline);
}

export function publishPitchResult(
  result: PitchResult,
  opts: { stepKey: string; headline: string; anchorTimeMs?: number | null },
): void {
  if (result.uiLayout === 'timeline_stack') {
    publishPitchToTimeline(result, opts);
  } else {
    publishPitchToLive(result, opts.headline);
  }
}
