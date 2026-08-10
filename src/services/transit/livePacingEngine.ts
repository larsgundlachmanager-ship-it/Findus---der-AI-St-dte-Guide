/**
 * Dynamic ÖPNV Live-Pacing:
 * Buffer = Dep_live − (now + ETA_walk)
 * → Entwarnung / Ansporn / Neu-Berechnung.
 */

import type { JourneyItinerary } from './journeyPlanner';
import { recalculateMissedConnection } from './journeyPlanner';
import type { TransitDeparture } from './transitAdvisor';
import {
  formatMissedSilentHud,
  type MissedConnectionPick,
  type MissedRebookMode,
} from './missedConnectionPolicy';

export type PacingScenario = 'relaxed' | 'tight' | 'missed' | 'ok';

export type PacingResult = {
  scenario: PacingScenario;
  bufferMin: number;
  walkEtaMin: number;
  minutesUntilDeparture: number;
  delayMin: number | null;
  line: string;
  direction: string;
  departure: Date;
  speech: string;
  /** Neu berechnete Verbindung bei missed. */
  nextConnection?: JourneyItinerary | null;
  /** Entscheidung: silent vs. aktiver Prompt. */
  missedMode?: MissedRebookMode | null;
  missedPick?: MissedConnectionPick | null;
};

const RELAXED_BUFFER_MIN = 5;
const TIGHT_BUFFER_MIN = 3;

function formatClock(d: Date): string {
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

function minutesUntil(d: Date, now = new Date()): number {
  return Math.round((d.getTime() - now.getTime()) / 60_000);
}

/**
 * Kernformel: Buffer = Dep_live − (CurrentTime + ETA_walk)
 */
export function computeTransitBuffer(opts: {
  departureLive: Date;
  walkEtaMin: number;
  now?: Date;
}): number {
  const now = opts.now ?? new Date();
  const arrivalAtStop = now.getTime() + opts.walkEtaMin * 60_000;
  return Math.round((opts.departureLive.getTime() - arrivalAtStop) / 60_000);
}

export function evaluateLivePacing(opts: {
  departure: TransitDeparture | {
    line: string;
    direction: string;
    when: Date;
    delaySec: number | null;
    cancelled?: boolean;
  };
  walkEtaMin: number;
  now?: Date;
}): Omit<PacingResult, 'speech' | 'nextConnection' | 'missedMode' | 'missedPick'> {
  const now = opts.now ?? new Date();
  const dep = opts.departure;
  const delayMin =
    dep.delaySec == null ? null : Math.round(dep.delaySec / 60);
  const until = minutesUntil(dep.when, now);
  const bufferMin = computeTransitBuffer({
    departureLive: dep.when,
    walkEtaMin: opts.walkEtaMin,
    now,
  });

  let scenario: PacingScenario = 'ok';
  if (dep.cancelled || until < 0 || bufferMin < -1) {
    scenario = 'missed';
  } else if (bufferMin <= TIGHT_BUFFER_MIN) {
    scenario = 'tight';
  } else if (bufferMin >= RELAXED_BUFFER_MIN && (delayMin ?? 0) >= 2) {
    scenario = 'relaxed';
  } else if (bufferMin >= RELAXED_BUFFER_MIN) {
    scenario = 'ok';
  }

  return {
    scenario,
    bufferMin,
    walkEtaMin: opts.walkEtaMin,
    minutesUntilDeparture: Math.max(0, until),
    delayMin,
    line: dep.line,
    direction: dep.direction,
    departure: dep.when,
  };
}

export function formatPacingSpeech(
  pacing: Omit<PacingResult, 'speech' | 'nextConnection' | 'missedMode' | 'missedPick'>,
  opts?: {
    nextConnection?: JourneyItinerary | null;
    missedPick?: MissedConnectionPick | null;
  },
): string {
  const line = pacing.line.replace(/\s+/g, ' ');
  const y = pacing.delayMin ?? 0;
  const until = pacing.minutesUntilDeparture;
  const walk = pacing.walkEtaMin;

  if (pacing.scenario === 'relaxed') {
    return (
      `Entwarnung: Die Linie ${line} hat aktuell ${y} Minuten Verspätung. ` +
      `Du kannst entspannt laufen und hast keinen Stress.`
    );
  }

  if (pacing.scenario === 'tight') {
    return (
      `Achtung: Die ${line} Richtung ${pacing.direction} fährt in ${until} Minuten — ` +
      `du brauchst noch etwa ${walk} Minuten zur Haltestelle. ` +
      `Enger Puffer — wenn du es ruhig angehen willst, nimm lieber die nächste.`
    );
  }

  if (pacing.scenario === 'missed') {
    const pick = opts?.missedPick;
    if (pick?.mode === 'silent_same_line') {
      return pick.toastOrPing || formatMissedSilentHud(pick);
    }
    if (pick?.promptSpeech) {
      return pick.promptSpeech;
    }
    const next = pick?.primary ?? opts?.nextConnection;
    if (next?.firstTransitDeparture) {
      const t = formatClock(next.firstTransitDeparture);
      const nextLine = next.firstTransitLine || 'nächste Verbindung';
      return (
        `Die geplante Bahn ist weg, die nächste ${nextLine} kommt um ${t} Uhr. ` +
        `Warten oder Alternative suchen?`
      );
    }
    return (
      `Die ${line} Richtung ${pacing.direction} ist gerade weg. ` +
      `Ich schaue nach der nächsten Verbindung.`
    );
  }

  // ok
  if (y > 0) {
    return (
      `Die ${line} Richtung ${pacing.direction} fährt um ${formatClock(pacing.departure)} Uhr ab — ` +
      `aktuell ${y} Minuten Verspätung. Mit ${walk} Minuten zur Haltestelle hast du etwa ${pacing.bufferMin} Minuten Puffer.`
    );
  }
  return (
    `Die ${line} Richtung ${pacing.direction} fährt um ${formatClock(pacing.departure)} Uhr. ` +
    `Weg zur Haltestelle ca. ${walk} Minuten — das passt entspannt.`
  );
}

/**
 * Volle Auswertung inkl. optionaler Neu-Routung bei verpasster Verbindung.
 */
export async function runLivePacing(opts: {
  departure: TransitDeparture;
  walkEtaMin: number;
  from?: { lat: number; lng: number } | null;
  to?: { lat: number; lng: number } | null;
  now?: Date;
  /** Wenn true: kein Rebook (z. B. bereits in_transit). */
  skipRebook?: boolean;
}): Promise<PacingResult> {
  const base = evaluateLivePacing({
    departure: opts.departure,
    walkEtaMin: opts.walkEtaMin,
    now: opts.now,
  });

  let nextConnection: JourneyItinerary | null | undefined;
  let missedPick: MissedConnectionPick | null | undefined;
  let missedMode: MissedRebookMode | null | undefined;

  if (base.scenario === 'missed' && !opts.skipRebook && opts.from && opts.to) {
    missedPick = await recalculateMissedConnection({
      from: opts.from,
      to: opts.to,
      after: opts.now ?? new Date(),
      preferLine: opts.departure.line,
      missedLineLabel: opts.departure.line,
    });
    nextConnection = missedPick.primary;
    missedMode = missedPick.mode;
  }

  return {
    ...base,
    nextConnection,
    missedMode: missedMode ?? null,
    missedPick: missedPick ?? null,
    speech: formatPacingSpeech(base, {
      nextConnection,
      missedPick: missedPick ?? null,
    }),
  };
}

/** Leave-by-Zeit für Catch-my-Bus: Dep − ETA − Safety. */
export function computeLeaveByTime(opts: {
  departureLive: Date;
  walkEtaMin: number;
  safetyBufferMin?: number;
}): Date {
  const safety = opts.safetyBufferMin ?? 9;
  const ms =
    opts.departureLive.getTime() -
    (opts.walkEtaMin + safety) * 60_000;
  return new Date(ms);
}
