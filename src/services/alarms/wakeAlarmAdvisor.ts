/**
 * Aufsteh-Wecker: leave-by − Morgen-Prep → Vorschlag + OS-Notification.
 */

import { useFinnusStore } from '../../store/useFinnusStore';
import {
  computeLeaveByMs,
  DEFAULT_SAFETY_BUFFER_MIN,
} from '../notifications/reminderMath';
import { extractFlightCode, prepareFlightFollowUp } from '../flights/flightAdvisor';
import type { AirportArrivalPlan } from '../flights/FlightTrackingService';
import type { QuickAction } from '../../types/concierge';
import { applyWalkEtaWeatherMultiplier } from '../weather/weatherRouting';
import { resolveWeatherRouting } from '../weatherService';
import {
  resolveDateTimeMs,
  isPostMidnightWindow,
  parseGermanClockHm,
} from '../time/temporalGerman';
import {
  buildWakeConfirmSpeech,
  parseWakeVoiceStyle,
} from './wakeConfirmSpeech';
import {
  hasClockHint,
  isWakeAlarmIntent as detectWakeAlarmIntent,
} from './wakeIntentDetect';

/** Zeit zum Fertigmachen (Dusche, Packen, Frühstück) vor dem Losgehen. */
export const DEFAULT_MORNING_PREP_MIN = 50;

export type WakeAlarmProposal = {
  wakeAtMs: number;
  leaveByMs: number | null;
  departureMs: number | null;
  reasonLabel: string;
  prepMin: number;
  speech: string;
  bullets: string[];
  quickActions: QuickAction[];
};

let lastFlightPlan: AirportArrivalPlan | null = null;
let pendingProposal: WakeAlarmProposal | null = null;

export function rememberFlightPlanForAlarm(
  plan: AirportArrivalPlan | null,
): void {
  if (plan) lastFlightPlan = plan;
}

export function getPendingWakeProposal(): WakeAlarmProposal | null {
  return pendingProposal;
}

export function setPendingWakeProposal(
  proposal: WakeAlarmProposal | null,
): void {
  pendingProposal = proposal;
}

/** Re-export — SSOT in wakeIntentDetect.ts */
export function isWakeAlarmIntent(text: string): boolean {
  return detectWakeAlarmIntent(text);
}

/**
 * Nach erfolgreichem Stellen: Stichpunkte + optionale Just-Do-It-Buttons
 * (früher / Plan-Hinweis) — Wortlaut der Speech bleibt knapper Confirm.
 */
export function buildWakeSuccessExtras(opts: {
  wakeAtMs: number;
  reasonLabel?: string;
  planHintTitle?: string | null;
  suggestedEarlierMs?: number | null;
  /** Explizite Uhr ohne Plan-Anker → keine Extra-Buttons */
  lean?: boolean;
}): { bullets: string[]; quickActions: QuickAction[] } {
  const wakeClock = formatClockDe(opts.wakeAtMs);
  const day = new Date(opts.wakeAtMs);
  const dayLabel = day.toLocaleDateString('de-DE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  // Ein Stichpunkt reicht — kein Doppel zur Speech
  const bullets = [`${wakeClock} · ${dayLabel}`];
  if (opts.planHintTitle && !opts.lean) {
    bullets.push(`Plan: ${opts.planHintTitle}`);
  }

  const quickActions: QuickAction[] = [];
  if (opts.lean) {
    return { bullets: bullets.slice(0, 1), quickActions: [] };
  }
  const earlier15 = opts.wakeAtMs - 15 * 60_000;
  if (earlier15 > Date.now() + 60_000) {
    const c = formatClockDe(earlier15);
    quickActions.push({
      type: 'SET_WAKE_ALARM',
      label: `15 Min früher (${c})`,
      payload: {
        dateIso: new Date(earlier15).toISOString(),
        timeLabel: c,
        destName: opts.reasonLabel || 'Aufstehen',
        wakeMode: 'replace',
        replaceWakeAtMs: opts.wakeAtMs,
      },
    });
  }
  if (
    opts.suggestedEarlierMs != null &&
    opts.suggestedEarlierMs > Date.now() + 60_000 &&
    opts.suggestedEarlierMs < opts.wakeAtMs - 5 * 60_000
  ) {
    const alt = formatClockDe(opts.suggestedEarlierMs);
    quickActions.push({
      type: 'SET_WAKE_ALARM',
      label: `Früher ${alt}`,
      payload: {
        dateIso: new Date(opts.suggestedEarlierMs).toISOString(),
        timeLabel: alt,
        destName: opts.planHintTitle || opts.reasonLabel || 'Aufstehen',
        wakeMode: 'replace',
        replaceWakeAtMs: opts.wakeAtMs,
      },
    });
  }
  return { bullets: bullets.slice(0, 2), quickActions: quickActions.slice(0, 3) };
}

export function formatClockDe(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h}:${m.toString().padStart(2, '0')} Uhr`;
}

function parseExplicitWakeMs(text: string): number | null {
  const t = text.replace(/\s+/g, ' ').trim();
  // Transit-Abfahrt nie als Weckzeit (Compound läuft über timeCareExecute)
  try {
    const {
      extractTransitDepartureMs,
      extractWakeMsExcludingTransit,
      classifyTimeCareIntent,
    } = require('../concierge/timeCareIntent') as {
      extractTransitDepartureMs: (s: string) => number | null;
      extractWakeMsExcludingTransit: (s: string) => number | null;
      classifyTimeCareIntent: (
        s: string,
      ) => { kind: string } | null;
    };
    const care = classifyTimeCareIntent(t);
    if (
      care?.kind === 'compound_wake_transit' ||
      care?.kind === 'transit_leave'
    ) {
      return extractWakeMsExcludingTransit(t);
    }
    if (extractTransitDepartureMs(t) != null && !detectWakeAlarmIntent(t)) {
      return null;
    }
  } catch {
    /* soft */
  }

  // Temporal SSOT: „morgen um 8“ / „7 Uhr 30“ / „halb acht“ / Post-Midnight
  const fromSsot = resolveDateTimeMs({ text: t, defaultHour: 8 });
  if (
    fromSsot != null &&
    (hasClockHint(t) ||
      parseGermanClockHm(t) != null ||
      /\bmorgen\b/i.test(t) ||
      /\b(?:morgens|früh|frueh)\b/i.test(t))
  ) {
    if (fromSsot >= Date.now() + 20_000) return fromSsot;
  }

  const parsed = parseGermanClockHm(t);
  if (!parsed) return null;
  // Bei klarem Wake-Intent reicht die Zahl — sonst um/uhr/wecker
  if (
    !/\bum\b|\buhr\b|\bauf\s+\d|\bhalb\b/i.test(t) &&
    !/:\d{2}|\.\d{2}/.test(t) &&
    !detectWakeAlarmIntent(t)
  ) {
    if (!/\bwecker|alarm\b/i.test(t)) return null;
  }
  const h = parsed.hour;
  const m = parsed.minute;
  const d = new Date();
  d.setSeconds(0, 0);
  d.setHours(h, m, 0, 0);
  // „morgens“ / früh → wenn Stunde nachmittag-ähnlich und Kontext Morgen: 0–11
  if (
    /\b(?:morgens|früh|frueh)\b/i.test(t) &&
    h >= 1 &&
    h <= 11
  ) {
    /* keep morning hour */
  }
  if (d.getTime() < Date.now() + 2 * 60_000) {
    // Post-midnight: „um 8“ ohne Tag → anbrechender Morgen (heute), nicht +1 blind
    if (isPostMidnightWindow() && h >= 5) {
      /* already today */
    } else {
      d.setDate(d.getDate() + 1);
    }
  }
  return d.getTime();
}

function parsePrepOverride(text: string): number | null {
  const m = text.match(
    /\b(\d{1,2})\s*(?:min(?:uten)?)\s*(?:früher|frueher|vorbereiten|fertigmachen|buffer)?\b/i,
  );
  if (m) {
    const n = Number(m[1]);
    if (n >= 15 && n <= 120) return n;
  }
  if (/\bohne\s+frühstück|ohne\s+fruehstueck|schnell\s+fertig\b/i.test(text)) {
    return 30;
  }
  if (/\bmit\s+frühstück|mit\s+fruehstueck|gemütlich|gemuetlich\b/i.test(text)) {
    return 70;
  }
  return null;
}

export function buildWakeProposalFromLeaveBy(opts: {
  leaveByMs: number;
  departureMs?: number | null;
  reasonLabel: string;
  prepMin?: number;
  /** Extra Minuten wenn Frühstück vor dem Termin geplant ist */
  breakfastMin?: number | null;
}): WakeAlarmProposal | null {
  const breakfast = opts.breakfastMin != null && opts.breakfastMin > 0
    ? Math.min(90, Math.max(20, Math.round(opts.breakfastMin)))
    : 0;
  const prep = (opts.prepMin ?? DEFAULT_MORNING_PREP_MIN) + breakfast;
  const wakeAtMs = snapMsToQuarterHour(
    opts.leaveByMs - prep * 60_000,
    'down',
  );
  if (wakeAtMs < Date.now() + 60_000) return null;

  const wakeClock = formatClockDe(wakeAtMs);
  const leaveClock = formatClockDe(opts.leaveByMs);
  const breakfastBit = breakfast
    ? ` inkl. ~${breakfast} Min Frühstück`
    : '';
  const speech =
    `Für ${opts.reasonLabel} solltest du gegen ${leaveClock} los — ` +
    `mit ${prep} Minuten Fertigmachen${breakfastBit} wäre Aufstehen um ${wakeClock} passend. ` +
    `Wecker-Button ist dabei.`;

  const proposal: WakeAlarmProposal = {
    wakeAtMs,
    leaveByMs: opts.leaveByMs,
    departureMs: opts.departureMs ?? null,
    reasonLabel: opts.reasonLabel,
    prepMin: prep,
    speech,
    bullets: [
      `Aufstehen ${wakeClock}`,
      `Losgehen ${leaveClock}`,
      breakfast
        ? `${opts.prepMin ?? DEFAULT_MORNING_PREP_MIN} Min fertig + ~${breakfast} Min Frühstück`
        : `${prep} Min fertigmachen`,
    ],
    quickActions: [
      {
        type: 'SET_WAKE_ALARM',
        label: `Wecker ${wakeClock}`,
        payload: {
          dateIso: new Date(wakeAtMs).toISOString(),
          timeLabel: wakeClock,
          destName: opts.reasonLabel,
          textPrompt: opts.reasonLabel,
        },
      },
      {
        type: 'SHOW_MORE',
        label: 'Ohne Wecker',
        payload: { textPrompt: 'Kein Wecker, danke' },
      },
    ],
  };
  return proposal;
}

/**
 * Wenn Timeline ein Frühstück vor einem Morgen-Anker hat → Extra-Prep-Minuten.
 * Blaupause: Match 10:00 + Frühstück → Wecker früher.
 */
export function inferBreakfastPrepMinFromPlan(anchorStartMs: number): number {
  try {
    const { useFuturePlanStore } = require('../../module2/timeline/futurePlanState') as {
      useFuturePlanStore: {
        getState: () => {
          plan: {
            stops: Array<{
              title?: string;
              notes?: string | null;
              plannedStartMs?: number | null;
              plannedEndMs?: number | null;
              kind?: string;
            }>;
          };
        };
      };
    };
    const stops = useFuturePlanStore.getState().plan.stops ?? [];
    const breakfast = stops.find((s) => {
      const blob = `${s.title ?? ''} ${s.notes ?? ''}`;
      if (!/\b(frühstück|fruehstueck|breakfast|brunch)\b/i.test(blob)) {
        return false;
      }
      const t = s.plannedStartMs ?? s.plannedEndMs;
      if (t == null) return true;
      return t < anchorStartMs && t >= anchorStartMs - 4 * 60 * 60_000;
    });
    if (!breakfast) return 0;
    if (
      breakfast.plannedStartMs != null &&
      breakfast.plannedEndMs != null &&
      breakfast.plannedEndMs > breakfast.plannedStartMs
    ) {
      return Math.min(
        75,
        Math.max(
          25,
          Math.round(
            (breakfast.plannedEndMs - breakfast.plannedStartMs) / 60_000,
          ),
        ),
      );
    }
    return 40;
  } catch {
    return 0;
  }
}

async function proposalFromFlightPlan(
  plan: AirportArrivalPlan,
  text: string,
): Promise<WakeAlarmProposal | null> {
  const prep = parsePrepOverride(text) ?? DEFAULT_MORNING_PREP_MIN;
  const store = useFinnusStore.getState();
  const weather = await resolveWeatherRouting({
    lat: store.lastGpsLat ?? undefined,
    lng: store.lastGpsLng ?? undefined,
    stationName: 'Flughafen',
  });

  let leaveByMs: number | null = null;
  const transitLeave = plan.suggestedTransitLeave?.getTime() ?? null;
  if (transitLeave != null) {
    leaveByMs = transitLeave;
  } else {
    const flightDep =
      plan.flight.estimatedDeparture?.getTime() ??
      plan.flight.scheduledDeparture?.getTime() ??
      null;
    if (flightDep == null) return null;
    const airportWalk = applyWalkEtaWeatherMultiplier(
      35,
      weather?.walkEtaMultiplier ?? 1,
    );
    const leave = computeLeaveByMs({
      departureMs: flightDep,
      walkEtaMinutes: airportWalk,
      safetyBufferMin: DEFAULT_SAFETY_BUFFER_MIN,
      minLeadMs: 60_000,
    });
    leaveByMs = leave?.leaveByMs ?? null;
  }

  if (leaveByMs == null) return null;

  const dep =
    plan.flight.estimatedDeparture?.getTime() ??
    plan.flight.scheduledDeparture?.getTime() ??
    null;

  return buildWakeProposalFromLeaveBy({
    leaveByMs,
    departureMs: dep,
    reasonLabel: `Flug ${plan.flight.ident}`,
    prepMin: prep,
  });
}

/**
 * Voice: Wecker stellen / wann aufstehen — berechnet Vorschlag.
 */
function isWakeConfirm(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (/kein\s+wecker|ohne\s+wecker|nicht\s+stellen/i.test(t)) return false;
  return (
    /\b(ja[,.]?\s*)?(wecker\s+stellen|stell(?:e)?\s+(?:den\s+)?wecker|wecker\s+passt)\b/i.test(
      t,
    ) || /\bja\b.{0,24}\bwecker\b/i.test(t)
  );
}

export async function prepareWakeAlarmFollowUp(
  text: string,
): Promise<WakeAlarmProposal | null> {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return null;

  const prep = parsePrepOverride(t) ?? DEFAULT_MORNING_PREP_MIN;

  // 0) „Ja, Wecker stellen“ → Pending-Vorschlag sofort setzen (+ Timeline)
  if (isWakeConfirm(t) && pendingProposal?.wakeAtMs) {
    const proposal = pendingProposal;
    const wakeClock = formatClockDe(proposal.wakeAtMs);
    const { setWakeAlarmWithBridge } = await import('./nativeAlarmBridge');
    const result = await setWakeAlarmWithBridge({
      wakeAtMs: proposal.wakeAtMs,
      reasonLabel: proposal.reasonLabel || 'Wecker',
      leaveByMs: proposal.leaveByMs,
      reminderKey: `confirm:${proposal.wakeAtMs}`,
      preferNative: true,
      wakeMode: 'add',
    });
    pendingProposal = null;
    return {
      ...proposal,
      speech:
        result.message ||
        (result.ok
          ? buildWakeConfirmSpeech({ wakeAtMs: proposal.wakeAtMs, ok: true })
          : buildWakeConfirmSpeech({ wakeAtMs: proposal.wakeAtMs, ok: false })),
      bullets: result.ok ? [`⏰ ${wakeClock}`] : proposal.bullets,
      quickActions: result.ok
        ? []
        : [
            {
              type: 'SET_WAKE_ALARM',
              label: `Nochmal ${wakeClock}`,
              payload: {
                dateIso: new Date(proposal.wakeAtMs).toISOString(),
                timeLabel: wakeClock,
                destName: proposal.reasonLabel || 'Wecker',
              },
            },
          ],
    };
  }

  // 1) Explizite Uhrzeit → Just-Do-It (Android AlarmManager)
  // User-Zeit hat Vorrang: zuerst stellen, Plan-Hinweis nur optional danach.
  const explicit = parseExplicitWakeMs(t);
  if (explicit != null) {
    const wakeClock = formatClockDe(explicit);

    // Just-Do-It: neue explizite Zeit = umstellen (nicht Choice-Quiz).
    // Nur „zweiten/extra“ hält den alten Wecker und addiert.
    const forceAdd =
      /\b(zweiten|zweiter|noch\s+einen|zusätzlich|zusaetzlich|extra)\b/i.test(t);
    const voiceStyle = parseWakeVoiceStyle(t);
    const { setWakeAlarmWithBridge } = await import('./nativeAlarmBridge');
    const result = await setWakeAlarmWithBridge({
      wakeAtMs: explicit,
      reasonLabel: 'Aufstehen',
      reminderKey: `explicit:${explicit}`,
      preferNative: true,
      wakeMode: forceAdd ? 'add' : 'replace',
      voiceStyle,
    });
    pendingProposal = null;

    let planHintTitle: string | null = null;
    let extraActions: QuickAction[] = [];
    try {
      if (result.ok) {
        const { useFuturePlanStore } = require('../../module2/timeline/futurePlanState') as {
          useFuturePlanStore: {
            getState: () => {
              plan: {
                stops: Array<{
                  kind?: string;
                  id: string;
                  title: string;
                  plannedStartMs?: number | null;
                }>;
              };
            };
          };
        };
        const morningStops = useFuturePlanStore
          .getState()
          .plan.stops.filter((s) => {
            if (s.kind === 'nav_leg' || s.id.startsWith('choice_')) return false;
            if (s.plannedStartMs == null) return false;
            const h = new Date(s.plannedStartMs).getHours();
            return h >= 5 && h < 12;
          })
          .sort((a, b) => (a.plannedStartMs ?? 0) - (b.plannedStartMs ?? 0));
        const first = morningStops[0];
        if (first?.plannedStartMs != null) {
          const leaveByMs = first.plannedStartMs - 20 * 60_000;
          const neededWake = leaveByMs - prep * 60_000;
          if (
            explicit > neededWake + 5 * 60_000 &&
            neededWake > Date.now() + 60_000
          ) {
            const altClock = formatClockDe(neededWake);
            planHintTitle = first.title;
            extraActions = [
              {
                type: 'SET_WAKE_ALARM',
                label: `Früher ${altClock}`,
                payload: {
                  dateIso: new Date(neededWake).toISOString(),
                  timeLabel: altClock,
                  destName: first.title,
                  wakeMode: 'replace',
                  replaceWakeAtMs: explicit,
                },
              },
            ];
          }
        }
      }
    } catch {
      /* soft */
    }

    if (result.needsChoice && result.existingWakeAtMs != null) {
      const { buildWakeChoiceSpeech } = require('./wakeConfirmSpeech') as {
        buildWakeChoiceSpeech: (o: {
          existingWakeAtMs: number;
          newWakeAtMs: number;
        }) => string;
      };
      return {
        wakeAtMs: explicit,
        leaveByMs: null,
        departureMs: null,
        reasonLabel: 'Aufstehen',
        prepMin: 0,
        speech: buildWakeChoiceSpeech({
          existingWakeAtMs: result.existingWakeAtMs,
          newWakeAtMs: explicit,
        }),
        bullets: [],
        quickActions: [
          {
            type: 'SET_WAKE_ALARM',
            label: 'Zeit aktualisieren',
            payload: {
              dateIso: new Date(explicit).toISOString(),
              timeLabel: wakeClock,
              destName: 'Aufstehen',
              wakeMode: 'replace',
              replaceWakeAtMs: result.existingWakeAtMs,
            },
          },
          {
            type: 'SET_WAKE_ALARM',
            label: 'Zweiten stellen',
            payload: {
              dateIso: new Date(explicit).toISOString(),
              timeLabel: wakeClock,
              destName: 'Aufstehen',
              wakeMode: 'add',
            },
          },
        ],
      };
    }

    if (!result.ok) {
      return {
        wakeAtMs: explicit,
        leaveByMs: null,
        departureMs: null,
        reasonLabel: 'Aufstehen',
        prepMin: 0,
        speech:
          result.message ||
          `Wecker auf ${wakeClock} ging gerade nicht.`,
        bullets: [],
        quickActions: [
          {
            type: 'SET_WAKE_ALARM',
            label: `Nochmal ${wakeClock}`,
            payload: {
              dateIso: new Date(explicit).toISOString(),
              timeLabel: wakeClock,
              destName: 'Aufstehen',
            },
          },
        ],
      };
    }

    let suggestedEarlierMs: number | null = null;
    if (extraActions[0]?.payload?.dateIso) {
      const ms = Date.parse(String(extraActions[0].payload.dateIso));
      if (Number.isFinite(ms)) suggestedEarlierMs = ms;
    }
    const lean = !planHintTitle;
    const extras = buildWakeSuccessExtras({
      wakeAtMs: explicit,
      reasonLabel: 'Aufstehen',
      planHintTitle,
      suggestedEarlierMs,
      lean,
    });
    // Lean = nur Bestätigung; Plan-„Früher“ nur wenn Morgen-Stop wirklich greift
    const mergedActions = lean ? [] : [...extras.quickActions];
    if (!lean) {
      for (const a of extraActions) {
        if (!mergedActions.some((x) => x.label === a.label)) {
          mergedActions.push(a);
        }
      }
    }

    return {
      wakeAtMs: explicit,
      leaveByMs: null,
      departureMs: null,
      reasonLabel: 'Aufstehen',
      prepMin: 0,
      speech:
        result.message ||
        buildWakeConfirmSpeech({ wakeAtMs: explicit, ok: result.ok }),
      bullets: extras.bullets,
      quickActions: mergedActions.slice(0, 4),
    };
  }

  // 2) Flugnummer im Satz → Plan laden
  const code = extractFlightCode(t, { requireContext: true });
  if (code) {
    const flight = await prepareFlightFollowUp(`Flug ${code}`);
    if (flight?.plan) {
      rememberFlightPlanForAlarm(flight.plan);
      const proposal = await proposalFromFlightPlan(flight.plan, t);
      if (proposal) {
        // Combine flight status hint lightly
        pendingProposal = proposal;
        return proposal;
      }
    }
  }

  // 3) Letzter bekannter Flugplan
  if (lastFlightPlan) {
    const proposal = await proposalFromFlightPlan(lastFlightPlan, t);
    if (proposal) {
      pendingProposal = proposal;
      return proposal;
    }
  }

  // 4) Kein Anker — nachfragen
  const ask: WakeAlarmProposal = {
    wakeAtMs: 0,
    leaveByMs: null,
    departureMs: null,
    reasonLabel: '',
    prepMin: prep,
    speech:
      'Gerne — sag mir deine Flugnummer oder eine Uhrzeit, dann rechne ich den perfekten Aufsteh-Wecker (inkl. Fertigmachen und Wegzeit).',
    bullets: ['Flugnummer oder Uhrzeit nötig'],
    quickActions: [],
  };
  pendingProposal = null;
  return ask;
}

/** Append wake offer to an existing flight reply. */
export async function wakeOfferForFlightPlan(
  plan: AirportArrivalPlan,
): Promise<WakeAlarmProposal | null> {
  rememberFlightPlanForAlarm(plan);
  const proposal = await proposalFromFlightPlan(plan, '');
  if (proposal) pendingProposal = proposal;
  return proposal;
}
