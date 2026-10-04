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
import { humanizeBullets } from '../speech/draftToHumanSpeech';

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
      options: r.options.map((o) => ({
        ...o,
        bullets: humanizeBullets(o.bullets ?? [], 3),
      })),
      softFail: r.softFail,
      loading: false,
      selectedOptionId: null,
      visitAtMs: meta?.visitAtMs ?? null,
      pitchKind: meta?.pitchKind ?? null,
      pitchContext: meta?.pitchContext ?? null,
    });
    // Pitch ersetzt Spickzettel: keine Stichpunkte parallel/unter der Auswahl
    try {
      const { useFinnusStore } = require('../../store/useFinnusStore') as {
        useFinnusStore: {
          getState: () => {
            setActiveConciergeCard: (c: null) => void;
            setPendingAffiliateOffer: (o: null) => void;
          };
        };
      };
      const st = useFinnusStore.getState();
      st.setActiveConciergeCard(null);
      st.setPendingAffiliateOffer(null);
    } catch {
      /* soft */
    }
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
        const { enqueueSpeech } = require('../speech/speechQueue') as {
          enqueueSpeech: (o: { kind: string; text: string; turnId: string }) => void;
        };
        const noteInventory = () => {
          try {
            const { noteLastLiveInventory } = require('../context/shortTermContext') as {
              noteLastLiveInventory: (o: {
                kind: 'pitch_choice';
                query: string;
              }) => void;
            };
            noteLastLiveInventory({
              kind: 'pitch_choice',
              query: `${get().pitchContext || ''} ${chosen.name}`.trim().slice(0, 200),
            });
          } catch {
            /* soft */
          }
        };

        // Kino-Venue gewählt → sofort Programm laden (blauer Balken), kein Timing-Fork
        if (
          get().pitchKind === 'cinema' &&
          !String(chosen.id).includes('_film_')
        ) {
          noteInventory();
          set({
            selectedOptionId: optionId,
            options: [chosen],
            headline: `Programm — ${chosen.name}`.slice(0, 56),
            loading: true,
          });
          try {
            const { useFinnusStore } = require('../../store/useFinnusStore') as {
              useFinnusStore: {
                getState: () => { setNavRouteLoading?: (v: boolean) => void };
              };
            };
            useFinnusStore.getState().setNavRouteLoading?.(true);
          } catch {
            /* soft */
          }
          void import('./cinemaVenueProgramBrief')
            .then(({ briefCinemaVenueAfterChoice }) =>
              briefCinemaVenueAfterChoice({
                venue: chosen,
                userContext: get().pitchContext,
              }),
            )
            .then((brief) => {
              if (get().selectedOptionId !== optionId) return;
              enqueueSpeech({
                kind: 'main',
                text: brief.speech,
                turnId: `cinema_prog_${id}`,
              });
              set({
                loading: false,
                options: [
                  {
                    ...chosen,
                    speechPitch: brief.speech,
                    bullets: brief.bullets,
                    actions: brief.actions,
                    ticketUrl: brief.ticketUrl ?? chosen.ticketUrl,
                    websiteUrl: brief.websiteUrl ?? chosen.websiteUrl,
                  },
                ],
                headline: brief.headline,
              });
            })
            .catch(() => {
              if (get().selectedOptionId !== optionId) return;
              set({ loading: false });
            })
            .finally(() => {
              try {
                const { useFinnusStore } = require('../../store/useFinnusStore') as {
                  useFinnusStore: {
                    getState: () => { setNavRouteLoading?: (v: boolean) => void };
                  };
                };
                useFinnusStore.getState().setNavRouteLoading?.(false);
              } catch {
                /* soft */
              }
            });
          return;
        }

        // Multi-Lane Fetch→Spot: kein Timing-Fork — Nav inkl. Follow-On läuft im Slot
        if (
          chosen.followOnStop &&
          Number.isFinite(chosen.followOnStop.lat) &&
          Number.isFinite(chosen.followOnStop.lng)
        ) {
          noteInventory();
          const hint = String(
            chosen.followOnStop.enjoyHint || chosen.followOnStop.name || '',
          ).trim();
          const speech = hint
            ? `Super — dann holen wir bei ${chosen.name} etwas und danach geht’s weiter zum ${hint}.`
            : `Super — dann zuerst zu ${chosen.name}, danach der nächste Stopp.`;
          enqueueSpeech({
            kind: 'main',
            text: speech,
            turnId: `pitch_ml_follow_${id}`,
          });
          set({
            selectedOptionId: optionId,
            options: [
              {
                ...chosen,
                speechPitch: speech,
              },
            ],
            headline: `Gute Wahl — ${chosen.name}`.slice(0, 56),
          });
          return;
        }
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
        const mode = resolvePitchTimingMode({
          visitAtMs: get().visitAtMs,
          userText: get().pitchContext,
          pitchKind: get().pitchKind,
        });
        if (mode === 'dining_fork') {
          noteInventory();
          const speech = pitchDiningForkSpeech(chosen.name);
          let nextSoft: string | null = null;
          try {
            const { completeActiveAndPeekNatural } = require('../router/intentQueue') as {
              completeActiveAndPeekNatural: () => { softBrief: string | null };
            };
            nextSoft = completeActiveAndPeekNatural().softBrief;
          } catch {
            nextSoft = null;
          }
          enqueueSpeech({
            kind: 'main',
            text: nextSoft ? `${speech} ${nextSoft}` : speech,
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
          noteInventory();
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
          const { pitchTimingLaterActions } = require('./pitchTimingFork') as {
            pitchTimingLaterActions: (o: PitchOptionCard) => import('../../types/concierge').QuickAction[];
          };
          mirrorLivePitchChoiceToTimeline({
            requestId: id,
            option: chosen,
            visitAtMs: get().visitAtMs,
            pitchKind: get().pitchKind,
            pitchContext: get().pitchContext,
          });
          try {
            const { requestOpenPlanCalendar, requestDayKey } = require('../timeline/planCalendarUiStore') as {
              requestOpenPlanCalendar: () => void;
              requestDayKey: (k: string) => void;
            };
            const { dateKeyFromMs } = require('../../utils/dateKeys') as {
              dateKeyFromMs: (ms: number) => string;
            };
            const visit = get().visitAtMs;
            if (visit != null && Number.isFinite(visit)) {
              requestDayKey(dateKeyFromMs(visit));
            }
            requestOpenPlanCalendar();
          } catch {
            /* soft */
          }
          const laterSpeech = pitchTimingLaterSpeech(chosen.name);
          enqueueSpeech({
            kind: 'main',
            text: laterSpeech,
            turnId: `pitch_later_${id}`,
          });
          set({
            selectedOptionId: optionId,
            options: [
              {
                ...chosen,
                actions: pitchTimingLaterActions(chosen),
                speechPitch: laterSpeech,
              },
            ],
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
      options: s.options.map((o) => {
        if (o.id !== optionId) return o;
        const next = { ...o, ...patch };
        if (patch.bullets) {
          next.bullets = humanizeBullets(patch.bullets, 3);
        }
        return next;
      }),
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
    // Pitch-Auswahl ODER Stichpunkte — nie nach Pitch-Close die Card wieder aufpoppen
    try {
      const { useFinnusStore } = require('../../store/useFinnusStore') as {
        useFinnusStore: {
          getState: () => {
            activeConciergeCard: unknown;
            setActiveConciergeCard: (c: null) => void;
            setPendingAffiliateOffer: (o: null) => void;
          };
        };
      };
      const st = useFinnusStore.getState();
      if (st.activeConciergeCard) {
        st.setActiveConciergeCard(null);
        st.setPendingAffiliateOffer(null);
      }
    } catch {
      /* soft */
    }
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
    subtitle: humanizeBullets(o.bullets ?? [], 3).join('\n'),
    bullets: humanizeBullets(o.bullets ?? [], 3),
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
  // Ideal: Calendar nur bei explizitem openCalendar — nicht bei jedem Pitch
  if ((opts as { openCalendar?: boolean }).openCalendar === true) {
    requestOpenPlanCalendar();
  }
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
    const noteLines = humanizeBullets(card.bullets ?? [], 3);
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
      websiteUrl: card.websiteUrl ?? null,
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
    { id: 'plan_reject', label: 'Neu suchen', action: 'plan_reject' },
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
    /** Nur true wenn Call-1 uiRequirements.openCalendar — Default false */
    openCalendar?: boolean;
  },
): void {
  // Dining/Pitch default live_split; Calendar nur bei explizitem uiRequirements-Flag
  // Phase 8: Amenity single-place nie in Timeline spiegeln
  let layout = result.uiLayout;
  try {
    const { isAmenitySinglePlacePitch } = require('./pitchAmenityUi') as {
      isAmenitySinglePlacePitch: (o: {
        kind?: string | null;
        text?: string | null;
      }) => boolean;
    };
    if (
      isAmenitySinglePlacePitch({
        kind: opts.pitchKind,
        text: opts.pitchContext,
      })
    ) {
      layout = 'live_split';
    }
  } catch {
    /* soft */
  }
  const openCalendar =
    opts.openCalendar === true && layout === 'timeline_stack';
  if (layout === 'timeline_stack') {
    publishPitchToTimeline(result, {
      ...opts,
      openCalendar,
    });
  } else {
    publishPitchToLive(
      { ...result, uiLayout: 'live_split' },
      opts.headline,
      {
        visitAtMs: opts.anchorTimeMs ?? null,
        pitchKind: opts.pitchKind ?? null,
        pitchContext: opts.pitchContext ?? null,
      },
    );
  }
}
