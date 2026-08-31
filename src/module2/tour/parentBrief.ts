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
  /\b(mehrere|ein\s+paar|paar|verschiedene|ein\s+bisschen\s+(die\s+)?stadt|rumführ|rumfuehr|führ\s+mich\s+(herum|durch|rum)|fuehr\s+mich\s+(herum|durch|rum)|stadtführung|stadtfuehrung|rundgang|erkunden|unbesucht|noch\s+nicht\s+(gesehen|besucht)|must[\s-]?haves?|highlights?|tour\s+(machen|planen)|zeig\s+mir\s+(die\s+stadt|was)|welche\s+orte|was\s+kann\s+ich\s+(denn\s+)?(?:hier|in\s+\w+)?\s*(?:noch\s+)?(?:alles\s+)?(?:anschauen|erkunden|sehen)|(?:kleine|kurze|schnelle)\s+tour|(?:tour).{0,40}\b(?:\d+|zwei|drei|vier|paar)\s*stops?|(?:\d+|zwei|drei|vier|paar)\s*stops?\b)/iu;

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

/** „Noch nicht gesehen / unbesucht“ → Auto-Tour mit visitedExclude. */
export function wantsUnseenTour(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return false;
  return /\b(unbesucht|noch\s+nicht\s+(gesehen|besucht)|nicht\s+gesehen|noch\s+nie\s+(gesehen|besucht)|was\s+(habe|haben)\s+(ich|wir).{0,40}noch\s+nicht)\b/iu.test(
    t,
  );
}

/**
 * End-Anker aus Floskeln wie „am Ende gerne am Hafen“.
 * Nicht als Area-/Theme-Filter missbrauchen.
 */
export function parseEndAnchorKind(text: string): string | null {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const m = t.match(
    /\b(?:am\s+ende|zum\s+schluss|danach|anschlie(?:ß|ss)end|fertig\s+bei|enden?\s+bei|richtung)\s+(?:gerne\s+)?(?:am\s+|an\s+der\s+|beim?\s+|zum?\s+|zur\s+)?(hafen|strand|markt|rathaus|kirche|museum|hotel|bahnhof|altstadt|förde|foerde|alster|elbe)\b/iu,
  );
  return m?.[1]?.toLowerCase() ?? null;
}

export function wantsParkingNearEnd(text: string): boolean {
  return /\b(parkplatz|parken|parkmöglichkeit|parkmoeglichkeit)\b/iu.test(text);
}

/** Stadt-Rundgang / Highlights — Anker auf Pack, nicht Tennis-GPS. */
export function wantsCityExplore(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (/\b(joggen|jogging|wandern|radtour|fahrradtour)\b/iu.test(t)) return false;
  if (wantsUnseenTour(t)) return true;
  return /\b(erkunden|stadt\s+(?:angucken|zeigen|ansehen)|rundgang|highlights?|must[\s-]?haves?|stadt(?:führung|fuehrung|tour)|tour|rumlaufen|herumlaufen|stopps?)\b/iu.test(
    t,
  );
}

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
    /\b(tour|rundgang)\b/iu.test(t) &&
    parseDurationMin(t) != null
  ) {
    return 'stop_tour';
  }
  if (
    /\b(tour)\b/iu.test(t) &&
    /\b(?:\d+|zwei|drei|vier|paar)\s*stops?\b/iu.test(t)
  ) {
    return 'stop_tour';
  }
  if (/\b(erkunden|rumlaufen|herumlaufen|stadt\s+zeigen)\b/iu.test(t)) {
    return 'stop_tour';
  }
  if (
    /\b(welche\s+orte|was\s+(kann|gibt)|wohin\s+kann)\b/iu.test(t) &&
    /\b(erkunden|anschauen|sehen|besuchen|bummel|rundgang)\b/iu.test(t)
  ) {
    return 'stop_tour';
  }
  if (wantsUnseenTour(t)) return 'stop_tour';
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
  if (
    /\b(?:so\s+schnell|schnellstmöglich|schnellstmoeglich|kurz(?:e)?\s+tour|kompakt)\b/iu.test(
      t,
    )
  ) {
    return 60;
  }
  if (
    /\b(?:ein[e]?\s*(?:bis|-|–)\s*zwei|1\s*[-–]\s*2|ein\s+zwei|eine?\s+oder\s+zwei)\s*stunden?\b/iu.test(
      t,
    )
  ) {
    return 90;
  }
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
  if (
    /\b(später|spaeter|morgen|übermorgen|uebermorgen|heute\s+abend|um\s+\d|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/iu.test(
      text,
    ) &&
    !/\b(jetzt|sofort|gleich)\b/iu.test(text)
  ) {
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
  const endKind = parseEndAnchorKind(text);
  // End-Anker-Satz raus, damit „am Ende am Hafen“ nicht alle Stops auf Hafen filtert
  const scrubbed = text
    .replace(
      /\b(?:am\s+ende|zum\s+schluss|danach|anschlie(?:ß|ss)end|fertig\s+bei|enden?\s+bei|richtung)\s+(?:gerne\s+)?(?:am\s+|an\s+der\s+|beim?\s+|zum?\s+|zur\s+)?(?:hafen|strand|markt|rathaus|kirche|museum|hotel|bahnhof|altstadt|förde|foerde|alster|elbe)\b[^.!?]*/giu,
      ' ',
    )
    .replace(/\s+/g, ' ');
  const out: string[] = [];
  for (const { re, key } of THEME_MAP) {
    if (endKind && key === endKind && !re.test(scrubbed)) continue;
    if (re.test(scrubbed)) out.push(key);
  }
  return out;
}

export function extractAreaHint(text: string): string | null {
  const endKind = parseEndAnchorKind(text);
  const scrubbed = text
    .replace(
      /\b(?:am\s+ende|zum\s+schluss|danach|anschlie(?:ß|ss)end|fertig\s+bei|enden?\s+bei|richtung)\s+(?:gerne\s+)?(?:am\s+|an\s+der\s+|beim?\s+|zum?\s+|zur\s+)?(?:hafen|strand|markt|rathaus|kirche|museum|hotel|bahnhof|altstadt|förde|foerde|alster|elbe)\b[^.!?]*/giu,
      ' ',
    )
    .replace(/\s+/g, ' ');
  const m = scrubbed.match(
    /\b(an\s+der\s+elbe|elbe|speicherstadt|altstadt|hafen|förde|foerde|alster)\b/iu,
  );
  const hit = m?.[1]?.toLowerCase() ?? null;
  if (hit && endKind && hit.includes(endKind)) return null;
  return hit;
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
  // Stadt erkunden / Unseen: Default-Dauer, nie nachfragen
  if (wantsCityExplore(opts.text) || wantsUnseenTour(opts.text)) return false;
  return true;
}

/** Default-Dauer für Unseen-Auto-Tour (JUST-DO-IT). */
export function defaultUnseenTourDurationMin(text: string): number | null {
  if (!wantsUnseenTour(text)) return null;
  return 60;
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
