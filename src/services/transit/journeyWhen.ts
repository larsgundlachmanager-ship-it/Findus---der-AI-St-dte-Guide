/**
 * Abfahrt/Ankunft aus User-Text für ÖPNV-Suche.
 * Live-Fahrplan zur genannten Zeit — nicht „nächste Bahn ab jetzt“.
 */

import { extractSpokenClock, extractSpokenEndClock } from '../research/extractSpokenClock';
import {
  detectRelativeDayKeyword,
  resolveRelativeDay,
} from '../time/temporalGerman';

export type JourneyWhen = {
  at: Date;
  /** Ankommen bis / spätestens vs. Abfahrt um. */
  kind: 'arrive' | 'depart';
};

const WEEKDAY: Array<[RegExp, number]> = [
  [/\bsonntag\b/iu, 0],
  [/\bmontag\b/iu, 1],
  [/\bdienstag\b/iu, 2],
  [/\bmittwoch\b/iu, 3],
  [/\bdonnerstag\b/iu, 4],
  [/\bfreitag\b/iu, 5],
  [/\bsamstag\b|\bsonnabend\b/iu, 6],
];

function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function nextWeekday(now: Date, weekday: number): Date {
  const d = startOfLocalDay(now);
  const cur = d.getDay();
  const add = (weekday - cur + 7) % 7;
  d.setDate(d.getDate() + add);
  return d;
}

function clockToHm(clock: string): { h: number; m: number } | null {
  const m = clock.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return { h, m: min };
}

function isArriveConstraint(text: string): boolean {
  return /\b(ankomm(?:en|e|t)?|anreise|eintreff|spätestens|spaetestens|bis\s+(?:spätestens|spaetestens|um)?)\b/iu.test(
    text,
  );
}

function dayFromText(text: string, now: Date): Date | null {
  const kw = detectRelativeDayKeyword(text);
  if (kw) return resolveRelativeDay(kw, now);
  for (const [re, wd] of WEEKDAY) {
    if (re.test(text)) return nextWeekday(now, wd);
  }
  return null;
}

/**
 * „morgen 14 Uhr“ → Abfahrt. „Mittwoch spätestens 18 Uhr ankommen“ → Ankunft.
 * Ohne Uhrzeit: null (dann nächste Live-Verbindung ab jetzt).
 */
export function parseJourneyWhen(
  text: string,
  now = new Date(),
): JourneyWhen | null {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const arrive = isArriveConstraint(t);
  const clock =
    (arrive ? extractSpokenEndClock(t) : null) ||
    extractSpokenClock(t) ||
    extractSpokenEndClock(t);
  if (!clock) return null;
  const hm = clockToHm(clock);
  if (!hm) return null;

  const day = dayFromText(t, now) ?? startOfLocalDay(now);
  const at = new Date(day);
  at.setHours(hm.h, hm.m, 0, 0);

  const explicitToday = /\bheute\b/iu.test(t);
  const hadDay = dayFromText(t, now) != null;
  if (at.getTime() < now.getTime() + 90_000) {
    if (explicitToday) return null;
    if (hadDay && WEEKDAY.some(([re]) => re.test(t))) {
      at.setDate(at.getDate() + 7);
    } else if (!hadDay) {
      at.setDate(at.getDate() + 1);
    }
  }
  return { at, kind: arrive ? 'arrive' : 'depart' };
}

export function journeyPlanTimeOpts(
  text: string,
  now = new Date(),
): { arriveBy?: Date; departAt?: Date } {
  const when = parseJourneyWhen(text, now);
  if (!when) return {};
  if (when.kind === 'arrive') return { arriveBy: when.at };
  return { departAt: when.at };
}
