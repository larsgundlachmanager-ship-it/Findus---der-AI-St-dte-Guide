/**
 * Nach Pitch-Wahl: Gastro abends = Route / Reservieren / Speisekarte.
 * Sonst: jetzt = Nav, später = Timeline + Leave-by.
 * Struktur-Blaupause — Wortlaut frei.
 */

import type { QuickAction } from '../../types/concierge';
import type { PitchOptionCard, PitchKind } from './types';
import { NAV_ACTION_SOON_MS, shouldSuppressNavActions } from './navActionPolicy';

export type PitchTimingMode = 'now' | 'later' | 'ask' | 'dining_fork';

function isVisitOtherCalendarDay(visitAtMs?: number | null): boolean {
  if (typeof visitAtMs !== 'number' || !Number.isFinite(visitAtMs)) return false;
  try {
    const { dateKeyFromMs, todayDateKey } = require('../../utils/dateKeys') as {
      dateKeyFromMs: (ms: number) => string;
      todayDateKey: (n?: number) => string;
    };
    return dateKeyFromMs(visitAtMs) !== todayDateKey();
  } catch {
    return visitAtMs > Date.now() + 12 * 60 * 60_000;
  }
}

/** Ob wir nach Option-Tap nach jetzt/später / Route|Reservieren fragen. */
export function resolvePitchTimingMode(opts: {
  visitAtMs?: number | null;
  userText?: string | null;
  pitchKind?: PitchKind | null;
}): PitchTimingMode {
  const t = (opts.userText || '')
    .toLowerCase()
    .replace(
      /\b(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)abends?\b/giu,
      '$1 abend',
    );
  const food =
    opts.pitchKind === 'food' ||
    opts.pitchKind === 'bar' ||
    /\b(essen|restaurant|café|cafe|imbiss)\b/iu.test(t);
  // Explizit „jetzt“ schlägt Freitag — sonst nie Sofort-Route bei anderem Tag
  if (/\b(jetzt|gleich|sofort|los\s+jetzt)\b/iu.test(t)) return 'now';
  // Anderer Kalendertag (Freitag …) → einplanen + Tisch, kein „Jetzt hin?“
  if (food && isVisitOtherCalendarDay(opts.visitAtMs)) return 'later';
  if (
    food &&
    /\b(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/iu.test(
      t,
    ) &&
    !/\bheute\b/iu.test(t)
  ) {
    return 'later';
  }
  // Gastro + morgen/Vormittag: Timing fragen (nicht sofort Nav)
  if (
    food &&
    /\b(morgen|vormittag|frühstück|fruehstueck|morgens)\b/iu.test(t)
  ) {
    return 'dining_fork';
  }
  if (/\b(später|spaeter|einplanen|morgen)\b/iu.test(t) && !food) {
    return 'later';
  }
  // Gastro: Route vs. Tisch — auch „heute Abend“ / visitAt später
  if (food) {
    const eveningish =
      /\b(abend|tonight|dinner|heute\s+abend)\b/iu.test(t) ||
      (typeof opts.visitAtMs === 'number' &&
        opts.visitAtMs > Date.now() + 20 * 60_000);
    if (
      eveningish ||
      shouldSuppressNavActions({
        visitAtMs: opts.visitAtMs,
        forceSoon: false,
      })
    ) {
      return 'dining_fork';
    }
  }
  if (
    !shouldSuppressNavActions({
      visitAtMs: opts.visitAtMs,
      forceSoon: false,
    })
  ) {
    return 'now';
  }
  // Später Besuch (>~10 Min): Timeline + Leave-by — nicht erst nachfragen.
  return food ? 'dining_fork' : 'later';
}

export function pitchTimingAskSpeech(): string {
  return 'Möchtest du jetzt hin, oder soll ich das später einplanen und dir Bescheid sagen, wann du los musst?';
}

/** Gastro nach Wahl: erst Timing (jetzt vs. Abend/morgen), dann Route oder Timeline+Tisch. */
export function pitchDiningForkSpeech(placeName: string): string {
  const n = (placeName || 'den Ort').trim();
  return `Gute Wahl — ${n}. Möchtest du jetzt hin, oder sollen wir einen Zeitpunkt einplanen und den Tisch vorbereiten?`;
}

export function pitchTimingLaterSpeech(placeName: string): string {
  const n = (placeName || 'den Ort').trim();
  return `Alles klar — ${n} ist eingeplant. Soll ich den Tisch vorbereiten?`;
}

/** Buttons nach Auto-Einplanen (anderer Tag / später). */
export function pitchTimingLaterActions(opt: PitchOptionCard): Array<{
  type: 'OPEN_URL' | 'SET_DEPARTURE_REMINDER';
  label: string;
  payload: Record<string, unknown>;
}> {
  const acts: Array<{
    type: 'OPEN_URL' | 'SET_DEPARTURE_REMINDER';
    label: string;
    payload: Record<string, unknown>;
  }> = [];
  const reserveUrl = opt.bookingUrl || opt.websiteUrl || null;
  if (reserveUrl) {
    acts.push({
      type: 'OPEN_URL',
      label: 'Tisch reservieren',
      payload: { url: reserveUrl, destName: opt.name },
    });
  }
  if (opt.menuUrl) {
    acts.push({
      type: 'OPEN_URL',
      label: '🍽 Speisekarte',
      payload: { url: opt.menuUrl, destName: opt.name },
    });
  } else if (opt.websiteUrl && opt.websiteUrl !== reserveUrl) {
    acts.push({
      type: 'OPEN_URL',
      label: '🍽 Speisekarte',
      payload: { url: opt.websiteUrl, destName: opt.name },
    });
  }
  return acts.slice(0, 3);
}

/** Laufende Nav → Stopp einfügen, nicht Route ersetzen. */
function navPayloadForChoice(opt: PitchOptionCard): Record<string, unknown> {
  const base: Record<string, unknown> = {
    destName: opt.name,
    destLat: opt.lat,
    destLng: opt.lng,
  };
  try {
    const { useFinnusStore } = require('../../store/useFinnusStore') as {
      useFinnusStore: { getState: () => { navActive?: boolean } };
    };
    if (useFinnusStore.getState().navActive === true) {
      base.addStop = true;
    }
  } catch {
    /* soft */
  }
  return base;
}

export function pitchTimingNowActions(opt: PitchOptionCard): Array<{
  type: 'START_NAVIGATION' | 'OPEN_URL';
  label: string;
  payload: Record<string, unknown>;
}> {
  let navActive = false;
  try {
    const { useFinnusStore } = require('../../store/useFinnusStore') as {
      useFinnusStore: { getState: () => { navActive?: boolean } };
    };
    navActive = useFinnusStore.getState().navActive === true;
  } catch {
    navActive = false;
  }
  const acts: Array<{
    type: 'START_NAVIGATION' | 'OPEN_URL';
    label: string;
    payload: Record<string, unknown>;
  }> = [
    {
      type: 'START_NAVIGATION',
      label: (navActive ? `➕ ${opt.name}` : `📍 ${opt.name}`).slice(0, 28),
      payload: navPayloadForChoice(opt),
    },
  ];
  if (opt.menuUrl) {
    acts.push({
      type: 'OPEN_URL',
      label: '🍽 Speisekarte',
      payload: { url: opt.menuUrl, destName: opt.name },
    });
  }
  try {
    const {
      prioritizeEvidenceButtons,
      dropGenericWebWhenEvidence,
    } = require('./evidenceButtons') as {
      prioritizeEvidenceButtons: <T>(a: T[], o?: { max?: number }) => T[];
      dropGenericWebWhenEvidence: <T>(a: T[]) => T[];
    };
    return prioritizeEvidenceButtons(dropGenericWebWhenEvidence(acts), {
      max: 3,
    });
  } catch {
    return acts.slice(0, 3);
  }
}

export function pitchTimingAskActions(opt: PitchOptionCard): Array<{
  type: 'START_NAVIGATION' | 'SET_DEPARTURE_REMINDER';
  label: string;
  payload: Record<string, unknown>;
}> {
  return [
    {
      type: 'START_NAVIGATION',
      label: 'Jetzt los',
      payload: navPayloadForChoice(opt),
    },
    {
      type: 'SET_DEPARTURE_REMINDER',
      label: 'Später einplanen',
      payload: {
        destName: opt.name,
        destLat: opt.lat,
        destLng: opt.lng,
        label: opt.name,
        pitchTiming: 'later',
      },
    },
  ];
}

/**
 * Nach Gastro-Wahl: nur Timing-Buttons (jetzt vs. heute Abend).
 * Reservierung/Speisekarte erst nach „heute Abend“ bzw. explizitem Follow-up —
 * nicht alles auf einmal.
 */
export function pitchDiningForkActions(opt: PitchOptionCard): Array<{
  type: 'START_NAVIGATION' | 'SET_DEPARTURE_REMINDER' | 'OPEN_URL';
  label: string;
  payload: Record<string, unknown>;
}> {
  const acts: Array<{
    type: 'START_NAVIGATION' | 'SET_DEPARTURE_REMINDER' | 'OPEN_URL';
    label: string;
    payload: Record<string, unknown>;
  }> = [
    {
      type: 'START_NAVIGATION',
      label: 'Jetzt hin',
      payload: {
        ...navPayloadForChoice(opt),
        preferWalk: false,
        pitchTiming: 'now',
      },
    },
    {
      type: 'SET_DEPARTURE_REMINDER',
      label: 'Einplanen',
      payload: {
        destName: opt.name,
        destLat: opt.lat,
        destLng: opt.lng,
        label: opt.name,
        pitchTiming: 'later',
        offerReserve: true,
      },
    },
  ];
  const reserveUrl =
    opt.bookingUrl ||
    opt.websiteUrl ||
    null;
  if (reserveUrl) {
    acts.push({
      type: 'OPEN_URL',
      label: 'Tisch reservieren',
      payload: { url: reserveUrl, destName: opt.name },
    });
  } else if (opt.menuUrl) {
    acts.push({
      type: 'OPEN_URL',
      label: '🍽 Speisekarte',
      payload: { url: opt.menuUrl, destName: opt.name },
    });
  }
  return acts.slice(0, 3);
}

export { NAV_ACTION_SOON_MS };

/** „Einplanen Rindox um 19 Uhr“ nach Timing-Fork — Timeline + kurze Bestätigung. */
export async function tryCommitPitchEinplanenFromText(
  text: string,
): Promise<{
  speech: string;
  bullets: string[];
  quickActions: QuickAction[];
  cardTitle: string;
} | null> {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (!/\beinplanen\b/iu.test(t) && !/\bum\s+\d{1,2}/iu.test(t)) return null;
  const clockM = t.match(/\bum\s+(\d{1,2})(?:[:.](\d{2}))?\s*(?:uhr)?\b/iu);
  if (!clockM) return null;
  const hh = Math.min(23, Math.max(0, Number(clockM[1])));
  const mm = clockM[2] != null ? Math.min(59, Number(clockM[2])) : 0;
  try {
    const { useLivePitchStore } = require('./publishPitchUi') as {
      useLivePitchStore: {
        getState: () => {
          requestId: string | null;
          options: Array<{
            id: string;
            name: string;
            lat: number;
            lng: number;
            mapsUrl?: string;
            menuUrl?: string | null;
            actions?: unknown[];
          }>;
          selectedOptionId: string | null;
          pitchKind: string | null;
          pitchContext: string | null;
        };
      };
    };
    const live = useLivePitchStore.getState();
    const opt =
      live.options.find((o) => o.id === live.selectedOptionId) || live.options[0];
    if (!opt || !live.requestId) return null;
    const now = new Date();
    const visit = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      hh,
      mm,
      0,
      0,
    );
    if (visit.getTime() < now.getTime() - 5 * 60_000) {
      visit.setDate(visit.getDate() + 1);
    }
    const { mirrorLivePitchChoiceToTimeline } = require('./mirrorLivePitchToTimeline') as {
      mirrorLivePitchChoiceToTimeline: (o: {
        requestId: string;
        option: typeof opt;
        visitAtMs: number;
        pitchKind: string | null;
        pitchContext: string | null;
      }) => void;
    };
    mirrorLivePitchChoiceToTimeline({
      requestId: live.requestId,
      option: opt,
      visitAtMs: visit.getTime(),
      pitchKind: live.pitchKind,
      pitchContext: live.pitchContext,
    });
    const stopId = `live_pitch_${live.requestId}`;
    let leaveByMs: number | null = null;
    let leaveSpeech = '';
    try {
      const { applyDiningDeparturePlan } = require('../timeline/planMealDeparture') as {
        applyDiningDeparturePlan: (o: {
          stopId: string;
          venueTitle: string;
          destLat: number;
          destLng: number;
          appointmentMs: number;
        }) => {
          primary: { leaveByMs: number; label: string; travelMin: number } | null;
          speechFacts: string[];
        };
      };
      if (Number.isFinite(opt.lat) && Number.isFinite(opt.lng)) {
        const dep = applyDiningDeparturePlan({
          stopId,
          venueTitle: opt.name,
          destLat: opt.lat,
          destLng: opt.lng,
          appointmentMs: visit.getTime(),
        });
        if (dep.primary) {
          leaveByMs = dep.primary.leaveByMs;
          const leaveClock = new Date(dep.primary.leaveByMs).toLocaleTimeString(
            'de-DE',
            { hour: '2-digit', minute: '2-digit' },
          );
          leaveSpeech = ` Los ca. ${leaveClock} (${dep.primary.label}, ~${dep.primary.travelMin} Min).`;
        }
      }
    } catch {
      /* soft */
    }
    try {
      const { usePlanCalendarUiStore } = require('../timeline/planCalendarUiStore') as {
        usePlanCalendarUiStore: {
          getState: () => {
            clearShortAnswers: () => void;
            requestOpen?: () => void;
          };
        };
      };
      usePlanCalendarUiStore.getState().clearShortAnswers();
      // Los >10 Min → Timeline kurz zeigen
      const leaveGuess = leaveByMs ?? visit.getTime() - 35 * 60_000;
      if (leaveGuess > Date.now() + 10 * 60_000) {
        usePlanCalendarUiStore.getState().requestOpen?.();
      }
    } catch {
      /* soft */
    }
    const clock = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    return {
      speech: `Alles klar — ${opt.name} um ${clock} in der Timeline.${leaveSpeech}`,
      bullets: [
        opt.name,
        `um ${clock}`,
        leaveByMs
          ? `Los ${new Date(leaveByMs).toLocaleTimeString('de-DE', {
              hour: '2-digit',
              minute: '2-digit',
            })}`
          : '',
      ].filter(Boolean),
      quickActions: [],
      cardTitle: 'Eingetragen',
    };
  } catch {
    return null;
  }
}
