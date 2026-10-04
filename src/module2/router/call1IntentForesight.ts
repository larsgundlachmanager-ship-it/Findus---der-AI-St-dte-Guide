/**
 * Call-1 Intent-Foresight — überall mitdenken, außer klare Quiz-/Maßzahl-Fragen.
 *
 * Blaupause (kein Themenkatalog):
 * - Slot-Fokus: „wie warm?“ → nur Temperatur
 * - Wetter + Absicht: Regen + Tennis → Regenfenster + Outdoor + Halle-Fallback
 * - Tag-Plan Outdoor: Badetag → Zusage → Wetter-Fit → Pitch (Distanz/Angebot) + Chips
 * - Geschlossen: Alter/Fläche/Rechnung → Antwort, kein Extra-Invent
 */

import type { Call1ProximityMode, Call1WorkItem } from './call1TaskBrief';

export type IntentForesightKind =
  | 'closed_fact'
  | 'slot_weather'
  | 'activity_weather'
  | 'day_plan_outdoor';

export type InventedPlayActivity = {
  token: string;
  label: string;
  /** Soft: Halle/Indoor parallel mitdenken (Tennis, Padel, …) */
  wantsIndoorFallback: boolean;
  dayPlanKind: 'swim' | 'play' | 'generic';
};

const WEATHER_CUE_RE =
  /\b(wetter|regen|regnet|regnen|niederschlag|wie\s+warm|temperatur|grad|sonne|bewölkt|bewoelkt|schauer|gewitter|trocken|jacke)\b/iu;

const PLAY_STOP =
  /^(das|die|der|ein|eine|heute|abend|morgen|hier|dort|mal|bitte|irgendwie|irgendwo|so|noch|dann|richtig|geil|schön|schoen|lust|bock)$/iu;

const HALL_CAPABLE_RE =
  /\b(tennis|badminton|squash|padel|tischtennis|ping[\s-]?pong)\b/iu;

const SWIM_DAY_RE =
  /\b(badetag|baden|badesee|badestrand|strandbad|freibad|see\s+fahren|zum\s+see|ans?\s+wasser|schwimmen|sonnenbaden)\b/iu;

function titleCase(s: string): string {
  const t = s.replace(/[_-]+/g, ' ').trim();
  if (!t) return 'Aktivität';
  return t.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Klare Quiz-/Maßzahl-Frage ohne User-Plan → kein Foresight-Invent.
 */
export function isClosedFactAsk(text: string): boolean {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t || t.length < 5) return false;
  // Reise-/Plan-Verben → nie closed
  if (
    /\b(lust|bock|spielen|fahren|hingehen|planen|heute\s+abend|regnet|wetter|wo\s+(?:gibt|kann)|suche|pitch)\b/iu.test(
      t,
    )
  ) {
    return false;
  }
  try {
    const { isQuickLookupQuery } = require('../../services/concierge/celestialSkyQuery') as {
      isQuickLookupQuery: (s: string) => boolean;
    };
    if (isQuickLookupQuery(t)) return true;
  } catch {
    /* soft */
  }
  return (
    /\b(wie\s+alt\s+ist|wer\s+(?:ist|war)|wie\s+(?:heißt|heisst)|wie\s+viele\s+einwohner|wie\s+gro(?:ss|ß)\s+ist|fläche|flaeche|einwohner|hauptstadt\s+von)\b/iu.test(
      t,
    ) || /\b\d+\s*(?:\+|plus|minus|-|×|x|\*)\s*\d+\b/iu.test(t)
  );
}

/** Nur Wetter-Slot, keine Aktivitäts-Absicht. */
export function isSlotOnlyWeatherAsk(text: string): boolean {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t || !WEATHER_CUE_RE.test(t)) return false;
  if (inventPlayActivityFromText(t)) return false;
  if (SWIM_DAY_RE.test(t)) return false;
  if (
    /\b(lust|bock|spielen|fahren|hingehen|open[\s-]?air|picknick|picnic|draußen|draussen)\b/iu.test(
      t,
    )
  ) {
    return false;
  }
  return (
    /\b(wie\s+warm|temperatur|wie\s+viele\s+grad|wie\s+kalt)\b/iu.test(t) ||
    /\b(soll\s+es\s+(?:heute\s+)?(?:noch\s+)?regnen|regnet\s+es|kommt\s+regen|regen\s+heute)\b/iu.test(
      t,
    ) ||
    /\b(wie\s+(?:wird|ist)\s+(?:das\s+)?wetter)\b/iu.test(t)
  );
}

/**
 * Aktivität dynamisch aus der Frage — keine Themen-Whitelist zum Pflegen.
 */
export function inventPlayActivityFromText(
  text: string,
): InventedPlayActivity | null {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t || t.length < 6) return null;

  if (SWIM_DAY_RE.test(t)) {
    return {
      token: 'baden',
      label: 'Badetag',
      wantsIndoorFallback: false,
      dayPlanKind: 'swim',
    };
  }

  try {
    const {
      inventOutdoorActivityFromText,
    } = require('./outdoorWeatherGate') as {
      inventOutdoorActivityFromText: (
        s: string,
      ) => { kind: string; label: string } | null;
    };
    const outdoor = inventOutdoorActivityFromText(t);
    if (outdoor) {
      const blob = `${outdoor.kind} ${outdoor.label}`.toLowerCase();
      return {
        token: outdoor.kind.replace(/^outdoor_/, '') || 'outdoor',
        label: outdoor.label,
        wantsIndoorFallback: HALL_CAPABLE_RE.test(blob),
        dayPlanKind: /baden|strand|see|swim/.test(blob) ? 'swim' : 'generic',
      };
    }
  } catch {
    /* soft */
  }

  // „Lust (auf) Tennis“, „Tennis spielen“, „zum Tennis“
  const lust = t.match(
    /\b(?:lust\s+auf|bock\s+auf|lust\s+|möchte|moechte|will)\s+(?:so\s+(?:ein|eine|einen)\s+|ein(?:e|en)?\s+|mal\s+)?([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß-]{2,28})/iu,
  );
  let token = lust?.[1] ? lust[1].toLowerCase() : null;
  if (token && PLAY_STOP.test(token)) token = null;

  if (!token) {
    // „gibt's hier Padel?“, „wo kann man padeln?“, „gibt es hier Minigolf“
    const gibt = t.match(
      /\b(?:gibt(?:['’]?s|\s+es)|wo\s+(?:gibt(?:\s+es)?|kann(?:\s+man)?|finde\s+ich)|wohin\s+(?:zum|zur)?)\s+(?:hier\s+)?(?:zum\s+|zur\s+|ein(?:e|en)?\s+)?([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß-]{2,28})/iu,
    );
    if (gibt?.[1] && !PLAY_STOP.test(gibt[1])) token = gibt[1].toLowerCase();
  }
  if (!token) {
    const play = t.match(
      /\b([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß-]{2,28})\s+(?:zu\s+)?spielen\b/iu,
    );
    if (play?.[1] && !PLAY_STOP.test(play[1])) token = play[1].toLowerCase();
  }
  if (!token) {
    const go = t.match(
      /\b([A-Za-zÄÖÜäöüß]{3,28}(?:en|eln|ern))\s+gehen\b/iu,
    );
    if (go?.[1] && !PLAY_STOP.test(go[1])) {
      token = go[1].toLowerCase().replace(/(en|eln|ern)$/u, '');
    }
  }
  if (!token) {
    try {
      const {
        extractOpenPlaceType,
        extractOpenThemeNeed,
      } = require('../mission/openPlaceFind') as {
        extractOpenPlaceType: (s: string) => string | null;
        extractOpenThemeNeed: (s: string) => string | null;
      };
      const open = extractOpenThemeNeed(t) || extractOpenPlaceType(t);
      if (open && !PLAY_STOP.test(open)) token = open.toLowerCase();
    } catch {
      /* soft */
    }
  }

  if (!token) return null;
  // Reine Wetterwörter keine Aktivität
  if (/^(regen|wetter|sonne|grad|warm|kalt|heute|abend)$/i.test(token)) {
    return null;
  }

  return {
    token,
    label: titleCase(token),
    wantsIndoorFallback: HALL_CAPABLE_RE.test(token),
    dayPlanKind: /baden|strand|see|swim|freibad/.test(token) ? 'swim' : 'play',
  };
}

export function classifyIntentForesight(
  text: string,
): IntentForesightKind | null {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (isClosedFactAsk(t)) return 'closed_fact';

  const act = inventPlayActivityFromText(t);
  const weather = WEATHER_CUE_RE.test(t);

  if (act?.dayPlanKind === 'swim' && (weather || /\b(heute|lust|bock|fahr)\b/iu.test(t))) {
    return 'day_plan_outdoor';
  }
  if (act && weather) return 'activity_weather';
  if (act && /\b(heute\s+abend|heute\s+nachmittag|später|spaeter)\b/iu.test(t)) {
    return 'activity_weather';
  }
  // „gibt's hier Padel?“ ohne Wetter → trotzdem Play-Intent (Pitch), kein Quiz
  if (
    act &&
    /\b(gibt(?:['’]?s|\s+es)|wo\s+(?:gibt|kann|finde)|wohin|lust|bock|spielen)\b/iu.test(
      t,
    )
  ) {
    return 'activity_weather';
  }
  if (isSlotOnlyWeatherAsk(t)) return 'slot_weather';
  return null;
}

export function inventIntentForesightWork(
  userText: string,
  proximity: Call1ProximityMode,
): Call1WorkItem[] {
  const kind = classifyIntentForesight(userText);
  if (!kind || kind === 'closed_fact') return [];

  const t = String(userText || '').replace(/\s+/g, ' ').trim();
  const act = inventPlayActivityFromText(t);
  const out: Call1WorkItem[] = [];

  if (kind === 'slot_weather') {
    const tempFocus = /\b(wie\s+warm|temperatur|grad|wie\s+kalt)\b/iu.test(t);
    const rainFocus = /\b(regen|regnet|niederschlag|schauer)\b/iu.test(t);
    out.push({
      id: 'foresight_weather_slot',
      worker: 'weather',
      brief: tempFocus
        ? 'Slot Temperatur jetzt — Fokus Grad, kein Outfit-Essay'
        : rainFocus
          ? 'Slot Regen: Timing/Fenster heute — Fokus Regenja/nein'
          : 'Wetter-Slots zur Frage (Fokus ehren)',
      proximity,
      executeWhen: 'now',
      neededSlots: tempFocus
        ? ['temp_c']
        : rainFocus
          ? ['rain_timing', 'sky']
          : ['temp_c', 'sky', 'rain_timing'],
    });
    return out;
  }

  // activity_weather + day_plan_outdoor
  const wantWeatherFit =
    kind === 'day_plan_outdoor' ||
    WEATHER_CUE_RE.test(t) ||
    /\b(heute\s+abend|heute\s+nachmittag|draußen|draussen|open[\s-]?air)\b/iu.test(
      t,
    );
  if (wantWeatherFit) {
    out.push({
      id: 'foresight_weather_fit',
      worker: 'weather',
      brief: act
        ? `Wetter-Fit für ${act.label}: Regenfenster + Temp — Bezug auf Aktivität`
        : 'Wetter-Fit zur Outdoor-Absicht',
      proximity,
      executeWhen: 'now',
      neededSlots: ['temp_c', 'sky', 'rain_timing', 'tomorrow_summary'],
    });
  }

  if (act) {
    out.push({
      id: 'foresight_activity_pitch',
      worker: 'pitch',
      brief:
        act.dayPlanKind === 'swim'
          ? `${act.label}: 2 Badeseen/Strände nah GPS — Distanz, Angebot (Gastro/Sport), kostenlos wenn belegt`
          : `${act.label}: passende Orte nah GPS — Distanz nennen`,
      proximity: 'here_now',
      executeWhen: 'now',
      must: [{ key: act.token, role: 'must', weight: 24 }],
    });
    if (act.wantsIndoorFallback) {
      out.push({
        id: 'foresight_indoor_fallback',
        worker: 'pitch',
        brief: wantWeatherFit
          ? `Falls Regen: ${act.label}-Halle/Indoor in der Nähe als Lösung mitliefern (nicht nur Problem)`
          : `${act.label}: Indoor/Halle soft mitdenken`,
        proximity: 'here_now',
        executeWhen: 'now',
        must: [
          { key: `${act.token}_halle`, role: 'soft', weight: 14 },
          { key: 'halle', role: 'soft', weight: 12 },
          { key: 'indoor', role: 'soft', weight: 10 },
        ],
      });
    }
  }

  return out.slice(0, 5);
}

/**
 * Author-Intent für Call-1/2 — Struktur, Wortlaut frei.
 */
export function intentForesightAuthorIntent(userText: string): string {
  const kind = classifyIntentForesight(userText);
  if (!kind || kind === 'closed_fact') return '';
  const act = inventPlayActivityFromText(userText);

  if (kind === 'slot_weather') {
    const temp = /\b(wie\s+warm|temperatur|grad)\b/iu.test(userText);
    return temp
      ? 'Fokus: aktuelle Temperatur klar nennen — Slot ehren, kein Extra-Pitch'
      : 'Fokus: Regen-Timing/Ja-Nein zur Frage — Slot ehren, kein Ort-Pitch';
  }

  if (kind === 'day_plan_outdoor') {
    return [
      'Call 1: Absicht spiegeln/zusagen (Badetag/Outdoor-Tag) — kein Fakt-Spoil',
      'Call 2: Wetter-Fit + Höchst/Himmel wenn belegt → Tour kann los',
      'Dann Pitch 2 Orte: Distanz vom GPS, Angebot unterscheiden, Preis wenn belegt',
      'Chips: Ort schon klar / Suche starten — Just-Do-It',
    ].join('. ');
  }

  // activity_weather
  return [
    act
      ? `Doppel-Intent: Wetter UND ${act.label} — beides in derselben Antwort`
      : 'Doppel-Intent: Wetter und Aktivität',
    'Regenfenster nennen wenn belegt (ab … / von … bis …)',
    'Trocken → entspannt outdoor möglich; Bezug auf Aktivität',
    'Regen heute → ehrlich + Lösung: früher, Fenster nutzen, oder Indoor/Halle wenn belegt',
    'Nie nur Wetterbericht ohne Aktivitäts-Bezug; nie nur Problem ohne Option',
  ].join('. ');
}
