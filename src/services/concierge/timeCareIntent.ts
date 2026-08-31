/**
 * Time-Care Intent — Wake vs Erinnerung vs ÖPNV/Leave vs Parken.
 * SSOT für Early-Just-Do-It (stadt-agnostisch, ohne RN-Imports → Node-Smoke).
 *
 * Produktregel:
 * - „Wecker …“ / Aufstehen → native Wake
 * - „Erinner mich …“ (Task/Todo) → Reminder (kein Wecker)
 * - Bahn/Zug/Bus + Zeit / „los“ → Leave-by
 * - Kombi („Bahn um 8:45, weck mich früh genug“) → Leave-by + Wecker rückwärts
 * Kontext ohne Keyword soll möglichst reichen — Keywords bleiben nur Boost.
 */

import { isWakeAlarmIntent, hasClockHint } from '../alarms/wakeIntentDetect';
import { isFlightTripQuery } from '../flights/flightTripIntent';

export type TimeCareKind =
  | 'wake'
  | 'timer'
  | 'reminder'
  | 'parking'
  | 'transit_leave'
  | 'compound_wake_transit';

export type TimeCareIntent = {
  kind: TimeCareKind;
  confidence: number;
  reason: string;
};

export const TRANSIT_RE =
  /\b(?:bahn|zug|bus|s-?bahn|u-?bahn|tram|straßenbahn|strassenbahn|öpnv|oepnv|ice|ic\b|re\b|rb\b|flixbus|abfahrt|anschluss|haltestelle|bahnhof|hbf|flug|flieger|flughafen|ferry|fähre|faehre|verbindung)\b/iu;

const LEAVE_RE =
  /\b(?:los\s*geh|los\s*muss|aufbruch|rechtzeitig|pünktlich|puenktlich|leave[-\s]?by|wann\s+(?:muss|soll)\s+ich\s+(?:los|weg)|nicht\s+(?:den\s+)?(?:zug|bus|bahn)\s+verpassen|zur\s+(?:bahn|haltestelle)|zum\s+(?:zug|bus|bahnhof|flughafen))\b/iu;

const REMIND_TASK_RE =
  /\b(?:anruf|anrufen|call|denk(?:en)?\s+dran|todo|termin\s+erinner|medikament|tablette|einkauf|mitnehm|pack(?:en)?|mail|nachricht|sag(?:en)?\s+(?:ihm|ihr|denen|dem|der))\b/iu;

const PURE_REMIND_RE =
  /\berinner(?:e|n)?\s+(?:mich|uns)\b/iu;

const WAKE_STRONG_RE =
  /\b(?:wecker|geweckt|weck\s+mich|aufweck|alarm(?:uhr)?|auf\s*steh|aufsteh|wach\s*(?:sein|werden|machen|bin))\b/iu;

/** „früh genug / rechtzeitig wecken“ ohne feste Weckzeit */
const WAKE_SOFT_ENOUGH_RE =
  /\b(?:weck|geweckt|aufsteh).{0,24}\b(?:früh|frueh)\s*genug\b|\b(?:früh|frueh)\s*genug.{0,24}\b(?:weck|aufsteh|wach)\b|\bweck\s+mich\s+(?:dann\s+)?(?:bitte\s+)?(?:rechtzeitig|pünktlich|puenktlich)\b/iu;

const PARK_CTX_RE =
  /\b(?:park(?:en|platz|ticket|dauer)|auto\s+(?:hier|parken|steht)|mein(?:en)?\s+auto|ticket\s+gilt|nur\s+\d+\s*stunden?\s+park)\b/iu;

const TIMER_RE =
  /\b(?:timer|eieruhr|countdown|stoppuhr)\b|\b(?:stell|setz|mach).{0,20}\b(?:timer|countdown)\b/iu;

const CLOCK_TOKEN_RE =
  /\b(?:um\s*)?(\d{1,2})(?:[:.](\d{2}))?\s*(?:uhr)?\b/giu;

function asksRemindLight(text: string): boolean {
  return (
    PURE_REMIND_RE.test(text) ||
    /\b(?:erinnerung|denk\s+dran|mach\s+mich\s+dran|sag\s+(?:mir\s+)?bescheid)\b/iu.test(
      text,
    )
  );
}

function hasParkingDurationHint(text: string): boolean {
  return (
    /\b\d{1,2}\s*(?:stunden|stunde|std|h)\b/iu.test(text) ||
    /\b\d{1,3}\s*(?:minuten|minute|min)\b/iu.test(text) ||
    /\b(?:bis|gilt\s+bis)\s*\d{1,2}[:.]\d{2}\b/iu.test(text)
  );
}

function clockToMs(h: number, m: number, nowMs: number): number | null {
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  const d = new Date(nowMs);
  d.setSeconds(0, 0);
  d.setHours(h, m, 0, 0);
  if (d.getTime() < nowMs + 20_000) d.setDate(d.getDate() + 1);
  return d.getTime();
}

function allClocks(text: string): Array<{ h: number; m: number; index: number }> {
  const out: Array<{ h: number; m: number; index: number }> = [];
  const re = new RegExp(CLOCK_TOKEN_RE.source, CLOCK_TOKEN_RE.flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) != null) {
    const h = Number(match[1]);
    const m = match[2] != null && match[2] !== '' ? Number(match[2]) : 0;
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      out.push({ h, m, index: match.index });
    }
  }
  return out;
}

function windowAround(text: string, index: number, radius = 28): string {
  return text.slice(Math.max(0, index - radius), index + radius);
}

/**
 * Abfahrts-/Ankerzeit neben ÖPNV/Flug — nicht als Weckzeit lesen.
 */
export function extractTransitDepartureMs(
  text: string,
  nowMs = Date.now(),
): number | null {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t || !TRANSIT_RE.test(t)) return null;

  const clocks = allClocks(t);
  for (const c of clocks) {
    const win = windowAround(t, c.index, 36);
    if (
      TRANSIT_RE.test(win) ||
      /\b(?:zur|zum|nach|mit|ab|fährt|faehrt|geht)\b/iu.test(win)
    ) {
      return clockToMs(c.h, c.m, nowMs);
    }
  }

  // Fallback: einzige Uhrzeit im Transit-Satz
  if (clocks.length === 1) {
    return clockToMs(clocks[0].h, clocks[0].m, nowMs);
  }
  return null;
}

/**
 * Explizite Weckzeit, die NICHT die Transit-Abfahrt ist.
 * „Bahn um 8:45, weck mich um 6“ → 6:00; „Bahn um 8:45, weck früh genug“ → null.
 */
export function extractWakeMsExcludingTransit(
  text: string,
  nowMs = Date.now(),
): number | null {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return null;

  const transitMs = extractTransitDepartureMs(t, nowMs);
  const clocks = allClocks(t);

  // „weck mich um X“ / „Wecker auf X“
  const wakePhrase =
    t.match(
      /\b(?:weck(?:e|en)?\s+(?:mich|uns)|wecker|alarm).{0,20}\b(?:um\s*)?(\d{1,2})(?:[:.](\d{2}))?\s*(?:uhr)?\b/iu,
    ) ||
    t.match(
      /\b(?:um\s*)?(\d{1,2})(?:[:.](\d{2}))?\s*(?:uhr)?\b.{0,16}\b(?:weck|wecker|aufsteh|wach)\b/iu,
    );
  if (wakePhrase) {
    const h = Number(wakePhrase[1]);
    const m =
      wakePhrase[2] != null && wakePhrase[2] !== ''
        ? Number(wakePhrase[2])
        : 0;
    const ms = clockToMs(h, m, nowMs);
    if (ms != null && (transitMs == null || Math.abs(ms - transitMs) > 90_000)) {
      return ms;
    }
  }

  if (WAKE_SOFT_ENOUGH_RE.test(t)) return null;

  // Zwei Uhren: die nicht-transit-nahe nehmen
  if (transitMs != null && clocks.length >= 2) {
    for (const c of clocks) {
      const ms = clockToMs(c.h, c.m, nowMs);
      if (ms != null && Math.abs(ms - transitMs) > 90_000) return ms;
    }
  }

  // Kein Transit: erste Uhr ok (Caller prüft Wake-Intent)
  if (transitMs == null && clocks.length >= 1) {
    return clockToMs(clocks[0].h, clocks[0].m, nowMs);
  }

  return null;
}

/** Default Fußweg zur Haltestelle, wenn noch keine Live-ETA. */
export const DEFAULT_TRANSIT_WALK_MIN = 12;

/**
 * Reine Erinnerung (anrufen/Todo) — nicht Wecker, auch wenn „um 10“.
 */
export function isPureReminderIntent(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!asksRemindLight(t)) return false;
  if (WAKE_STRONG_RE.test(t) || WAKE_SOFT_ENOUGH_RE.test(t)) return false;
  if (
    /\b(?:morgens|früh|frueh)\b/iu.test(t) &&
    /\b(?:auf\s*steh|aufsteh|wach|raus|geweckt)\b/iu.test(t)
  ) {
    return false;
  }
  if (REMIND_TASK_RE.test(t)) return true;
  if (PURE_REMIND_RE.test(t) && hasClockHint(t) && !WAKE_STRONG_RE.test(t)) {
    if (
      /\b(?:morgen\s+)?(?:früh|frueh|morgens)\b/iu.test(t) &&
      !REMIND_TASK_RE.test(t)
    ) {
      return false;
    }
    return true;
  }
  return asksRemindLight(t) && !isWakeAlarmIntent(t);
}

/** Essen/Gericht im Satz → Gastro-Pitch, keine Waldparkplatz-Suche. */
function isGastroWishOverParking(text: string): boolean {
  const t = text.toLowerCase();
  if (
    /\b(steak|rumpsteak|ribeye|entrecôte|entrecote|schnitzel|sushi|pizza|burger|döner|doener|kebab|vegan|vegetar|asiatisch|imbiss)\b/iu.test(
      t,
    )
  ) {
    return true;
  }
  if (/\bessen\s+gehen\b/iu.test(t)) return true;
  if (/\bessen\b/iu.test(t) && /\b(restaurant|hunger|steakhouse)\b/iu.test(t)) {
    return true;
  }
  return false;
}

export function isParkingSearchIntent(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (!/\b(parkplatz|parken|parkhaus|parkplätze|parkplaetze|parkplatzsuche|p\+\s*r)\b/iu.test(t)) {
    return false;
  }
  if (isGastroWishOverParking(t)) return false;
  if (
    /\b(kostenlos(?:e[nsm]?)?|gratis|frei(?:er|en|es)?\s+park|ohne\s+(?:zu\s+)?zahlen|günstig(?:e[nsm]?)?\s+park)\b/iu.test(
      t,
    )
  ) {
    return true;
  }
  // „Gibt es Parkplätze?“ / „Parkplatz bitte“ ohne klassisches Suchverb
  return /\b(suche|such|find(?:e|en)?|wo\s+(?:ist|gibt|finde|liegt)|gibt\s+es|gibt|nächste[rn]?|brauch|möcht|moecht|zeig|bitte|raus\s*suchen)\b/iu.test(
    t,
  );
}

export function isParkingCareIntent(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (isParkingSearchIntent(t)) return false;
  if (/\bparkticket\b/iu.test(t)) return true;
  if (PARK_CTX_RE.test(t) && hasParkingDurationHint(t)) return true;
  if (
    /\b(?:mein(?:en)?\s+)?auto\b/iu.test(t) &&
    /\b(?:park|stunden|ticket)\b/iu.test(t) &&
    /\b(speicher|merk|hier|geparkt|darf\s+nur|maximale\s+park)\b/iu.test(t)
  ) {
    return true;
  }
  if (/\bpark(?:en|platz|ticket)\b/iu.test(t) && hasParkingDurationHint(t)) {
    return true;
  }
  return false;
}

export function isTransitLeaveIntent(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (isFlightTripQuery(t)) return false;
  if (!TRANSIT_RE.test(t)) return false;

  // Explizites Los / Leave
  if (LEAVE_RE.test(t)) return true;

  // „muss/soll … zur Bahn/zum Zug“ + Zeit
  if (
    /\b(?:muss|soll|will|möchte|moechte|brauch)\b/iu.test(t) &&
    (/\b(?:zur|zum|mit|in)\s+(?:bahn|zug|bus|s-?bahn|u-?bahn|flughafen|ice)\b/iu.test(
      t,
    ) ||
      hasClockHint(t))
  ) {
    return true;
  }

  // Abfahrt mit Uhrzeit
  if (hasClockHint(t) && extractTransitDepartureMs(t) != null) return true;

  // Erinner/nicht verpassen im Transit-Satz
  if (/\berinner|pünktlich|puenktlich|nicht\s+verpassen|bescheid\b/iu.test(t)) {
    return true;
  }

  return false;
}

function wantsWakeSignal(text: string): boolean {
  if (WAKE_STRONG_RE.test(text) || WAKE_SOFT_ENOUGH_RE.test(text)) return true;
  if (isWakeAlarmIntent(text) && !isPureReminderIntent(text)) return true;
  return false;
}

/**
 * Klassifiziert Care-Zeit-Intents. Priorität:
 * Parken → Timer → Compound Wake+Transit → Wake → Reminder → Transit.
 */
export function classifyTimeCareIntent(text: string): TimeCareIntent | null {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (isFlightTripQuery(t)) return null;

  if (isParkingCareIntent(t)) {
    return { kind: 'parking', confidence: 0.92, reason: 'parking_ctx' };
  }

  if (TIMER_RE.test(t)) {
    return { kind: 'timer', confidence: 0.95, reason: 'timer' };
  }

  const wantsWake = wantsWakeSignal(t);
  const wantsTransit = isTransitLeaveIntent(t);

  if (wantsWake && wantsTransit) {
    return {
      kind: 'compound_wake_transit',
      confidence: 0.93,
      reason: 'wake+transit',
    };
  }

  // Transit/Leave-by vor weichem „sag Bescheid“ (sonst wird Zug→Reminder)
  if (wantsTransit && !REMIND_TASK_RE.test(t)) {
    return { kind: 'transit_leave', confidence: 0.88, reason: 'transit' };
  }

  if (isPureReminderIntent(t)) {
    return { kind: 'reminder', confidence: 0.9, reason: 'pure_remind' };
  }

  if (wantsWake) {
    return { kind: 'wake', confidence: 0.88, reason: 'wake' };
  }

  if (wantsTransit) {
    return { kind: 'transit_leave', confidence: 0.85, reason: 'transit_taskish' };
  }

  if (asksRemindLight(t)) {
    return { kind: 'reminder', confidence: 0.75, reason: 'remind_fallback' };
  }

  return null;
}
