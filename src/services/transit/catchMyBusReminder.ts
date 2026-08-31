/**
 * Catch-my-Bus: proaktive Erinnerung (In-App-TTS + OS Push).
 * Trigger: „Wann muss ich los?“ / „Erinnere mich, wenn ich zum Bus muss.“
 * Leave-by: T_departure − ETA_walk − Buffer_safety (8–10 Min).
 */

import { speakAssistantText } from '../AudioVoiceService';
import { getVoiceSettingsForTour } from '../ttsService';
import {
  computeLeaveByTime,
  type PacingResult,
} from './livePacingEngine';
import type { TransitDeparture } from './transitAdvisor';
import {
  cancelReminderById,
  scheduleTransitDepartureReminder,
} from '../notifications/notificationService';
import {
  buildTransitReminderBody,
  clampSafetyBufferMin,
  DEFAULT_SAFETY_BUFFER_MIN,
  minutesUntilDepartureAtLeave,
} from '../notifications/reminderMath';
import { registerDepartureWatch } from '../logistics/logisticsTriggerEngine';

export type CatchMyBusReminder = {
  id: string;
  line: string;
  direction: string;
  departure: Date;
  leaveBy: Date;
  walkEtaMin: number;
  safetyBufferMin: number;
  destinationHint: string | null;
  timer: ReturnType<typeof setTimeout> | null;
  /** Expo local notification id (background / locked screen). */
  pushNotificationId: string | null;
};

const REMINDER_QUERY =
  /\b(wann\s+muss\s+ich\s+los|erinner(?:e|ung)?\s+mich|weck\s+mich|sag\s+bescheid|catch[\s-]?my[\s-]?bus|zum\s+(?:bus|zug|bahn)\s+muss|zur\s+bahn|losgehen|aufbrechen|leave[-\s]?by|nicht\s+(?:den\s+)?(?:zug|bus|bahn)\s+verpassen)\b/iu;

let activeReminder: CatchMyBusReminder | null = null;

export function isCatchMyBusQuery(text: string): boolean {
  return REMINDER_QUERY.test(text.trim());
}

export function getActiveCatchMyBusReminder(): CatchMyBusReminder | null {
  return activeReminder;
}

export function clearCatchMyBusReminder(): void {
  if (activeReminder?.timer) {
    clearTimeout(activeReminder.timer);
  }
  if (activeReminder?.pushNotificationId) {
    void cancelReminderById(activeReminder.pushNotificationId);
  }
  if (activeReminder) {
    void cancelReminderById(`transit:catch:${activeReminder.id}`);
  }
  activeReminder = null;
}

function formatClock(d: Date): string {
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

export function buildCatchMyBusConfirmSpeech(opts: {
  line: string;
  departure: Date;
  leaveBy: Date;
  walkEtaMin: number;
  destinationHint?: string | null;
}): string {
  const untilLeave = Math.max(
    0,
    Math.round((opts.leaveBy.getTime() - Date.now()) / 60_000),
  );
  const dest = opts.destinationHint
    ? ` nach ${opts.destinationHint}`
    : '';
  if (untilLeave <= 0) {
    return (
      `Hey! Dein Bus${dest} (${opts.line}) fährt um ${formatClock(opts.departure)} Uhr. ` +
      `Du solltest jetzt langsam aufbrechen — Fußweg ca. ${opts.walkEtaMin} Minuten.` +
      todoSuffix()
    );
  }
  return (
    `Alles klar — ich erinnere dich. ` +
    `Die ${opts.line}${dest} fährt um ${formatClock(opts.departure)} Uhr. ` +
    `In etwa ${untilLeave} Minuten sag ich Bescheid, dann hast du noch ${opts.walkEtaMin} Minuten Fußweg plus Puffer.` +
    todoSuffix()
  );
}

function todoSuffix(): string {
  return '';
}

export function buildCatchMyBusAlertSpeech(opts: {
  line: string;
  departure: Date;
  walkEtaMin: number;
  leaveBy?: Date;
  destinationHint?: string | null;
  stationName?: string | null;
}): string {
  const leaveBy = opts.leaveBy?.getTime() ?? Date.now();
  const untilDep = minutesUntilDepartureAtLeave(
    opts.departure.getTime(),
    leaveBy,
  );
  return buildTransitReminderBody({
    line: opts.line,
    minutesUntilDeparture: untilDep,
    stationName: opts.stationName ?? undefined,
    destName: opts.destinationHint ?? undefined,
  });
}

/**
 * Plant In-App-TTS + OS-Push zum Leave-by-Zeitpunkt
 * (funktioniert auch bei minimierter App / gesperrtem Screen).
 */
export function scheduleCatchMyBusReminder(opts: {
  departure: TransitDeparture;
  walkEtaMin: number;
  safetyBufferMin?: number;
  destinationHint?: string | null;
  stationName?: string | null;
  destLat?: number | null;
  destLng?: number | null;
  /** IBNR / Stop für Live-Verspätungs-Poll */
  stopId?: string | null;
}): { reminder: CatchMyBusReminder; confirmSpeech: string } {
  clearCatchMyBusReminder();

  const safety = clampSafetyBufferMin(
    opts.safetyBufferMin ?? DEFAULT_SAFETY_BUFFER_MIN,
  );
  const leaveBy = computeLeaveByTime({
    departureLive: opts.departure.when,
    walkEtaMin: opts.walkEtaMin,
    safetyBufferMin: safety,
  });

  const id = `bus_${Date.now()}`;
  const delayMs = Math.max(1_000, leaveBy.getTime() - Date.now());

  const reminder: CatchMyBusReminder = {
    id,
    line: opts.departure.line,
    direction: opts.departure.direction,
    departure: opts.departure.when,
    leaveBy,
    walkEtaMin: opts.walkEtaMin,
    safetyBufferMin: safety,
    destinationHint: opts.destinationHint ?? null,
    timer: null,
    pushNotificationId: null,
  };

  // OS local notification (background / lock screen)
  void scheduleTransitDepartureReminder({
    departureMs: opts.departure.when.getTime(),
    walkEtaMinutes: opts.walkEtaMin,
    line: opts.departure.line,
    stationName: opts.stationName ?? opts.destinationHint ?? undefined,
    safetyBufferMin: safety,
    reminderKey: `catch:${id}`,
  })
    .then((res) => {
      if (res.ok && activeReminder?.id === id) {
        activeReminder.pushNotificationId = res.notificationId;
      }
    })
    .catch((e) => console.warn('[catchMyBus] push schedule failed', e));

  // Insider-Settings + progressive checks (Grob/Prep/Safety/Leave)
  registerDepartureWatch({
    eventId: `catch-bus-${id}`,
    title: opts.departure.line,
    departureMs: opts.departure.when.getTime(),
    walkEtaMin: opts.walkEtaMin,
    mode: 'bus',
    stationName: opts.stationName ?? opts.destinationHint ?? null,
    delayMin:
      opts.departure.delaySec != null
        ? Math.max(0, Math.round(opts.departure.delaySec / 60))
        : 0,
    externalId: id,
    detail: opts.destinationHint
      ? `Richtung ${opts.destinationHint}`
      : opts.departure.direction || undefined,
    scheduleOsPush: false,
    destLat: opts.destLat ?? null,
    destLng: opts.destLng ?? null,
    destName: opts.stationName ?? opts.destinationHint ?? null,
    stopId: opts.stopId ?? null,
    directionHint: opts.destinationHint ?? opts.departure.direction ?? null,
    platform: opts.departure.platform ?? null,
    connectionStatus: opts.departure.cancelled
      ? 'cancelled'
      : opts.departure.delaySec != null && opts.departure.delaySec >= 180
        ? 'delayed'
        : 'ok',
    warnLeadMin: 30,
    planPriority: 1,
  });

  // Foreground TTS fallback (when app process is alive)
  reminder.timer = setTimeout(() => {
    void (async () => {
      try {
        const voice = await getVoiceSettingsForTour();
        const speech = buildCatchMyBusAlertSpeech({
          line: reminder.line,
          departure: reminder.departure,
          walkEtaMin: reminder.walkEtaMin,
          leaveBy: reminder.leaveBy,
          destinationHint: reminder.destinationHint,
          stationName: opts.stationName,
        });
        await speakAssistantText(speech, {
          voiceId: voice.voiceId,
          speechRate: voice.speechRate,
        });
      } catch (e) {
        console.warn('[catchMyBus] alert failed', e);
      } finally {
        if (activeReminder?.id === id) activeReminder = null;
      }
    })();
  }, delayMs);

  activeReminder = reminder;

  return {
    reminder,
    confirmSpeech: buildCatchMyBusConfirmSpeech({
      line: reminder.line,
      departure: reminder.departure,
      leaveBy: reminder.leaveBy,
      walkEtaMin: reminder.walkEtaMin,
      destinationHint: reminder.destinationHint,
    }),
  };
}

/** Nutzt bestehende TransitAdvice-/Pacing-Daten für die Erinnerung. */
export function scheduleFromPacing(opts: {
  pacing: PacingResult;
  walkEtaMin: number;
  destinationHint?: string | null;
  stationName?: string | null;
}): { reminder: CatchMyBusReminder; confirmSpeech: string } | null {
  if (opts.pacing.scenario === 'missed') return null;
  return scheduleCatchMyBusReminder({
    departure: {
      line: opts.pacing.line,
      direction: opts.pacing.direction,
      when: opts.pacing.departure,
      plannedWhen: null,
      delaySec:
        opts.pacing.delayMin != null ? opts.pacing.delayMin * 60 : null,
      cancelled: false,
      planned: false,
    },
    walkEtaMin: opts.walkEtaMin,
    destinationHint: opts.destinationHint,
    stationName: opts.stationName,
  });
}
