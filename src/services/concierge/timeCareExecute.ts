/**
 * Time-Care Execution — Wecker / Erinnerung / Leave-by wirklich stellen.
 * Nutzt timeCareIntent-Klassifikation; kein Script-Wortlaut.
 */

import type { QuickAction } from '../../types/concierge';
import {
  classifyTimeCareIntent,
  DEFAULT_TRANSIT_WALK_MIN,
  extractTransitDepartureMs,
  extractWakeMsExcludingTransit,
  type TimeCareKind,
} from './timeCareIntent';
import {
  buildWakeProposalFromLeaveBy,
  DEFAULT_MORNING_PREP_MIN,
  formatClockDe,
  inferBreakfastPrepMinFromPlan,
} from '../alarms/wakeAlarmAdvisor';
import {
  computeLeaveByMs,
  DEFAULT_SAFETY_BUFFER_MIN,
} from '../notifications/reminderMath';

export type TimeCareExecResult = {
  kind: TimeCareKind | 'wake' | 'timer' | 'reminder' | 'parking';
  speech: string;
  bullets: string[];
  quickActions: QuickAction[];
  cardTitle: string;
};

function parsePrepMin(text: string): number {
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
  return DEFAULT_MORNING_PREP_MIN;
}

function transitModeFromText(
  text: string,
): 'train' | 'bus' | 'ferry' | 'flight' | 'transit' {
  if (/\b(?:flug|flieger|flughafen)\b/iu.test(text)) return 'flight';
  if (/\b(?:fähre|faehre|ferry)\b/iu.test(text)) return 'ferry';
  if (/\b(?:bus|tram|straßenbahn|strassenbahn|u-?bahn)\b/iu.test(text)) {
    return 'bus';
  }
  if (/\b(?:bahn|zug|ice|s-?bahn|öpnv|oepnv|bahnhof)\b/iu.test(text)) {
    return 'train';
  }
  return 'transit';
}

/**
 * Compound oder reiner Transit mit bekannter Abfahrtszeit:
 * Leave-by schedulen + optional Wecker rückwärts.
 */
export async function executeTransitAndOptionalWake(
  text: string,
  opts?: { forceWake?: boolean },
): Promise<TimeCareExecResult | null> {
  const t = text.replace(/\s+/g, ' ').trim();
  const care = classifyTimeCareIntent(t);
  const wantWake =
    opts?.forceWake === true ||
    care?.kind === 'compound_wake_transit' ||
    care?.kind === 'wake';

  const departureMs = extractTransitDepartureMs(t);
  if (departureMs == null) {
    // Live-ÖPNV-Pfad (Haltestelle / nächste Bahn)
    try {
      const { prepareTransitFollowUp } = await import('../transit/transitAdvisor');
      const follow = await prepareTransitFollowUp(t);
      if (!follow) return null;

      // Compound ohne Uhr: nach Leave-by aus Catch-my-Bus Wecker setzen
      if (wantWake) {
        const { getActiveCatchMyBusReminder } = await import(
          '../transit/catchMyBusReminder'
        );
        const active = getActiveCatchMyBusReminder();
        if (active?.leaveBy) {
          const prep = parsePrepMin(t);
          const breakfast = inferBreakfastPrepMinFromPlan(
            active.leaveBy.getTime(),
          );
          const proposal = buildWakeProposalFromLeaveBy({
            leaveByMs: active.leaveBy.getTime(),
            departureMs: active.departure.getTime(),
            reasonLabel: `${active.line} · Leave-by`,
            prepMin: prep,
            breakfastMin: breakfast,
          });
          if (proposal) {
            const { setWakeAlarmWithBridge } = await import(
              '../alarms/nativeAlarmBridge'
            );
            const wake = await setWakeAlarmWithBridge({
              wakeAtMs: proposal.wakeAtMs,
              reasonLabel: proposal.reasonLabel,
              leaveByMs: proposal.leaveByMs,
              reminderKey: `compound:${proposal.wakeAtMs}`,
              preferNative: true,
              wakeMode: 'add',
            });
            return {
              kind: 'compound_wake_transit',
              speech: [
                follow.reply,
                wake.ok
                  ? `Wecker steht auf ${formatClockDe(proposal.wakeAtMs)}.`
                  : proposal.speech,
              ]
                .filter(Boolean)
                .join(' '),
              bullets: [
                ...proposal.bullets.slice(0, 2),
                `Abfahrt ${formatClockDe(active.departure.getTime())}`,
              ],
              quickActions: wake.ok ? [] : proposal.quickActions,
              cardTitle: 'Bahn + Wecker',
            };
          }
        }
      }

      return {
        kind: care?.kind === 'compound_wake_transit' ? 'compound_wake_transit' : 'transit_leave',
        speech: follow.reply,
        bullets: [
          follow.advice.stationName
            ? `🚏 ${follow.advice.stationName}`
            : 'ÖPNV',
          follow.advice.walkMinutes != null
            ? `Fuß ~${follow.advice.walkMinutes} Min`
            : '',
        ].filter(Boolean),
        quickActions: follow.offerNavigation
          ? [
              {
                type: 'START_NAVIGATION' as const,
                label: follow.advice.hasJourneyNav
                  ? 'ÖPNV starten'
                  : `Route ${follow.advice.stationName}`,
                payload: {
                  destLat: follow.advice.stationPoi.lat,
                  destLng: follow.advice.stationPoi.lng,
                  destName: follow.advice.stationName,
                  targetPoiId: follow.advice.stationPoi.id,
                  journeyNav: follow.advice.hasJourneyNav === true,
                },
              },
            ]
          : [],
        cardTitle: wantWake ? 'Bahn + Wecker' : 'Leave-by',
      };
    } catch {
      return null;
    }
  }

  const walkMin = DEFAULT_TRANSIT_WALK_MIN;
  const leave = computeLeaveByMs({
    departureMs,
    walkEtaMinutes: walkMin,
    safetyBufferMin: DEFAULT_SAFETY_BUFFER_MIN,
    minLeadMs: 30_000,
  });
  if (!leave) {
    return {
      kind: 'transit_leave',
      speech:
        'Die Abfahrt ist so nah — Leave-by bringt jetzt wenig. Am besten gleich los.',
      bullets: [`Abfahrt ${formatClockDe(departureMs)}`],
      quickActions: [],
      cardTitle: 'Leave-by',
    };
  }

  const mode = transitModeFromText(t);
  const title =
    mode === 'flight'
      ? 'Flug'
      : mode === 'bus'
        ? 'Bus'
        : mode === 'ferry'
          ? 'Fähre'
          : 'Bahn';

  try {
    const { registerDepartureWatch } = await import(
      '../logistics/logisticsTriggerEngine'
    );
    registerDepartureWatch({
      eventId: `voice-transit:${departureMs}`,
      title,
      departureMs,
      walkEtaMin: walkMin,
      mode: mode === 'transit' ? 'train' : mode,
      detail: t.slice(0, 120),
      scheduleOsPush: true,
    });
  } catch {
    try {
      const { scheduleLeaveByReminder } = await import(
        '../notifications/notificationService'
      );
      await scheduleLeaveByReminder({
        departureMs,
        walkEtaMinutes: walkMin,
        mode,
        title,
        safetyBufferMin: DEFAULT_SAFETY_BUFFER_MIN,
        reminderKey: `voice-transit:${departureMs}`,
      });
    } catch {
      /* soft */
    }
  }

  const leaveClock = formatClockDe(leave.leaveByMs);
  const depClock = formatClockDe(departureMs);

  if (!wantWake) {
    return {
      kind: 'transit_leave',
      speech: `Alles klar — Abfahrt ${depClock}. Ich erinner dich um ${leaveClock} zum Losgehen (Fuß ~${walkMin} Min + Puffer).`,
      bullets: [
        `🚂 Abfahrt ${depClock}`,
        `🚪 Leave-by ${leaveClock}`,
        `Fuß ~${walkMin} Min`,
      ],
      quickActions: [],
      cardTitle: 'Leave-by',
    };
  }

  // Explizite Weckzeit (nicht Abfahrt) oder rückwärts aus Leave-by
  const explicitWake = extractWakeMsExcludingTransit(t);
  const breakfast = inferBreakfastPrepMinFromPlan(leave.leaveByMs);
  const prep = parsePrepMin(t);

  let wakeAtMs = explicitWake;
  if (wakeAtMs == null) {
    const proposal = buildWakeProposalFromLeaveBy({
      leaveByMs: leave.leaveByMs,
      departureMs,
      reasonLabel: `${title} ${depClock}`,
      prepMin: prep,
      breakfastMin: breakfast,
    });
    wakeAtMs = proposal?.wakeAtMs ?? null;
  }

  if (wakeAtMs == null) {
    return {
      kind: 'compound_wake_transit',
      speech: `Leave-by steht auf ${leaveClock} für Abfahrt ${depClock}. Für den Wecker sag mir bitte eine Uhrzeit — oder „weck mich früh genug“ nochmal, wenn du mehr Vorlauf willst.`,
      bullets: [`🚂 Abfahrt ${depClock}`, `🚪 Leave-by ${leaveClock}`],
      quickActions: [],
      cardTitle: 'Bahn + Wecker',
    };
  }

  try {
    const { setWakeAlarmWithBridge } = await import(
      '../alarms/nativeAlarmBridge'
    );
    const wake = await setWakeAlarmWithBridge({
      wakeAtMs,
      reasonLabel: `${title} ${depClock}`,
      leaveByMs: leave.leaveByMs,
      reminderKey: `compound-wake:${wakeAtMs}`,
      preferNative: true,
      wakeMode: 'add',
    });
    try {
      const { registerWakeRhythm } = await import(
        '../logistics/logisticsTriggerEngine'
      );
      registerWakeRhythm({
        wakeAtMs,
        reasonLabel: `${title} ${depClock}`,
        leaveByMs: leave.leaveByMs,
        linkedEventId: `voice-transit:${departureMs}`,
      });
    } catch {
      /* soft */
    }

    const wakeClock = formatClockDe(wakeAtMs);
    return {
      kind: 'compound_wake_transit',
      speech: wake.ok
        ? `Passt — Abfahrt ${depClock}, Leave-by ${leaveClock}, Wecker ${wakeClock}.`
        : `Leave-by ${leaveClock} für ${depClock} ist drin; Wecker auf ${wakeClock} ging gerade nicht.`,
      bullets: [
        `⏰ Wecker ${wakeClock}`,
        `🚪 Leave-by ${leaveClock}`,
        `🚂 Abfahrt ${depClock}`,
      ],
      quickActions: wake.ok
        ? []
        : [
            {
              type: 'SET_WAKE_ALARM',
              label: `Wecker ${wakeClock}`,
              payload: {
                dateIso: new Date(wakeAtMs).toISOString(),
                timeLabel: wakeClock,
                destName: `${title} ${depClock}`,
              },
            },
          ],
      cardTitle: 'Bahn + Wecker',
    };
  } catch {
    return {
      kind: 'compound_wake_transit',
      speech: `Leave-by ${leaveClock} für Abfahrt ${depClock} ist notiert.`,
      bullets: [`🚪 Leave-by ${leaveClock}`, `🚂 Abfahrt ${depClock}`],
      quickActions: [],
      cardTitle: 'Bahn + Wecker',
    };
  }
}
