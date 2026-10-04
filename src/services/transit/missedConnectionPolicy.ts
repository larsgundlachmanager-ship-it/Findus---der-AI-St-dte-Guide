/**
 * Verpasste / ausgefallene / stark verspätete Bahn — Entscheidungslogik (SSOT).
 *
 * too_slow / cancelled / heavy_delay → still umbuchen + Timeline korrigieren,
 * wenn eine bessere/fangbare Verbindung da ist.
 * Nur bei uneindeutiger langer Wartezeit ohne klaren ETA-Gewinn → Prompt.
 */

import type { JourneyItinerary } from './journeyPlanner';

/** Unter diesem Warte-Wert: stilles Umbuchen (gleiche Linie). */
export const MISSED_SILENT_WAIT_MAX_MIN = 10;
/** Alternativ-Route still nehmen / anbieten wenn so viel früher am Ziel. */
export const MISSED_FASTEST_ETA_WIN_MIN = 15;
/** Ab dieser Verspätung (Min) Alternativen prüfen. */
export const HEAVY_DELAY_MIN = 15;

export type MissedTriggerReason =
  | 'too_slow'
  | 'cancelled'
  | 'heavy_delay'
  | 'missed_departed'
  | 'earlier_available'
  | 'generic';

export type MissedRebookMode =
  | 'silent_same_line'
  | 'silent_best'
  | 'active_prompt';

export type MissedConnectionPick = {
  mode: MissedRebookMode;
  reason: MissedTriggerReason;
  /** Gewählte Option (wird bei silent_* direkt angewendet). */
  primary: JourneyItinerary | null;
  /** Nur gesetzt wenn ETA-Gewinn klar — Speech/HUD. */
  fastestAlternate: JourneyItinerary | null;
  waitMinForPrimary: number;
  etaGainMin: number;
  preferLine: string | null;
  sameLineFound: boolean;
  toastOrPing: string;
  /** Volle Frage nur bei active_prompt. */
  promptSpeech: string | null;
  /** Kurze Ansage bei silent Rebook. */
  applySpeech: string | null;
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

/** Nur wenn Live-Tafel abgefahren zeigt oder wait klar vorbei — nie nur ETA-Puffer. */
export function isDepartureClearlyMissed(opts: {
  nowMs: number;
  armedDepMs: number;
  /** Live-Board whenMs derselben Fahrt / Folgefahrt. */
  boardWhenMs?: number | null;
  /** Sekunden bis Abfahrt (negativ = laut Plan/Board schon weg). */
  waitSec?: number | null;
  pastGraceMs?: number;
}): boolean {
  const grace = Math.max(20_000, opts.pastGraceMs ?? 45_000);
  const waitSec =
    opts.waitSec != null && Number.isFinite(opts.waitSec)
      ? opts.waitSec
      : null;
  if (waitSec != null && waitSec <= -Math.ceil(grace / 1000)) {
    return true;
  }
  const board = opts.boardWhenMs;
  if (board != null && Number.isFinite(board)) {
    // Noch kommende Abfahrt (Verspätung) → nicht verpasst.
    if (board > opts.nowMs + 15_000) return false;
    return opts.nowMs > board + grace;
  }
  // Ohne Board: strengere Zeit-Grace als ETA-Puffer (nicht nur +20s).
  return opts.nowMs > opts.armedDepMs + Math.max(grace, 90_000);
}

export function decideMissedRebookMode(waitMin: number): MissedRebookMode {
  return waitMin < MISSED_SILENT_WAIT_MAX_MIN
    ? 'silent_same_line'
    : 'active_prompt';
}

/**
 * Soll die neue Verbindung still übernommen werden?
 * too_slow / cancelled immer (wenn primary da).
 * heavy_delay wenn still_best oder klarer ETA-Gewinn.
 */
export function shouldAutoApplyMissedPick(pick: MissedConnectionPick): boolean {
  if (!pick.primary) return false;
  if (pick.mode === 'silent_same_line' || pick.mode === 'silent_best') {
    return true;
  }
  if (
    (pick.reason === 'too_slow' ||
      pick.reason === 'cancelled' ||
      pick.reason === 'earlier_available') &&
    pick.primary
  ) {
    return true;
  }
  return false;
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
 * Rankt Itineraries und entscheidet Auto-Apply vs. Prompt.
 */
export function pickMissedConnection(opts: {
  itineraries: JourneyItinerary[];
  preferLine?: string | null;
  nowMs?: number;
  missedLineLabel?: string | null;
  reason?: MissedTriggerReason;
  /** Aktuelle Verspätung der geplanten Fahrt (Min), für heavy_delay. */
  delayMin?: number | null;
}): MissedConnectionPick {
  const nowMs = opts.nowMs ?? Date.now();
  const prefer = opts.preferLine?.trim() || null;
  const reason: MissedTriggerReason = opts.reason ?? 'generic';
  const list = opts.itineraries.filter(Boolean);
  const empty: MissedConnectionPick = {
    mode: 'active_prompt',
    reason,
    primary: null,
    fastestAlternate: null,
    waitMinForPrimary: 0,
    etaGainMin: 0,
    preferLine: prefer,
    sameLineFound: false,
    toastOrPing: 'Keine passende Folgeverbindung gefunden.',
    promptSpeech:
      'Die geplante Bahn ist weg — keine passende Folgeverbindung gefunden.',
    applySpeech: null,
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

  // Primärwahl je Auslöser
  let primary: JourneyItinerary;
  let mode: MissedRebookMode;

  if (reason === 'too_slow' || reason === 'missed_departed') {
    // Fangbar: gleiche Linie wenn Wartezeit ok, sonst schnellste — immer still.
    if (same && waitMinUntilDepart(same, nowMs) < MISSED_SILENT_WAIT_MAX_MIN + 5) {
      primary = same;
      mode = 'silent_same_line';
    } else if (
      fastestAlternate &&
      etaGainMin > MISSED_FASTEST_ETA_WIN_MIN
    ) {
      primary = fastestAlternate;
      mode = 'silent_best';
    } else {
      primary = same ?? fastest;
      mode =
        waitMinUntilDepart(primary, nowMs) < MISSED_SILENT_WAIT_MAX_MIN
          ? 'silent_same_line'
          : 'silent_best';
    }
  } else if (reason === 'earlier_available') {
    // Frühere / andere Fahrt als geplant — still die schnellste fangbare nehmen.
    primary = fastest;
    mode = 'silent_best';
  } else if (reason === 'cancelled') {
    // Ausfall → beste fangbare Route still.
    if (fastestAlternate && etaGainMin > MISSED_FASTEST_ETA_WIN_MIN) {
      primary = fastestAlternate;
      mode = 'silent_best';
    } else {
      primary = fastest;
      mode = 'silent_best';
    }
  } else if (reason === 'heavy_delay') {
    // Nur umbuchen wenn eine Alternative klar früher am Ziel ist.
    if (fastestAlternate && etaGainMin > MISSED_FASTEST_ETA_WIN_MIN) {
      primary = fastestAlternate;
      mode = 'silent_best';
    } else {
      return {
        ...empty,
        mode: 'active_prompt',
        primary: null,
        promptSpeech: null,
        applySpeech: null,
        toastOrPing: 'Verspätung — keine klar bessere Alternative.',
      };
    }
  } else {
    primary = same ?? fastest;
    mode = decideMissedRebookMode(waitMinUntilDepart(primary, nowMs));
    if (
      mode === 'active_prompt' &&
      fastestAlternate &&
      etaGainMin > MISSED_FASTEST_ETA_WIN_MIN
    ) {
      // Klare bessere Route → still nehmen statt fragen.
      primary = fastestAlternate;
      mode = 'silent_best';
    }
  }

  const waitMin = waitMinUntilDepart(primary, nowMs);
  const primaryLine =
    primary.firstTransitLine?.trim() ||
    opts.missedLineLabel?.trim() ||
    'nächste Bahn';
  const primaryDep = primary.firstTransitDeparture ?? primary.startTime;
  const waitLabel = waitMin <= 1 ? 'gleich' : `in ${waitMin} Minuten`;
  const toastOrPing = `Nächste ${primaryLine} ${waitLabel}.`;

  let promptSpeech: string | null = null;
  let applySpeech: string | null = null;

  if (mode === 'active_prompt') {
    if (fastestAlternate && etaGainMin > MISSED_FASTEST_ETA_WIN_MIN) {
      const altLine =
        fastestAlternate.firstTransitLine?.trim() || 'Alternative';
      promptSpeech =
        `Wir können ${waitMin} Minuten auf die nächste ${primaryLine} warten. ` +
        `Wenn du jetzt auf ${altLine} gehst, bist du etwa ${etaGainMin} Minuten früher da. ` +
        `Warten oder Alternative?`;
    } else {
      promptSpeech =
        `Die geplante Bahn ist weg, die nächste ${primaryLine} kommt in ${waitMin} Minuten. ` +
        `Warten oder Alternative suchen?`;
    }
  } else {
    const clock = formatClock(primaryDep);
    if (reason === 'too_slow' || reason === 'missed_departed') {
      applySpeech =
        `Die schaffen wir nicht mehr. Neue Verbindung: ${primaryLine} um ${clock}` +
        (waitMin > 0 ? ` — etwa ${waitMin} Minuten.` : '.');
    } else if (reason === 'earlier_available') {
      applySpeech =
        `Es geht früher: ${primaryLine} um ${clock}` +
        (waitMin > 0 ? ` — etwa ${waitMin} Minuten.` : '.');
    } else if (reason === 'cancelled') {
      applySpeech =
        `${opts.missedLineLabel || 'Die Bahn'} fällt aus. Ich nehme ${primaryLine} um ${clock}.`;
    } else if (reason === 'heavy_delay') {
      applySpeech =
        mode === 'silent_best'
          ? `Starke Verspätung — bessere Route: ${primaryLine} um ${clock}.`
          : `${primaryLine} hat Verspätung — nächste sinnvolle Abfahrt um ${clock}.`;
    } else {
      applySpeech =
        `${opts.missedLineLabel || 'Bahn'} um ${formatClock(new Date(nowMs))} ist weg. ` +
        `Nächste: ${primaryLine} um ${clock}` +
        (waitMin > 0 ? ` — etwa ${waitMin} Minuten warten.` : '.');
    }
  }

  return {
    mode,
    reason,
    primary,
    fastestAlternate,
    waitMinForPrimary: waitMin,
    etaGainMin,
    preferLine: prefer,
    sameLineFound,
    toastOrPing,
    promptSpeech,
    applySpeech,
  };
}

export function formatMissedSilentHud(pick: MissedConnectionPick): string {
  if (!pick.primary) return pick.toastOrPing;
  const line = pick.primary.firstTransitLine || 'Bahn';
  const dep = pick.primary.firstTransitDeparture ?? pick.primary.startTime;
  return `Nächste ${line} um ${formatClock(dep)} (~${pick.waitMinForPrimary} Min).`;
}
