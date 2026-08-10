/**
 * Zeitpuffer-Policy — einheitlich für Flug, Termine, Multi-Stop.
 *
 * Regel:
 * - Immer mindestens 5 Min Puffer (allgemein)
 * - Insel-Flugplatz: ~15 Min
 * - Großflughafen: mind. 70 Min vor Abflug; mit Gepäckabgabe 90 Min
 * - User kann mehr/weniger wählen — Findus fragt nach
 */

export type BufferImportance =
  | 'low'
  | 'normal'
  | 'high'
  | 'critical';

export type BufferKind =
  | 'flight_island'
  | 'flight_commercial'
  | 'hotel_checkout'
  | 'reservation'
  | 'sport'
  | 'appointment'
  | 'meetup'
  | 'generic';

export type BufferAssessment = {
  minutes: number;
  importance: BufferImportance;
  reason: string;
  kind: BufferKind;
  /** Empfohlenes Default (ohne User-Override) */
  recommendedMin: number;
  /** Ob Gepäckabgabe eingerechnet wurde */
  withCheckedLuggage: boolean;
  /** Speech-Frage an den User */
  askUserSpeech: string | null;
};

const MIN_BUFFER_MIN = 5;
/** Großflughafen ohne Gepäckaufgabe: 60 Min (Board 30 + Security/Weg 30) */
export const COMMERCIAL_AIRPORT_MIN_MIN = 60;
/** Großflughafen mit Gepäckabgabe / Check-in-Koffer */
export const COMMERCIAL_AIRPORT_LUGGAGE_MIN = 90;
/** Absolute Untergrenze Großflughafen, wenn User explizit weniger will */
const COMMERCIAL_AIRPORT_FLOOR_MIN = 45;
const COMMERCIAL_AIRPORT_CEIL_MIN = 150;

const CHECKED_LUGGAGE_RE =
  /\b(gepäck\s*abgeb|gepaeck\s*abgeb|koffer\s*(?:aufgeb|eincheck|abgeb)|check[\s-]?in[\s-]?gepäck|check[\s-]?in[\s-]?gepaeck|aufgabegepäck|aufgabegepaeck|hold\s*bag|checked\s*bag|koffer\s+mit|mit\s+(?:koffer|großem\s+gepäck|grossem\s+gepaeck)|gepäck\s+aufgeben|gepaeck\s+aufgeben)\b/iu;

const MORE_BUFFER_RE =
  /\b(mehr\s+puffer|größeren?\s+puffer|groesseren?\s+puffer|länger\s+puffer|laenger\s+puffer|lieber\s+früher|lieber\s+frueher|extra\s+puffer|sicherer\s+puffer)\b/iu;

const LESS_BUFFER_RE =
  /\b(weniger\s+puffer|knappere?n?\s+puffer|kürzer(?:en)?\s+puffer|kuerzer(?:en)?\s+puffer|weniger\s+zeit|knapp\s+kalkul|später\s+los|spaeter\s+los)\b/iu;

export function detectCheckedLuggage(text: string): boolean {
  return CHECKED_LUGGAGE_RE.test(text.replace(/\s+/g, ' ').trim());
}

/** Absolute Minuten aus „90 Minuten Puffer“ / „Puffer 70“. */
export function parseExplicitBufferMinutes(text: string): number | null {
  const t = text.replace(/\s+/g, ' ').trim();
  const m =
    t.match(
      /\b(?:puffer|ankunft|früher|frueher|vor\s+abflug)\s*(?:von\s+)?(\d{2,3})\s*(?:min(?:uten)?|m)?\b/iu,
    ) ||
    t.match(
      /\b(\d{2,3})\s*(?:min(?:uten)?|m)\s*(?:puffer|früher|frueher|vor\s+(?:dem\s+)?abflug)?\b/iu,
    );
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  if (n < 5 || n > 180) return null;
  return n;
}

export function wantsMoreAirportBuffer(text: string): boolean {
  return MORE_BUFFER_RE.test(text.replace(/\s+/g, ' ').trim());
}

export function wantsLessAirportBuffer(text: string): boolean {
  return LESS_BUFFER_RE.test(text.replace(/\s+/g, ' ').trim());
}

/**
 * Schätzt den Ankunfts-/Leave-by-Puffer (Minuten vor Deadline am Ziel).
 */
export function assessTimeBuffer(opts: {
  kind?: BufferKind;
  text?: string;
  /** Optional: bereits vorgeschlagene Minuten */
  suggestedMin?: number | null;
  /** Gepäckabgabe am Schalter (Großflughafen) */
  withCheckedLuggage?: boolean | null;
  /** Gespeicherte User-Präferenz (Minuten) */
  userPreferredMin?: number | null;
}): BufferAssessment {
  const text = (opts.text ?? '').toLowerCase();
  let kind: BufferKind = opts.kind ?? 'generic';

  if (!opts.kind) {
    if (/\b(flug|flieger|abflug|boarding|flughafen|flugplatz)\b/.test(text)) {
      kind = /\b(insel|wangerooge|harle|inselflieger)\b/.test(text)
        ? 'flight_island'
        : 'flight_commercial';
    } else if (/\b(check[\s-]?out|auscheck)\b/.test(text)) {
      kind = 'hotel_checkout';
    } else if (/\b(reservier|tisch|restaurant)\b/.test(text)) {
      kind = 'reservation';
    } else if (/\b(tennis|sport|match|turnier|training)\b/.test(text)) {
      kind = 'sport';
    } else if (/\b(termin|arzt|bahnhof|zug|fähre|faehre)\b/.test(text)) {
      kind = 'appointment';
    }
  }

  const luggage =
    opts.withCheckedLuggage === true ||
    (opts.withCheckedLuggage !== false && detectCheckedLuggage(text));

  let importance: BufferImportance = 'normal';
  let minutes = 10;
  let reason = 'Standard-Puffer';
  let askUserSpeech: string | null = null;

  switch (kind) {
    case 'flight_commercial': {
      importance = 'critical';
      minutes = luggage
        ? COMMERCIAL_AIRPORT_LUGGAGE_MIN
        : COMMERCIAL_AIRPORT_MIN_MIN;
      reason = luggage
        ? `Großflughafen mit Gepäckabgabe: ${COMMERCIAL_AIRPORT_LUGGAGE_MIN} Min vor Abflug`
        : `Großflughafen: mind. ${COMMERCIAL_AIRPORT_MIN_MIN} Min vor Abflug (ohne Gepäckaufgabe)`;
      askUserSpeech = luggage
        ? `Ich plane ${COMMERCIAL_AIRPORT_LUGGAGE_MIN} Minuten vor Abflug am Flughafen — wegen Gepäckabgabe. Brauchst du mehr oder weniger Puffer?`
        : `Ich plane ${COMMERCIAL_AIRPORT_MIN_MIN} Minuten vor Abflug am Flughafen. Mit Gepäckabgabe wären es ${COMMERCIAL_AIRPORT_LUGGAGE_MIN}. Brauchst du mehr oder weniger Puffer?`;
      break;
    }
    case 'flight_island':
      importance = 'high';
      minutes = 15;
      reason = 'Insel-Flugplatz: mind. 10–15 Min vor Abflug da';
      askUserSpeech =
        'Für den Insel-Flugplatz rechne ich 15 Minuten Puffer — reicht das, oder lieber mehr?';
      break;
    case 'sport':
      importance = 'high';
      minutes = 5;
      reason = 'Sport/Training: mind. 5 Min früher am Platz';
      break;
    case 'reservation':
      importance = 'high';
      minutes = 12;
      reason = 'Tischreservierung: nicht punktgenau';
      break;
    case 'hotel_checkout':
      importance = 'normal';
      minutes = 10;
      reason = 'Checkout-Puffer';
      break;
    case 'appointment':
      importance = 'high';
      // Großer Bahnhof / Hbf → 10 Min; sonst 5
      minutes = /\b(hauptbahnhof|hbf)\b/.test(text) ? 10 : 5;
      reason = minutes >= 10
        ? 'Großer Bahnhof: 10 Min früher da'
        : 'Bahnhof/Termin: 5 Min früher da';
      break;
    case 'meetup':
      importance = 'normal';
      minutes = 8;
      reason = 'Treffpunkt';
      break;
    default:
      importance = 'normal';
      minutes = 8;
      reason = 'Allgemeiner Weg-Puffer';
  }

  const recommendedMin = minutes;

  const explicit = parseExplicitBufferMinutes(opts.text ?? '');
  if (explicit != null) {
    minutes = explicit;
    reason = `Dein Wunsch-Puffer: ${explicit} Min`;
  } else if (
    opts.userPreferredMin != null &&
    Number.isFinite(opts.userPreferredMin)
  ) {
    minutes = Math.round(opts.userPreferredMin);
    reason = `Dein gespeicherter Puffer: ${minutes} Min`;
  } else if (opts.suggestedMin != null && Number.isFinite(opts.suggestedMin)) {
    minutes = Math.max(minutes, Math.round(opts.suggestedMin));
  }

  if (wantsMoreAirportBuffer(opts.text ?? '') && explicit == null) {
    minutes += kind === 'flight_commercial' ? 20 : 10;
    reason = `Mehr Puffer: ${minutes} Min`;
  } else if (wantsLessAirportBuffer(opts.text ?? '') && explicit == null) {
    minutes -= kind === 'flight_commercial' ? 15 : 5;
    reason = `Weniger Puffer: ${minutes} Min`;
  }

  // Harte Grenzen
  if (kind === 'flight_commercial') {
    const floor =
      explicit != null || wantsLessAirportBuffer(opts.text ?? '')
        ? COMMERCIAL_AIRPORT_FLOOR_MIN
        : luggage
          ? COMMERCIAL_AIRPORT_LUGGAGE_MIN
          : COMMERCIAL_AIRPORT_MIN_MIN;
    // Wenn User weniger will: floor 45; sonst Empfehlungs-Minimum halten
    if (wantsLessAirportBuffer(opts.text ?? '') || explicit != null) {
      minutes = Math.max(COMMERCIAL_AIRPORT_FLOOR_MIN, Math.min(COMMERCIAL_AIRPORT_CEIL_MIN, minutes));
    } else {
      minutes = Math.max(floor, Math.min(COMMERCIAL_AIRPORT_CEIL_MIN, minutes));
    }
  } else {
    minutes = Math.max(MIN_BUFFER_MIN, Math.min(45, minutes));
  }

  return {
    minutes,
    importance,
    reason,
    kind,
    recommendedMin,
    withCheckedLuggage: luggage && kind === 'flight_commercial',
    askUserSpeech,
  };
}

/** Clamp beliebiger Puffer-Wert auf Policy. */
export function clampBufferMinutes(
  value: number | null | undefined,
  opts?: {
    text?: string;
    kind?: BufferKind;
    withCheckedLuggage?: boolean;
    userPreferredMin?: number | null;
  },
): number {
  const assessed = assessTimeBuffer({
    kind: opts?.kind,
    text: opts?.text,
    suggestedMin: value,
    withCheckedLuggage: opts?.withCheckedLuggage,
    userPreferredMin: opts?.userPreferredMin,
  });
  return assessed.minutes;
}

export const TIME_BUFFER_MIN_MINUTES = MIN_BUFFER_MIN;
