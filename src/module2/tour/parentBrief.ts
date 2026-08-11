/**
 * Parent-Helfer: Mode, Dauer, Themes, Bridge für Tour-Modul.
 */

import type {
  TourMobility,
  TourMode,
  TourPathSpec,
  TourPrefSlice,
  TourStartMode,
} from './types';

const NAMED_ITINERARY_RE =
  /\b(danach|dann|anschließend|anschliessend|zuerst|als\s+nächstes|als\s+naechstes).{0,40}\b(und|,)\b/iu;

const MULTI_STOP_RE =
  /\b(mehrere|ein\s+paar|paar|verschiedene|ein\s+bisschen\s+(die\s+)?stadt|rumführ|rumfuehr|führ\s+mich\s+(herum|durch|rum)|fuehr\s+mich\s+(herum|durch|rum)|stadtführung|stadtfuehrung|rundgang|erkunden|unbesucht|noch\s+nicht\s+(gesehen|besucht)|must[\s-]?haves?|highlights?|tour\s+(machen|planen)|zeig\s+mir\s+(die\s+stadt|was)|(?:kleine|kurze|schnelle)\s+tour|(?:tour).{0,40}\b(?:\d+|zwei|drei|vier|paar)\s*stops?|(?:\d+|zwei|drei|vier|paar)\s*stops?\b)/iu;

const THEME_MULTI_RE =
  /\b(alle|mehrere|ein\s+paar|paar)\s+(kirchen|museen|parks|denkmäler|denkmaeler|aussichten|strände|straende)\b/iu;

const PATH_RE =
  /\b(joggen|jogging|wandern|wanderung|radtour|fahrradtour|radeln|(\d+[.,]?\d*)\s*km\s*(laufen|joggen|rad|fahrrad|wandern)?|(\d+)\s*(min|minute|minuten|stunde|stunden|h)\s*(laufen|wandern|joggen|rad)?|eine\s+stunde\s+(laufen|wandern|joggen)|schöne\s+runde|schoene\s+runde)\b/iu;

const SINGULAR_PITCH_RE =
  /\b(welches?\s+(restaurant|hotel|museum|park|café|cafe)|ein(en|e)?\s+(restaurant|hotel|museum|park|café|cafe)|wo\s+kann\s+ich\s+(gut\s+)?essen|ich\s+brauche?\s+ein(en|e)?\s+)\b/iu;

const PLAN_DAY_RE =
  /\b(tagesplan|ganzen\s+tag|timeline|plane\s+mir\s+den\s+tag|itinerar)\b/iu;

const THEME_MAP: Array<{ re: RegExp; key: string }> = [
  { re: /\bkirche/iu, key: 'kirche' },
  { re: /\bmuseum|galerie/iu, key: 'museum' },
  { re: /\bpark|garten/iu, key: 'park' },
  { re: /\bdenkmal/iu, key: 'denkmal' },
  { re: /\baussicht|panorama|warte/iu, key: 'aussicht' },
  { re: /\bhafen|promenade/iu, key: 'hafen' },
  { re: /\bstrand|bucht/iu, key: 'strand' },
  { re: /\bspeicherstadt|altstadt/iu, key: 'altstadt' },
];

export function looksLikeNamedItinerary(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (PLAN_DAY_RE.test(t)) return true;
  // Mehrere Eigennamen / „X und Y und Z“ mit konkreten Orten
  if (
    /\b(miniatur[\s-]?wunderland|elbphilharmonie|elphi|alster)\b/iu.test(t) &&
    /\b(und|,|dann|danach)\b/iu.test(t)
  ) {
    return true;
  }
  return NAMED_ITINERARY_RE.test(t) && /\b(wunderland|elphi|alster|café|cafe)\b/iu.test(t);
}

export function detectTourMode(text: string): TourMode | null {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (looksLikeNamedItinerary(t)) return null;
  if (PATH_RE.test(t) && !THEME_MULTI_RE.test(t) && !/\berkunden|kirchen|museen\b/iu.test(t)) {
    return 'path_tour';
  }
  if (PATH_RE.test(t) && /\b(km|joggen|wandern|radtour|fahrrad)\b/iu.test(t)) {
    return 'path_tour';
  }
  if (MULTI_STOP_RE.test(t) || THEME_MULTI_RE.test(t)) return 'stop_tour';
  if (
    /\b(tour)\b/iu.test(t) &&
    /\b(?:\d+|zwei|drei|vier|paar)\s*stops?\b/iu.test(t)
  ) {
    return 'stop_tour';
  }
  if (/\b(erkunden|rumlaufen|herumlaufen|stadt\s+zeigen)\b/iu.test(t)) {
    return 'stop_tour';
  }
  return null;
}

export function shouldPreferTourOverPitch(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (looksLikeNamedItinerary(t)) return false;
  if (SINGULAR_PITCH_RE.test(t) && !MULTI_STOP_RE.test(t) && !THEME_MULTI_RE.test(t) && !PATH_RE.test(t)) {
    return false;
  }
  return detectTourMode(t) != null;
}

export function parseDurationMin(text: string): number | null {
  const t = text.replace(/\s+/g, ' ').trim();
  const hours = t.match(/(\d+[.,]?\d*)\s*(stunden?|h)\b/iu);
  if (hours) {
    const n = Number(String(hours[1]).replace(',', '.'));
    if (Number.isFinite(n) && n > 0) return Math.min(480, Math.round(n * 60));
  }
  if (/\beine\s+stunde\b/iu.test(t) || /\b1\s*h\b/iu.test(t)) return 60;
  if (/\bzwei\s+stunden\b/iu.test(t)) return 120;
  const m = t.match(/(\d+)\s*(min|minute|minuten)\b/iu);
  if (m) {
    const n = Number(m[1]);
    return Number.isFinite(n) && n > 0 ? Math.min(480, n) : null;
  }
  return null;
}

export function parseDistanceKm(text: string): number | null {
  const m = text.match(/(\d+[.,]?\d*)\s*km\b/iu);
  if (!m) return null;
  const n = Number(String(m[1]).replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.min(80, n) : null;
}

export function parseHardArriveByMs(text: string, nowMs = Date.now()): number | null {
  const clock = text.match(
    /\b(?:bis|um|vor)\s+(\d{1,2})(?:[:.](\d{2}))?\s*uhr\b/iu,
  );
  if (!clock) return null;
  if (!/\b(bis|vor|termin|tisch|restaurant|essen|reservation|reservier)\b/iu.test(text)) {
    // „um 18 Uhr starten“ ist Start, nicht Deadline — nur bei bis/vor/Termin
    if (!/\bbis\s+\d/iu.test(text) && !/\bvor\s+\d/iu.test(text)) return null;
  }
  const h = Math.min(23, Math.max(0, Number(clock[1])));
  const min = clock[2] ? Math.min(59, Number(clock[2])) : 0;
  const d = new Date(nowMs);
  d.setHours(h, min, 0, 0);
  if (d.getTime() < nowMs - 30 * 60_000) d.setDate(d.getDate() + 1);
  return d.getTime();
}

export function resolveStartMode(text: string): TourStartMode {
  if (/\b(später|spaeter|morgen|heute\s+abend|um\s+\d)/iu.test(text) && !/\b(jetzt|sofort|gleich)\b/iu.test(text)) {
    return 'scheduled';
  }
  return 'now';
}

export function resolveMobility(text: string): TourMobility {
  if (/\b(nur\s+)?(zu\s+)?fu(ss|ß)|laufen|wandern|joggen\b/iu.test(text) && !/\b(bus|bahn|öpnv|oepnv|rad|fahrrad)\b/iu.test(text)) {
    if (/\b(joggen|wandern|laufen)\b/iu.test(text)) return 'walk';
  }
  if (/\b(fahrrad|radtour|radeln|bike)\b/iu.test(text)) return 'bike';
  if (/\b(nur\s+)?(zu\s+)?fu(ss|ß)\b/iu.test(text)) return 'walk';
  return 'transit_ok';
}

export function extractThemeFilters(text: string): string[] {
  const out: string[] = [];
  for (const { re, key } of THEME_MAP) {
    if (re.test(text)) out.push(key);
  }
  return out;
}

export function extractAreaHint(text: string): string | null {
  const m = text.match(
    /\b(an\s+der\s+elbe|elbe|speicherstadt|altstadt|hafen|förde|foerde|alster)\b/iu,
  );
  return m?.[1]?.toLowerCase() ?? null;
}

export function buildPathSpec(text: string): TourPathSpec | null {
  const distanceKm = parseDistanceKm(text);
  const durationMin = parseDurationMin(text);
  if (distanceKm == null && durationMin == null && !PATH_RE.test(text)) {
    return null;
  }
  const loop =
    /\b(runde|loop|zurück|zurueck|kreis)\b/iu.test(text) ||
    distanceKm != null ||
    /\b(joggen|wandern)\b/iu.test(text);
  return { distanceKm, durationMin, loop };
}

export function needsDurationAsk(opts: {
  text: string;
  durationMin: number | null;
  distanceKm: number | null;
  hardArriveByMs: number | null;
}): boolean {
  if (opts.durationMin != null || opts.distanceKm != null) return false;
  if (opts.hardArriveByMs != null) return false;
  return true;
}

export function buildTourPrefSlice(text: string): TourPrefSlice {
  const slice: TourPrefSlice = {};
  try {
    const { getCachedUserProfile } = require('../../services/userProfileService') as {
      getCachedUserProfile: () => Record<string, unknown> | null;
    };
    const profile = getCachedUserProfile();
    if (profile) {
      const blob = JSON.stringify(profile).toLowerCase();
      const avoid: string[] = [];
      if (/museum/.test(blob) && /\b(skip|nein|no|avoid|mag\s+nicht)\b/.test(blob)) {
        avoid.push('museum');
      }
      if (/denkmal/.test(blob) && /\b(skip|nein|avoid)\b/.test(blob)) {
        avoid.push('denkmal');
      }
      if (avoid.length) slice.avoidCategories = avoid;
      if (/\bvegan|vegetarisch\b/.test(blob)) {
        slice.diet = blob.includes('vegan') ? ['vegan'] : ['vegetarisch'];
      }
    }
  } catch {
    /* soft */
  }
  if (/\b(mehr\s+stops?|dichte|möglichst\s+viel|moeglichst\s+viel)\b/iu.test(text)) {
    slice.denserStops = true;
  }
  return slice;
}

export function buildTourParentBridge(opts: {
  mode: TourMode;
  needsDurationAsk: boolean;
}): string {
  if (opts.needsDurationAsk) {
    return 'Klar — wie lange soll die Tour ungefähr dauern?';
  }
  if (opts.mode === 'path_tour') {
    return 'Ich plane dir eine passende Strecke — kurz Geduld.';
  }
  return 'Ich stelle dir eine Tour mit mehreren Stopps zusammen.';
}

export function countWords(s: string): number {
  return s
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export function clampBridgeWords(text: string): string {
  const words = text
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length < 8) {
    return `${text.trim()} Kurz Geduld bitte.`.trim();
  }
  if (words.length > 22) return words.slice(0, 22).join(' ');
  return words.join(' ');
}

export { PATH_RE, MULTI_STOP_RE, THEME_MULTI_RE, SINGULAR_PITCH_RE };
