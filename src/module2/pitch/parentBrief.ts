/**
 * Parent-Helfer: searchMode + visitAt + Pref-Slice + Bridge-Länge.
 */

import type {
  PitchKind,
  PitchPrefSlice,
  PitchSearchMode,
  PitchWish,
} from './types';

const BEST_CITY_RE =
  /\b(beste[rn]?|den\s+besten|die\s+beste|das\s+beste|top[\s-]?(italiener|restaurant|hotel|ort)|in\s+der\s+ganzen\s+stadt|stadtweit|absolut\s+beste)\b/iu;

const LANDMARK_RE =
  /\b(an\s+der\s+elbe|elbe|hafen|förde|foerde|seeufer|am\s+wasser|promenade|altstadt)\b/iu;

const NOW_RE =
  /\b(jetzt|gleich|sofort|hier\s+und\s+jetzt|gerade|heute\s+mittag)\b/iu;

const EVENING_RE =
  /\b(heute\s+abend|abendessen|dinner|tonight|um\s+(\d{1,2})\s*uhr)\b/iu;

export function detectCityBestIntent(text: string): boolean {
  return BEST_CITY_RE.test(text.replace(/\s+/g, ' ').trim());
}

export function detectPitchKind(text: string): PitchKind {
  const t = text.toLowerCase();
  if (/\b(hotel|übernacht|uebernacht|airbnb|pension)\b/.test(t)) return 'hotel';
  if (/\b(kino|film|cinema)\b/.test(t)) return 'cinema';
  if (/\b(bar|pub|biergarten|cocktail)\b/.test(t)) return 'bar';
  if (/\b(tour|ausflug|ticket|führung|fuehrung)\b/.test(t)) return 'tour';
  if (
    /\b(museum|kirche|denkmal|aussicht|sehenswürdigkeit|sehenswuerdigkeit)\b/.test(
      t,
    )
  ) {
    return 'sight';
  }
  if (
    /\b(essen|restaurant|pizza|italiener|grieche|sushi|imbiss|café|cafe|frühstück|fruehstueck|mittag|abendessen|burger|fisch)\b/.test(
      t,
    )
  ) {
    return 'food';
  }
  return 'generic';
}

export function resolveSearchMode(opts: {
  text: string;
  hasActiveNav: boolean;
  hasTimelineNext: boolean;
  landmarkHint?: string | null;
}): PitchSearchMode {
  const t = opts.text.replace(/\s+/g, ' ').trim();
  if (detectCityBestIntent(t)) return 'city_best';
  if (LANDMARK_RE.test(t) || opts.landmarkHint) return 'landmark';
  if (
    /\b(zwischen|auf\s+dem\s+weg|unterwegs|zwischenstopp)\b/iu.test(t) &&
    (opts.hasActiveNav || opts.hasTimelineNext)
  ) {
    return 'between_stops';
  }
  if (opts.hasActiveNav || opts.hasTimelineNext) {
    if (NOW_RE.test(t) && !opts.hasActiveNav) return 'here_now';
    return 'on_route';
  }
  if (EVENING_RE.test(t) && !NOW_RE.test(t)) return 'future_place';
  return 'here_now';
}

/** visitAt aus Text — „um 18 Uhr“ / jetzt / Abend ≈ 19:00 */
export function resolveVisitAtMs(text: string, nowMs = Date.now()): number {
  const t = text.replace(/\s+/g, ' ').trim();
  const clock = t.match(/\bum\s+(\d{1,2})(?:[:.](\d{2}))?\s*uhr\b/iu);
  if (clock) {
    const h = Math.min(23, Math.max(0, Number(clock[1])));
    const m = clock[2] ? Math.min(59, Number(clock[2])) : 0;
    const d = new Date(nowMs);
    d.setHours(h, m, 0, 0);
    if (d.getTime() < nowMs - 30 * 60_000) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  if (EVENING_RE.test(t) && !NOW_RE.test(t)) {
    const d = new Date(nowMs);
    d.setHours(19, 0, 0, 0);
    if (d.getTime() < nowMs) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  return nowMs;
}

export function buildPrefSliceForPitch(text: string): PitchPrefSlice {
  const slice: PitchPrefSlice = {};
  try {
    const { getCachedUserProfile } = require('../../services/userProfileService') as {
      getCachedUserProfile: () => Record<string, unknown> | null;
    };
    const profile = getCachedUserProfile();
    if (!profile) return slice;
    const blob = JSON.stringify(profile).toLowerCase();
    const allergies: string[] = [];
    for (const a of [
      'nuss',
      'erdnuss',
      'gluten',
      'laktose',
      'milch',
      'ei',
      'soja',
      'fisch',
      'schalen',
    ]) {
      if (
        blob.includes(a) &&
        /allerg|unverträglich|unvertraeglich|meide/.test(blob)
      ) {
        allergies.push(a);
      }
    }
    if (allergies.length) slice.allergies = allergies;
    if (/\bvegan\b/.test(blob)) slice.diet = [...(slice.diet ?? []), 'vegan'];
    if (/\bvegetarisch\b/.test(blob)) {
      slice.diet = [...(slice.diet ?? []), 'vegetarisch'];
    }
    if (/\b(günstig|guenstig|budget|billig)\b/.test(blob + text.toLowerCase())) {
      slice.budgetHint = 'günstig';
    }
  } catch {
    /* soft */
  }
  return slice;
}

export function parseWishesFromText(text: string): PitchWish[] {
  const t = text.replace(/\s+/g, ' ').trim();
  const wishes: PitchWish[] = [];
  const dish = t.match(
    /\b(pannfisch|pizza\s*hawaii|schnitzel|burger|sushi|döner|doener|pasta|ramen)\b/iu,
  );
  if (dish?.[1]) {
    wishes.push({ text: dish[1], hardness: 'must', kind: 'dish' });
  }
  const cuisine = t.match(
    /\b(italiener|italienisch|grieche|griechisch|japanisch|indisch|türkisch|tuerkisch|asian|asiatisch|steakhouse)\b/iu,
  );
  if (cuisine?.[1]) {
    wishes.push({ text: cuisine[1], hardness: 'must', kind: 'cuisine' });
  }
  if (/\b(biergarten|terrasse|sonnenuntergang|elb[bv]lick|außen|aussen)\b/iu.test(t)) {
    const m = t.match(/\b(biergarten|terrasse|sonnenuntergang|elb[bv]lick)\b/iu);
    wishes.push({
      text: m?.[1] ?? 'Outdoor',
      hardness: /\bsonnenuntergang\b/iu.test(t) ? 'nice' : 'must',
      kind: 'vibe',
    });
  }
  if (/\b(pool|sauna|spa)\b/iu.test(t)) {
    const m = t.match(/\b(pool|sauna|spa)\b/iu);
    wishes.push({ text: m?.[1] ?? 'Amenity', hardness: 'must', kind: 'amenity' });
  }
  if (!wishes.length) {
    wishes.push({ text: t.slice(0, 80), hardness: 'nice', kind: 'generic' });
  }
  return wishes;
}

/** Bridge 8–22 Wörter — Parent spricht parallel. */
export function buildPitchParentBridge(opts: {
  searchMode: PitchSearchMode;
  kind: PitchKind;
  cityBest: boolean;
}): string {
  if (opts.cityBest || opts.searchMode === 'city_best') {
    return 'Ich such dir die besten Optionen in der Stadt — kurz Geduld.';
  }
  if (opts.searchMode === 'on_route' || opts.searchMode === 'between_stops') {
    return 'Ich check kurz, was gut auf dem Weg liegt.';
  }
  if (opts.kind === 'hotel') {
    return 'Ich such zwei passende Hotels für dich raus.';
  }
  if (opts.kind === 'cinema') {
    return 'Ich schau kurz, welche Kinos für dich passen.';
  }
  return 'Ich such dir zwei starke Optionen in der Nähe.';
}

export function countWords(s: string): number {
  return s
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

/** Clamp Bridge auf 8–22 Wörter (Padding/Trim soft). */
export function clampBridgeWords(text: string): string {
  const words = text
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length < 8) {
    const pad = 'Ich melde mich gleich mit zwei klaren Optionen.';
    return `${text.trim()} ${pad}`.trim();
  }
  if (words.length > 22) return words.slice(0, 22).join(' ');
  return words.join(' ');
}
