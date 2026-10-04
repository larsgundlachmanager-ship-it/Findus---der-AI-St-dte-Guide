/**
 * Outdoor + Wetter-Gate — Regen heute/morgen + Jacke.
 * Aktivitäten DYNAMISCH aus der Frage inventieren — keine Themen-Whitelist zum Nachpflegen.
 */

import type { WeatherSnapshot } from '../../services/weatherService';

export type OutdoorWeatherPrefer = 'tonight' | 'tomorrow' | 'ask';

export type OutdoorWeatherGate = {
  tonightOk: boolean;
  tonightRainLikely: boolean;
  tomorrowRainLikely: boolean | null;
  tomorrowBetter: boolean | null;
  jacketHint: string | null;
  preferDay: OutdoorWeatherPrefer;
  factBits: string[];
};

export type InventedOutdoorActivity = {
  kind: string;
  label: string;
  mustLabels: string[];
  queryBoost: string;
  pitchKind: 'cinema' | 'sight' | 'generic';
  needsProgram: boolean;
};

const OUTDOOR_CUE_RE =
  /\b(open[\s-]?air|openair|freiluft|freilicht|outdoor|draußen|draussen|unter\s+freiem\s+himmel|im\s+freien|im\s+park|auf\s+der\s+wiese|beach|strand)\b/iu;

const OUTDOOR_TIME_RE =
  /\b(heute|abend|nachmittag|nacht|morgen\s+abend|später|spaeter)\b/iu;

const STOP_ACTIVITY =
  /^(das|die|der|ein|eine|heute|abend|morgen|hier|dort|mal|bitte|irgendwie|irgendwo|irgendwohin|richtig|geil|schön|schoen|lust|bock|so|noch|dann)$/iu;

function eveningWindowMs(dayOffset: number, nowMs: number): { start: number; end: number } {
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + dayOffset);
  return {
    start: d.getTime() + 17 * 3600_000,
    end: d.getTime() + 24 * 3600_000,
  };
}

function rainOverlapsWindow(
  snap: WeatherSnapshot,
  start: number,
  end: number,
): boolean {
  if (
    typeof snap.nextRainAtMs === 'number' &&
    snap.nextRainAtMs >= start &&
    snap.nextRainAtMs <= end &&
    (snap.nextRainProb == null || snap.nextRainProb >= 40)
  ) {
    return true;
  }
  for (const w of snap.rainWindows ?? []) {
    if (w.endMs < start || w.startMs > end) continue;
    if ((w.pop ?? 0) >= 0.4 || (w.pop ?? 0) >= 40) return true;
    if (w.pop == null && w.endMs > w.startMs) return true;
  }
  return false;
}

function tomorrowMentionsRain(summary: string | null | undefined): boolean | null {
  const s = String(summary || '').toLowerCase();
  if (!s.trim()) return null;
  if (/\b(regen|schauer|gewitter|niederschlag|nass)\b/iu.test(s)) return true;
  if (/\b(trocken|sonnig|klar|heiter|wolkenlos)\b/iu.test(s)) return false;
  return null;
}

export function evaluateOutdoorEveningWeather(
  snap: WeatherSnapshot | null | undefined,
  nowMs = Date.now(),
): OutdoorWeatherGate {
  if (!snap) {
    return {
      tonightOk: true,
      tonightRainLikely: false,
      tomorrowRainLikely: null,
      tomorrowBetter: null,
      jacketHint: null,
      preferDay: 'tonight',
      factBits: [],
    };
  }

  const tonight = eveningWindowMs(0, nowMs);
  const tomorrow = eveningWindowMs(1, nowMs);
  const tonightRain =
    rainOverlapsWindow(snap, Math.max(nowMs, tonight.start), tonight.end) ||
    (snap.isHeavyRain === true && nowMs >= tonight.start - 2 * 3600_000);
  const tomRainFromWindows = rainOverlapsWindow(snap, tomorrow.start, tomorrow.end);
  const tomFromSummary = tomorrowMentionsRain(snap.tomorrowSummary);
  const tomorrowRainLikely =
    tomRainFromWindows || tomFromSummary === true
      ? true
      : tomFromSummary === false
        ? false
        : null;

  const tonightOk = !tonightRain;
  let tomorrowBetter: boolean | null = null;
  if (tonightRain) {
    if (tomorrowRainLikely === false) tomorrowBetter = true;
    else if (tomorrowRainLikely === true) tomorrowBetter = false;
    else if (snap.tomorrowSummary)
      tomorrowBetter = !/regen|schauer|gewitter/i.test(snap.tomorrowSummary);
  }

  let preferDay: OutdoorWeatherPrefer = 'tonight';
  if (tonightRain && tomorrowBetter === true) preferDay = 'tomorrow';
  else if (tonightRain && tomorrowBetter === false) preferDay = 'ask';
  else if (tonightRain) preferDay = 'tomorrow';

  const nightLow = snap.nightLowC;
  const cur = snap.currentTempC;
  let jacketHint: string | null = null;
  if (typeof nightLow === 'number' && Number.isFinite(nightLow)) {
    const drop =
      typeof cur === 'number' && Number.isFinite(cur) ? cur - nightLow : null;
    if (nightLow <= 10 || (drop != null && drop >= 8 && nightLow <= 14)) {
      jacketHint =
        nightLow <= 8
          ? `Nachts runter auf ca. ${Math.round(nightLow)}° — warme Jacke mitnehmen`
          : `Abends kühlt’s auf ca. ${Math.round(nightLow)}° ab — leichte Jacke reicht oft`;
    }
  }

  const factBits: string[] = [];
  if (tonightRain) {
    factBits.push(
      typeof snap.nextRainProb === 'number'
        ? `Heute Abend Regenrisiko (~${Math.round(snap.nextRainProb)} %)`
        : 'Heute Abend Regenrisiko',
    );
  } else if (snap.summaryLine) {
    factBits.push(`Heute Abend: ${snap.summaryLine.slice(0, 60)}`);
  }
  if (preferDay === 'tomorrow' && snap.tomorrowSummary) {
    factBits.push(`Morgen: ${snap.tomorrowSummary.slice(0, 70)}`);
  }
  if (jacketHint) factBits.push(jacketHint);

  return {
    tonightOk,
    tonightRainLikely: tonightRain,
    tomorrowRainLikely,
    tomorrowBetter,
    jacketHint,
    preferDay,
    factBits: factBits.slice(0, 4),
  };
}

function titleCaseLabel(s: string): string {
  const t = s.replace(/[_-]+/g, ' ').trim();
  if (!t) return 'Outdoor';
  return t.replace(/\b\w/g, (c) => c.toUpperCase());
}

function stemToken(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-zäöüß0-9]/giu, '')
    .replace(/(en|er|e|s)$/u, '')
    .slice(0, 24);
}

/** Outdoor-Natur des Worts (Sport im Freien) — kein Themenkatalog. Open-Air+X braucht das nicht. */
function isClearlyOutdoorToken(token: string): boolean {
  return /mini.?golf|golf|picknick|picnic|beach|strand|freilicht|open.?air|skate|boule|petanque|disc.?golf|frisbee|volleyball|terrasse|padel|tennis|badminton/.test(
    token,
  );
}

/**
 * Inventiert Outdoor-Aktivität aus der Frage — Founder muss keine neuen Themen listen.
 */
export function inventOutdoorActivityFromText(
  text: string,
): InventedOutdoorActivity | null {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t || t.length < 6) return null;

  // Open-Air / Freiluft + beliebiger Aktivitätstoken (Yoga, Kino, Markt, …)
  const openCompound = t.match(
    /\b(?:open[\s-]?air|openair|freiluft|freilicht|outdoor)[\s-]*([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß-]{2,32})/iu,
  );
  // Ein-Wort-Komposita: Freilichttheater, Openairkino, …
  const glued = t.match(
    /\b((?:freilicht|freiluft|openair|outdoor)[A-Za-zÄÖÜäöüß]{3,28})\b/iu,
  );
  if (openCompound?.[1] && !STOP_ACTIVITY.test(openCompound[1])) {
    const raw = openCompound[1].toLowerCase();
    const cinema = /kino|film|cinema/.test(raw);
    const theatre = /theater|theatre|bühne|buehne/.test(raw);
    return {
      kind: `outdoor_${stemToken(raw)}`,
      label: titleCaseLabel(`Open-Air ${raw}`),
      mustLabels: ['outdoor', 'open_air', raw],
      queryBoost: `Open Air ${raw} Freiluft outdoor`,
      pitchKind: cinema ? 'cinema' : 'sight',
      needsProgram: cinema || theatre || /konzert|programm|vorstellung/.test(t),
    };
  }
  if (glued?.[1]) {
    const rawFull = glued[1].toLowerCase();
    const raw = rawFull
      .replace(/^(freilicht|freiluft|openair|outdoor)/, '')
      .trim();
    const act = raw || rawFull;
    const cinema = /kino|film/.test(act);
    const theatre = /theater|theatre|bühne|buehne/.test(act);
    return {
      kind: `outdoor_${stemToken(act)}`,
      label: titleCaseLabel(rawFull),
      mustLabels: ['outdoor', 'open_air', act],
      queryBoost: `${rawFull} Freiluft outdoor`,
      pitchKind: cinema ? 'cinema' : 'sight',
      needsProgram: cinema || theatre || /programm|vorstellung/.test(t),
    };
  }

  // „Lust auf X“ / „möchte X“ …
  const lust = t.match(
    /\b(?:lust\s+auf|bock\s+auf|möchte|moechte|will|können\s+wir|koennen\s+wir|lass\s+uns)\s+(?:so\s+(?:ein|eine|einen)\s+|ein(?:e|en)?\s+|mal\s+)?([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß-]{2,40})/iu,
  );
  let token = lust?.[1] ? lust[1].toLowerCase() : null;
  if (token && STOP_ACTIVITY.test(token)) token = null;

  if (!token) {
    try {
      const {
        extractOpenPlaceType,
        extractOpenThemeNeed,
      } = require('../mission/openPlaceFind') as {
        extractOpenPlaceType: (s: string) => string | null;
        extractOpenThemeNeed: (s: string) => string | null;
      };
      token = extractOpenThemeNeed(t) || extractOpenPlaceType(t);
    } catch {
      /* soft */
    }
  }

  if (!token) {
    // „gibt's hier Minigolf / Padel?“
    const gibt = t.match(
      /\b(?:gibt(?:['’]?s|\s+es)|wo\s+(?:gibt(?:\s+es)?|kann(?:\s+man)?))\s+(?:hier\s+)?(?:zum\s+|zur\s+|ein(?:e|en)?\s+)?([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß-]{2,28})/iu,
    );
    if (gibt?.[1] && !STOP_ACTIVITY.test(gibt[1])) {
      token = gibt[1].toLowerCase();
    }
  }

  if (!token) {
    // „golfen gehen“, „picknicken“, „minigolfen“ …
    const goDo = t.match(
      /\b([A-Za-zÄÖÜäöüß]{3,28}(?:en|eln|ern))\s+gehen\b/iu,
    );
    if (goDo?.[1] && !STOP_ACTIVITY.test(goDo[1])) {
      token = goDo[1].toLowerCase().replace(/(en|eln|ern)$/u, '');
    }
  }
  if (!token) {
    const near = t.match(
      /\b([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß-]{3,32})\s+(?:im\s+park|draußen|draussen|outdoor|unter\s+freiem\s+himmel)/iu,
    );
    if (near?.[1] && !STOP_ACTIVITY.test(near[1])) token = near[1].toLowerCase();
  }

  if (!token) {
    if (!OUTDOOR_CUE_RE.test(t)) return null;
    return {
      kind: 'outdoor_generic',
      label: 'Outdoor',
      mustLabels: ['outdoor'],
      queryBoost: 'Outdoor Freiluft draußen',
      pitchKind: 'sight',
      needsProgram: /\b(programm|film|stück|stueck|vorstellung|konzert)\b/iu.test(
        t,
      ),
    };
  }

  const outdoorCtx =
    OUTDOOR_CUE_RE.test(t) ||
    isClearlyOutdoorToken(token) ||
    (OUTDOOR_TIME_RE.test(t) &&
      /\b(park|wiese|strand|gehen|spielen|machen)\b/iu.test(t));
  if (!outdoorCtx) return null;

  const cinema = /kino|film|cinema/.test(token) || /\b(kino|filme?)\b/iu.test(t);
  const theatre = /theater|theatre|bühne|buehne/.test(token);
  const needsProgram =
    cinema ||
    theatre ||
    /\b(programm|filme?|stück|stueck|vorstellung|welche\s+filme)\b/iu.test(t);

  return {
    kind: stemToken(token) || 'outdoor',
    label: titleCaseLabel(token),
    mustLabels: Array.from(
      new Set([
        token,
        'outdoor',
        ...(OUTDOOR_CUE_RE.test(t) || /open.?air|freiluft|freilicht/.test(token)
          ? ['open_air']
          : []),
      ]),
    ),
    queryBoost:
      `${token} outdoor Freiluft draußen${OUTDOOR_CUE_RE.test(t) ? ' open air' : ''}`.trim(),
    pitchKind: cinema ? 'cinema' : 'sight',
    needsProgram,
  };
}

export function extractOutdoorActivity(
  text: string,
): InventedOutdoorActivity | null {
  return inventOutdoorActivityFromText(text);
}

/** Wetter-Gate relevant? Inventur ODER Outdoor-Cue. */
export function isOutdoorWeatherSensitiveAsk(text: string): boolean {
  const t = String(text || '').replace(/\s+/g, ' ');
  if (!t || t.length < 8) return false;
  if (OUTDOOR_CUE_RE.test(t)) return true;
  if (
    OUTDOOR_TIME_RE.test(t) &&
    /\b(park|wiese|strand|terrasse|garten|seeufer|picknick|picnic)\b/iu.test(t)
  ) {
    return true;
  }
  return inventOutdoorActivityFromText(t) != null;
}

export function wantsOutdoorProgramHard(text: string): boolean {
  return isOutdoorWeatherSensitiveAsk(text);
}

export function looksLikeOpenAirVenue(name: string, extra?: string | null): boolean {
  const blob = `${name} ${extra || ''}`.toLowerCase();
  return /open[\s-]?air|openair|freiluft|outdoor|sommerkino|amphitheatr|amphitheater|freilicht|mini[\s-]?golf|minigolf|golfplatz|golfclub|beach|strand|park|wiese|im freien/.test(
    blob,
  );
}

/** Stem-Match gegen inventierte Musts — keine Domänen-Whitelist. */
export function venueMatchesOutdoorActivity(
  name: string,
  activityMust: string[],
  extra?: string | null,
): boolean {
  const blob = `${name} ${extra || ''}`.toLowerCase();
  const musts = activityMust
    .map((m) => stemToken(m))
    .filter((m) => m.length >= 3 && !/^(outdoor|openair|open)$/.test(m));
  if (!musts.length) return looksLikeOpenAirVenue(name, extra);
  if (musts.some((m) => blob.includes(m))) return true;
  if (
    activityMust.some((m) => /open_air|outdoor|freiluft/i.test(m)) &&
    looksLikeOpenAirVenue(name, extra)
  ) {
    return true;
  }
  return false;
}
