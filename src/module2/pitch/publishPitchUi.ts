/**
 * Live-Pitch UI Store (M2 split A|B) + Publish in Timeline.
 */

import { create } from 'zustand';
import type { QuickAction } from '../../types/concierge';
import { dateKeyFromMs, todayDateKey } from '../../utils/dateKeys';
import {
  requestDayKey,
  requestOpenPlanCalendar,
  requestPlanScroll,
  usePlanCalendarUiStore,
  type PlanChoiceCard,
  type PlanPendingChoice,
} from '../timeline/planCalendarUiStore';
import { useFuturePlanStore } from '../timeline/futurePlanState';
import type { PitchOptionCard, PitchResult, PitchUiLayout } from './types';
import { selectPitchOption } from './pitchDeepAppend';

export type LivePitchState = {
  requestId: string | null;
  layout: PitchUiLayout;
  headline: string;
  options: PitchOptionCard[];
  softFail: boolean;
  /** Research läuft — UI-Shell statt leerem Unmount */
  loading: boolean;
  selectedOptionId: string | null;
  visitAtMs: number | null;
  pitchKind: import('./types').PitchKind | null;
  pitchContext: string | null;
  setPitch: (
    r: PitchResult,
    headline?: string,
    meta?: {
      visitAtMs?: number | null;
      pitchKind?: import('./types').PitchKind | null;
      pitchContext?: string | null;
    },
  ) => void;
  /** Vor Research: Karte bleibt sichtbar (Loading), kein Blank-Gap. */
  setLoading: (headline?: string) => void;
  selectOption: (optionId: string) => void;
  patchOption: (
    optionId: string,
    patch: Partial<PitchOptionCard>,
  ) => void;
  clear: (force?: boolean) => void;
};

export const useLivePitchStore = create<LivePitchState>((set, get) => ({
  requestId: null,
  layout: 'live_split',
  headline: '',
  options: [],
  softFail: false,
  loading: false,
  selectedOptionId: null,
  visitAtMs: null,
  pitchKind: null,
  pitchContext: null,
  setPitch: (r, headline, meta) => {
    const cur = get().requestId;
    if (
      cur &&
      cur.startsWith('map_nav_mobility_') &&
      !String(r.requestId || '').startsWith('map_nav_mobility_')
    ) {
      return;
    }
    set({
      requestId: r.requestId,
      layout: r.uiLayout,
      headline: headline || r.summary || 'Zwei Optionen',
      options: r.options,
      softFail: r.softFail,
      loading: false,
      selectedOptionId: null,
      visitAtMs: meta?.visitAtMs ?? null,
      pitchKind: meta?.pitchKind ?? null,
      pitchContext: meta?.pitchContext ?? null,
    });
  },
  setLoading: (headline) => {
    const cur = get().requestId;
    if (cur && cur.startsWith('map_nav_mobility_')) return;
    set({
      requestId: get().requestId ?? `pitch_loading_${Date.now()}`,
      layout: 'live_split',
      headline: (headline || get().headline || 'Zwei Optionen').slice(0, 56),
      options: get().options,
      softFail: false,
      loading: true,
      selectedOptionId: null,
    });
  },
  selectOption: (optionId) => {
    const id = get().requestId;
    const layout = get().layout;
    const chosen = get().options.find((o) => o.id === optionId);
    if (id) selectPitchOption(id, optionId);
    if (
      chosen &&
      layout === 'live_split' &&
      id &&
      !id.startsWith('map_nav_mobility_')
    ) {
      try {
        const { resolvePitchTimingMode, pitchTimingAskSpeech, pitchTimingAskActions, pitchTimingLaterSpeech, pitchTimingNowActions, pitchDiningForkSpeech, pitchDiningForkActions } =
          require('./pitchTimingFork') as {
            resolvePitchTimingMode: (o: {
              visitAtMs?: number | null;
              userText?: string | null;
              pitchKind?: import('./types').PitchKind | null;
            }) => 'now' | 'later' | 'ask' | 'dining_fork';
            pitchTimingAskSpeech: () => string;
            pitchTimingLaterSpeech: (n: string) => string;
            pitchDiningForkSpeech: (n: string) => string;
            pitchTimingAskActions: (o: PitchOptionCard) => import('../../types/concierge').QuickAction[];
            pitchTimingNowActions: (o: PitchOptionCard) => import('../../types/concierge').QuickAction[];
            pitchDiningForkActions: (o: PitchOptionCard) => import('../../types/concierge').QuickAction[];
          };
        const { enqueueSpeech } = require('../speech/speechQueue') as {
          enqueueSpeech: (o: { kind: string; text: string; turnId: string }) => void;
        };
        const mode = resolvePitchTimingMode({
          visitAtMs: get().visitAtMs,
          userText: get().pitchContext,
          pitchKind: get().pitchKind,
        });
        if (mode === 'dining_fork') {
          const speech = pitchDiningForkSpeech(chosen.name);
          enqueueSpeech({
            kind: 'main',
            text: speech,
            turnId: `pitch_dining_${id}`,
          });
          set({
            selectedOptionId: optionId,
            options: [
              {
                ...chosen,
                actions: pitchDiningForkActions(chosen),
                speechPitch: speech,
              },
            ],
            headline: `Gute Wahl — ${chosen.name}`.slice(0, 56),
          });
          return;
        }
        if (mode === 'ask') {
          enqueueSpeech({
            kind: 'main',
            text: pitchTimingAskSpeech(),
            turnId: `pitch_timing_${id}`,
          });
          set({
            selectedOptionId: optionId,
            options: [
              {
                ...chosen,
                actions: pitchTimingAskActions(chosen),
                speechPitch: pitchTimingAskSpeech(),
              },
            ],
            headline: `Gute Wahl — ${chosen.name}`.slice(0, 56),
          });
          return;
        }
        if (mode === 'later') {
          const { mirrorLivePitchChoiceToTimeline } = require('./mirrorLivePitchToTimeline') as {
            mirrorLivePitchChoiceToTimeline: (o: {
              requestId: string;
              option: PitchOptionCard;
              visitAtMs?: number | null;
              pitchKind?: import('./types').PitchKind | null;
              pitchContext?: string | null;
            }) => void;
          };
          mirrorLivePitchChoiceToTimeline({
            requestId: id,
            option: chosen,
            visitAtMs: get().visitAtMs,
            pitchKind: get().pitchKind,
            pitchContext: get().pitchContext,
          });
          enqueueSpeech({
            kind: 'main',
            text: pitchTimingLaterSpeech(chosen.name),
            turnId: `pitch_later_${id}`,
          });
          set({
            selectedOptionId: optionId,
            options: [chosen],
            headline: `Eingetragen — ${chosen.name}`.slice(0, 56),
          });
          return;
        }
        // now — Nav-Actions behalten / setzen
        set({
          selectedOptionId: optionId,
          options: [
            {
              ...chosen,
              actions: pitchTimingNowActions(chosen),
            },
          ],
          headline: `Gute Wahl — ${chosen.name}`.slice(0, 56),
        });
        return;
      } catch {
        try {
          const { mirrorLivePitchChoiceToTimeline } = require('./mirrorLivePitchToTimeline') as {
            mirrorLivePitchChoiceToTimeline: (o: {
              requestId: string;
              option: PitchOptionCard;
              visitAtMs?: number | null;
              pitchKind?: import('./types').PitchKind | null;
              pitchContext?: string | null;
            }) => void;
          };
          mirrorLivePitchChoiceToTimeline({
            requestId: id,
            option: chosen,
            visitAtMs: get().visitAtMs,
            pitchKind: get().pitchKind,
            pitchContext: get().pitchContext,
          });
        } catch {
          /* soft */
        }
      }
    }
    const name = String(chosen?.name || '').trim();
    set({
      selectedOptionId: optionId,
      options: chosen ? [chosen] : get().options.filter((o) => o.id === optionId),
      headline: name
        ? `Gute Wahl — ${name}`.slice(0, 56)
        : get().headline,
    });
  },
  patchOption: (optionId, patch) =>
    set((s) => ({
      options: s.options.map((o) =>
        o.id === optionId ? { ...o, ...patch } : o,
      ),
    })),
  clear: (force?: boolean) => {
    const cur = get().requestId;
    if (!force && cur && cur.startsWith('map_nav_mobility_')) return;
    set({
      requestId: null,
      options: [],
      softFail: false,
      loading: false,
      selectedOptionId: null,
      headline: '',
      visitAtMs: null,
      pitchKind: null,
      pitchContext: null,
    });
  },
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

function resolvePitchDayKey(anchorTimeMs?: number | null): string {
  if (anchorTimeMs != null && Number.isFinite(anchorTimeMs)) {
    try {
      return dateKeyFromMs(anchorTimeMs);
    } catch {
      /* soft */
    }
  }
  const requested = usePlanCalendarUiStore.getState().requestedDayKey;
  if (requested && /^\d{4}-\d{2}-\d{2}$/.test(requested)) return requested;
  const active = useFuturePlanStore.getState().plan.dayKey;
  if (active && /^\d{4}-\d{2}-\d{2}$/.test(active)) return active;
  return todayDateKey();
}

function clearChoiceStopsOnDay(dayKey: string, stepKey: string): void {
  const plan = useFuturePlanStore.getState().getPlanForDay(dayKey);
  for (const s of [...plan.stops]) {
    if (
      s.id.startsWith('choice_') &&
      (s.choiceGroupId === stepKey ||
        s.id.includes(stepKey) ||
        s.planTaskId === stepKey)
    ) {
      // removeStop nur aktiver Tag — per upsert-Ersatz: Tag aktivieren
      useFuturePlanStore.getState().ensureDay(dayKey);
      useFuturePlanStore.getState().removeStop(s.id);
    }
  }
  // Alte Vorschläge anderer Steps auf dem Tag ebenfalls weg (max. 2 Karten)
  const again = useFuturePlanStore.getState().getPlanForDay(dayKey);
  for (const s of [...again.stops]) {
    if (s.id.startsWith('choice_')) {
      useFuturePlanStore.getState().ensureDay(dayKey);
      useFuturePlanStore.getState().removeStop(s.id);
    }
  }
}

/** Timeline: gestapelte pendingChoice + choice_* Stops auf der Achse. */
export function publishPitchToTimeline(
  result: PitchResult,
  opts: { stepKey: string; headline: string; anchorTimeMs?: number | null },
): void {
  const a = result.options[0];
  const b = result.options[1] ?? result.options[0];
  if (!a) return;
  const left = toPlanCard(a, opts.stepKey, 'left');
  const right = toPlanCard(b || a, opts.stepKey, 'right');
  const startMs = opts.anchorTimeMs ?? null;
  const dayKey = resolvePitchDayKey(startMs);

  useFuturePlanStore.getState().ensureDay(dayKey);
  requestDayKey(dayKey);
  requestOpenPlanCalendar();
  clearChoiceStopsOnDay(dayKey, opts.stepKey);

  const sides: Array<{
    card: PitchOptionCard;
    side: 'left' | 'right';
    medal: string;
  }> =
    result.options.length >= 2
      ? [
          { card: a, side: 'left', medal: '🥇' },
          { card: b!, side: 'right', medal: '🥈' },
        ]
      : [{ card: a, side: 'left', medal: '🥇' }];

  for (const { card, side, medal } of sides) {
    const id = `choice_${opts.stepKey}_${side}`;
    const noteLines = (card.bullets ?? []).slice(0, 3);
    useFuturePlanStore.getState().upsertStopOnDay(dayKey, {
      id,
      title: `${medal} ${card.name}`.slice(0, 48),
      lat: card.lat,
      lng: card.lng,
      plannedStartMs: startMs,
      plannedEndMs: startMs != null ? startMs + 60 * 60_000 : null,
      bufferMin: 10,
      transport: 'walk',
      kind: 'stop',
      status: 'pending_change',
      choiceSide: side,
      choiceGroupId: opts.stepKey,
      planTaskId: opts.stepKey,
      notes: noteLines.join('\n'),
      mapsUrl: card.mapsUrl,
      menuUrl: card.menuUrl ?? null,
      emoji: medal,
      userFixedTime: startMs != null,
    });
  }

  const pending: PlanPendingChoice = {
    stepKey: opts.stepKey,
    headline: opts.headline,
    anchorTimeMs: startMs,
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
  usePlanCalendarUiStore.getState().setShortAnswers([
    { id: 'reject_l', label: 'Neu suchen', action: 'plan_reject' },
    { id: 'reject_r', label: 'Neu suchen', action: 'plan_reject' },
  ]);
  requestPlanScroll({ kind: 'choice', stepKey: opts.stepKey });
}

/** Live M2: split store. */
export function publishPitchToLive(
  result: PitchResult,
  headline?: string,
  meta?: {
    visitAtMs?: number | null;
    pitchKind?: import('./types').PitchKind | null;
    pitchContext?: string | null;
  },
): void {
  useLivePitchStore.getState().setPitch(result, headline, meta);
}

export function publishPitchResult(
  result: PitchResult,
  opts: {
    stepKey: string;
    headline: string;
    anchorTimeMs?: number | null;
    pitchKind?: import('./types').PitchKind | null;
    pitchContext?: string | null;
  },
): void {
  if (result.uiLayout === 'timeline_stack') {
    publishPitchToTimeline(result, opts);
  } else {
    publishPitchToLive(result, opts.headline, {
      visitAtMs: opts.anchorTimeMs ?? null,
      pitchKind: opts.pitchKind ?? null,
      pitchContext: opts.pitchContext ?? null,
    });
  }
}
