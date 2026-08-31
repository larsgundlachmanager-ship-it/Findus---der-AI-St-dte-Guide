/**
 * Nach Pitch-Wahl: Gastro abends = Route / Reservieren / Speisekarte.
 * Sonst: jetzt = Nav, später = Timeline + Leave-by.
 * Struktur-Blaupause — Wortlaut frei.
 */

import type { PitchOptionCard, PitchKind } from './types';
import { NAV_ACTION_SOON_MS, shouldSuppressNavActions } from './navActionPolicy';

export type PitchTimingMode = 'now' | 'later' | 'ask' | 'dining_fork';

/** Ob wir nach Option-Tap nach jetzt/später / Route|Reservieren fragen. */
export function resolvePitchTimingMode(opts: {
  visitAtMs?: number | null;
  userText?: string | null;
  pitchKind?: PitchKind | null;
}): PitchTimingMode {
  const t = (opts.userText || '').toLowerCase();
  const food =
    opts.pitchKind === 'food' ||
    opts.pitchKind === 'bar' ||
    /\b(essen|restaurant|café|cafe|imbiss)\b/iu.test(t);
  if (/\b(jetzt|gleich|sofort|los\s+jetzt)\b/iu.test(t)) return 'now';
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
  return food ? 'dining_fork' : 'ask';
}

export function pitchTimingAskSpeech(): string {
  return 'Möchtest du jetzt hin, oder soll ich das später einplanen und dir Bescheid sagen, wann du los musst?';
}

/** Gastro nach Wahl: Route und/oder Tisch — kein Pflichtwortlaut. */
export function pitchDiningForkSpeech(placeName: string): string {
  const n = (placeName || 'den Ort').trim();
  return `Gute Wahl — ${n}. Direkt hin, oder zur Sicherheit erst einen Tisch reservieren?`;
}

export function pitchTimingLaterSpeech(placeName: string): string {
  const n = (placeName || 'den Ort').trim();
  return `Super — ${n} steht in deiner Timeline. Ich sage dir Bescheid, wann du los musst.`;
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
  return acts.slice(0, 3);
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

/** Route starten + optional Reservieren + Speisekarte. */
export function pitchDiningForkActions(opt: PitchOptionCard): Array<{
  type: 'START_NAVIGATION' | 'OPEN_URL';
  label: string;
  payload: Record<string, unknown>;
}> {
  const acts: Array<{
    type: 'START_NAVIGATION' | 'OPEN_URL';
    label: string;
    payload: Record<string, unknown>;
  }> = [
    {
      type: 'START_NAVIGATION',
      label: 'Route starten',
      payload: navPayloadForChoice(opt),
    },
  ];
  const reserveUrl =
    opt.bookingUrl ||
    opt.websiteUrl ||
    (opt.mapsUrl && /reserve|reserv|table|tisch/i.test(opt.mapsUrl)
      ? opt.mapsUrl
      : null);
  if (reserveUrl) {
    acts.push({
      type: 'OPEN_URL',
      label: 'Tisch reservieren',
      payload: { url: reserveUrl, destName: opt.name },
    });
  } else if (opt.mapsUrl) {
    acts.push({
      type: 'OPEN_URL',
      label: 'Tisch reservieren',
      payload: {
        url: opt.mapsUrl,
        destName: opt.name,
        hint: 'reserve',
      },
    });
  }
  if (opt.menuUrl) {
    acts.push({
      type: 'OPEN_URL',
      label: '🍽 Speisekarte',
      payload: { url: opt.menuUrl, destName: opt.name },
    });
  }
  return acts.slice(0, 4);
}

export { NAV_ACTION_SOON_MS };
