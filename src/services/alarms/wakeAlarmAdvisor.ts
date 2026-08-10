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
import { resolveDateTimeMs, isPostMidnightWindow } from '../time/temporalGerman';

/** Zeit zum Fertigmachen (Dusche, Packen, Frühstück) vor dem Losgehen. */
export const DEFAULT_MORNING_PREP_MIN = 50;

const WAKE_INTENT =
  /\b(wecker|aufstehen|weck\s+mich|stell(?:e)?\s+(?:mir\s+)?(?:einen\s+)?wecker|erinner\s+mich\s+(?:morgen\s+)?(?:früh|frueh|um\s+\d)|wann\s+muss\s+ich\s+(?:aufstehen|los)|weckerschalten|wecker\s+(?:auf|um))\b/iu;

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

export function isWakeAlarmIntent(text: string): boolean {
  return WAKE_INTENT.test(text.replace(/\s+/g, ' ').trim());
}

export function formatClockDe(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h}:${m.toString().padStart(2, '0')} Uhr`;
}

function parseExplicitWakeMs(text: string): number | null {
  const t = text.replace(/\s+/g, ' ').trim();
  // Temporal SSOT: „morgen um 8“ / Post-Midnight
  const fromSsot = resolveDateTimeMs({ text: t, defaultHour: 8 });
  if (fromSsot != null && (/\bum\b|\buhr\b|:\d{2}/i.test(t) || /\bmorgen\b/i.test(t))) {
    if (fromSsot >= Date.now() + 20_000) return fromSsot;
  }

  const clock = t.match(/\b(?:um\s+)?(\d{1,2})(?::(\d{2}))?\s*(?:uhr)?\b/i);
  if (!clock) return null;
  if (!/\bum\b|\buhr\b|\bauf\s+\d/i.test(t) && !/:\d{2}/.test(t)) {
    if (!/\bwecker\b/i.test(t)) return null;
  }
  const h = Number(clock[1]);
  const m = Number(clock[2] ?? 0);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  const d = new Date();
  d.setSeconds(0, 0);
  d.setHours(h, m, 0, 0);
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
}): WakeAlarmProposal | null {
  const prep = opts.prepMin ?? DEFAULT_MORNING_PREP_MIN;
  const wakeAtMs = opts.leaveByMs - prep * 60_000;
  if (wakeAtMs < Date.now() + 60_000) return null;

  const wakeClock = formatClockDe(wakeAtMs);
  const leaveClock = formatClockDe(opts.leaveByMs);
  const speech =
    `Für ${opts.reasonLabel} solltest du gegen ${leaveClock} los — ` +
    `mit ${prep} Minuten Fertigmachen wäre Aufstehen um ${wakeClock} perfekt. ` +
    `Soll ich den Wecker stellen?`;

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
      `${prep} Min fertigmachen`,
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
          ? `Wecker auf ${wakeClock} gestellt — steht in der Timeline.`
          : `Wecker auf ${wakeClock} ging gerade nicht.`),
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
  const explicit = parseExplicitWakeMs(t);
  if (explicit != null) {
    const wakeClock = formatClockDe(explicit);

    // Plan-Konflikt: gewünschter Wecker zu spät für ersten Leave/Transit
    try {
      const { useFuturePlanStore } = require('../../module2/timeline/futurePlanState') as {
        useFuturePlanStore: {
          getState: () => {
            plan: {
              stops: Array<{
                kind?: string;
                id: string;
                title: string;
                plannedStartMs?: number | null;
                notes?: string;
              }>;
            };
          };
        };
      };
      const first = useFuturePlanStore
        .getState()
        .plan.stops.filter(
          (s) =>
            s.kind !== 'nav_leg' &&
            !s.id.startsWith('choice_') &&
            s.plannedStartMs != null,
        )
        .sort((a, b) => (a.plannedStartMs ?? 0) - (b.plannedStartMs ?? 0))[0];
      if (first?.plannedStartMs != null) {
        const leaveByMs = first.plannedStartMs - 20 * 60_000;
        const neededWake = leaveByMs - prep * 60_000;
        if (explicit > neededWake + 5 * 60_000) {
          const alt = buildWakeProposalFromLeaveBy({
            leaveByMs,
            reasonLabel: first.title,
            prepMin: prep,
          });
          if (alt) {
            pendingProposal = alt;
            return {
              ...alt,
              speech:
                `Ah nee — für ${first.title} solltest du eher gegen ${formatClockDe(leaveByMs)} los. ` +
                `Mit Fertigmachen wäre Aufstehen um ${formatClockDe(alt.wakeAtMs)} sinnvoller als ${wakeClock}. ` +
                `Wollen wir den Wecker lieber auf ${formatClockDe(alt.wakeAtMs)} stellen?`,
            };
          }
        }
      }
    } catch {
      /* soft */
    }

    const forceReplace =
      /\b(aktualisier|ersetz|änder|aender|verschieb)\b/i.test(t);
    const forceAdd =
      /\b(zweiten|zweiter|noch\s+einen|zusätzlich|zusaetzlich|extra)\b/i.test(t);
    const { setWakeAlarmWithBridge } = await import('./nativeAlarmBridge');
    const result = await setWakeAlarmWithBridge({
      wakeAtMs: explicit,
      reasonLabel: 'Wecker',
      reminderKey: `explicit:${explicit}`,
      preferNative: true,
      wakeMode: forceReplace ? 'replace' : forceAdd ? 'add' : undefined,
    });
    pendingProposal = null;

    if (result.needsChoice && result.existingWakeAtMs != null) {
      const oldClock = formatClockDe(result.existingWakeAtMs);
      return {
        wakeAtMs: explicit,
        leaveByMs: null,
        departureMs: null,
        reasonLabel: 'Wecker',
        prepMin: 0,
        // Kein „Soll ich…?“ — Auswahl nur über Action-Buttons
        speech: `Schon ein Wecker um ${oldClock}. Neu wäre ${wakeClock}.`,
        bullets: [],
        quickActions: [
          {
            type: 'SET_WAKE_ALARM',
            label: 'Aktualisieren',
            payload: {
              dateIso: new Date(explicit).toISOString(),
              timeLabel: wakeClock,
              destName: 'Wecker',
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
              destName: 'Wecker',
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
        reasonLabel: 'Wecker',
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
              destName: 'Wecker',
            },
          },
        ],
      };
    }
    return {
      wakeAtMs: explicit,
      leaveByMs: null,
      departureMs: null,
      reasonLabel: 'Wecker',
      prepMin: 0,
      speech: result.message || `Wecker auf ${wakeClock} gestellt.`,
      bullets: [],
      quickActions: [],
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
