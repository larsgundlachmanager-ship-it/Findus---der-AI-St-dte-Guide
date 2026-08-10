/**
 * Verpasste Bahn — Entscheidungslogik (SSOT).
 *
 * Trigger-Kontext (Caller): Am Bahnhof + Abfahrt vorbei + not in_transit.
 *
 * < 10 Min Wartezeit → stilles Umbuchen (gleiche Linie).
 * ≥ 10 Min → aktiver Prompt.
 * Default: gleiche Linie. Fastest nur wenn > 15 Min früher am Ziel.
 */

import type { JourneyItinerary } from './journeyPlanner';

/** Unter diesem Warte-Wert: silent same-line rebook. */
export const MISSED_SILENT_WAIT_MAX_MIN = 10;
/** Alternativ-Route nur pushen, wenn sie so viel früher am Ziel ist. */
export const MISSED_FASTEST_ETA_WIN_MIN = 15;

export type MissedRebookMode = 'silent_same_line' | 'active_prompt';

export type MissedConnectionPick = {
  mode: MissedRebookMode;
  /** Gewählte Default-Option (meist gleiche Linie). */
  primary: JourneyItinerary | null;
  /** Nur gesetzt wenn ETA-Gewinn > 15 Min — als Alternative pushen. */
  fastestAlternate: JourneyItinerary | null;
  waitMinForPrimary: number;
  /** Minuten früher am Ziel (primary vs fastest), 0 wenn keine Alt. */
  etaGainMin: number;
  preferLine: string | null;
  sameLineFound: boolean;
  toastOrPing: string;
  /** Volle Frage nur bei active_prompt. */
  promptSpeech: string | null;
};

function normalizeLine(raw: string | null | undefined): string {
  return (raw ?? '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9äöüß]/gi, '');
}

export function linesMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = normalizeLine(a);
  const nb = normalizeLine(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

export function decideMissedRebookMode(waitMin: number): MissedRebookMode {
  return waitMin < MISSED_SILENT_WAIT_MAX_MIN
    ? 'silent_same_line'
    : 'active_prompt';
}

function arrivalMs(it: JourneyItinerary): number {
  return it.endTime.getTime();
}

function waitMinUntilDepart(
  it: JourneyItinerary,
  nowMs: number,
): number {
  const dep = it.firstTransitDeparture?.getTime() ?? it.startTime.getTime();
  return Math.max(0, Math.round((dep - nowMs) / 60_000));
}

function formatClock(d: Date): string {
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Rankt Itineraries: gleiche Linie zuerst, sonst früheste Ankunft.
 * Fastest-Alternate nur wenn >15 Min besser als Warten auf gleiche Linie.
 */
export function pickMissedConnection(opts: {
  itineraries: JourneyItinerary[];
  preferLine?: string | null;
  nowMs?: number;
  missedLineLabel?: string | null;
}): MissedConnectionPick {
  const nowMs = opts.nowMs ?? Date.now();
  const prefer = opts.preferLine?.trim() || null;
  const list = opts.itineraries.filter(Boolean);
  const empty: MissedConnectionPick = {
    mode: 'active_prompt',
    primary: null,
    fastestAlternate: null,
    waitMinForPrimary: 0,
    etaGainMin: 0,
    preferLine: prefer,
    sameLineFound: false,
    toastOrPing: 'Keine passende Folgeverbindung gefunden.',
    promptSpeech:
      'Die geplante Bahn ist weg. Soll ich nach einer Alternative suchen?',
  };
  if (!list.length) return empty;

  const sameLine = prefer
    ? list
        .filter((it) => linesMatch(it.firstTransitLine, prefer))
        .sort(
          (a, b) =>
            (a.firstTransitDeparture?.getTime() ?? a.startTime.getTime()) -
            (b.firstTransitDeparture?.getTime() ?? b.startTime.getTime()),
        )
    : [];

  const byArrival = [...list].sort((a, b) => arrivalMs(a) - arrivalMs(b));
  const fastest = byArrival[0]!;
  const same = sameLine[0] ?? null;
  const sameLineFound = Boolean(same);

  // Default: gleiche Linie (Bequemlichkeit). Sonst schnellste.
  const primary = same ?? fastest;
  const waitMin = waitMinUntilDepart(primary, nowMs);
  const mode = decideMissedRebookMode(waitMin);

  let fastestAlternate: JourneyItinerary | null = null;
  let etaGainMin = 0;
  if (same && fastest && !linesMatch(fastest.firstTransitLine, prefer)) {
    const gain = Math.round(
      (arrivalMs(same) - arrivalMs(fastest)) / 60_000,
    );
    if (gain > MISSED_FASTEST_ETA_WIN_MIN) {
      fastestAlternate = fastest;
      etaGainMin = gain;
    }
  }

  const primaryLine =
    primary.firstTransitLine?.trim() ||
    opts.missedLineLabel?.trim() ||
    'nächste Bahn';
  const primaryDep =
    primary.firstTransitDeparture ?? primary.startTime;
  const waitLabel = waitMin <= 1 ? 'gleich' : `in ${waitMin} Minuten`;

  const toastOrPing = `Nächste ${primaryLine} ${waitLabel}.`;

  let promptSpeech: string | null = null;
  if (mode === 'active_prompt') {
    if (fastestAlternate && etaGainMin > MISSED_FASTEST_ETA_WIN_MIN) {
      const altLine =
        fastestAlternate.firstTransitLine?.trim() || 'Alternative';
      promptSpeech =
        `Wir können ${waitMin} Minuten auf die nächste ${primaryLine} warten. ` +
        `Wenn du jetzt umsteigst auf ${altLine}, bist du etwa ${etaGainMin} Minuten früher da. ` +
        `Was machen wir — warten oder Alternative?`;
    } else {
      promptSpeech =
        `Die geplante Bahn ist weg, die nächste ${primaryLine} kommt in ${waitMin} Minuten. ` +
        `Warten oder Alternative suchen?`;
    }
  }

  return {
    mode,
    primary,
    fastestAlternate,
    waitMinForPrimary: waitMin,
    etaGainMin,
    preferLine: prefer,
    sameLineFound,
    toastOrPing,
    promptSpeech,
  };
}

export function formatMissedSilentHud(pick: MissedConnectionPick): string {
  if (!pick.primary) return pick.toastOrPing;
  const line = pick.primary.firstTransitLine || 'Bahn';
  const dep = pick.primary.firstTransitDeparture ?? pick.primary.startTime;
  return `Nächste ${line} um ${formatClock(dep)} (~${pick.waitMinForPrimary} Min).`;
}
