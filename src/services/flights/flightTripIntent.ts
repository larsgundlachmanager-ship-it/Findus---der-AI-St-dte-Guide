/**
 * Flight-trip intent: destination + booked vs wish.
 * Pure — no RN. Infer, don't spam slot questions.
 */

import { findAirportMentionedInText } from './airportIata';
import { classifyUtteranceFamily } from '../../module2/kernel/utteranceFamily';

export type FlightBookingStance = 'booked' | 'wish' | 'ambiguous';

export type FlightTripSlots = {
  isFlightTrip: boolean;
  stance: FlightBookingStance;
  destHint: string | null;
  originHint: string | null;
  returning: boolean;
  clockHm: string | null;
  dateHint: 'today' | 'tomorrow' | 'evening' | 'weekday' | null;
  weekdayDe: string | null;
  monthIndex: number | null;
  dateFlex: 'week' | 'month' | 'cheapest' | null;
  flightCode: string | null;
  luggage: 'carry' | 'checked' | 'unknown';
  wantsHelpBooking: boolean;
  alreadyBookedExplicit: boolean;
  leaveByAsk: boolean;
};

const FLIGHT_VERB =
  /\b(flugnummer|flüge|fluege|flug|flieger|fliegen|flieg(?:e|st|t)?|abflug|boarding|flughafen|airport|gate|check[\s-]?in)\b/iu;

const WISH_RE =
  /\b(möchte(?:n)?(?:\s+gerne)?|wuerde\s+gerne|würde\s+gerne|will(?:st)?|lust\s+auf|bock\s+auf|such(?:e|en)?|buch(?:e|en)?|hilf(?:st)?\s+mir|noch\s+keinen)\b/iu;

const BOOKED_RE =
  /\b(ich\s+flieg(?:e|st|t)?|flieg(?:e|st|t)?\s+heute|mein(?:e[rn]?)?\s+(?:flug|flieger)|schon\s+gebucht|habe\s+(?:schon\s+)?(?:einen?\s+)?(?:flug|flieger)|gebucht|zurückflieg|zurueckflieg|rückflug|rueckflug|von\s+\w+\s+zurück|von\s+\w+\s+zurueck)\b/iu;

const LEAVE_BY_RE =
  /\b(wann\s+(?:muss|soll)(?:\s+ich)?.{0,48}(?:flughafen|los|da\s+sein)|(?:muss|müsst|müssen|muessen).{0,24}am\s+flughafen|am\s+flughafen\s+sein|wann\s+los(?:fahren|gehen)?|check[\s-]?in\s+zeit|boarding)\b/iu;

const MUST_FLY_RE =
  /\b(muss|müsst|muessen|müssen)\b.{0,48}\b(fliegen|fliegst|fliegt|flug|flieger)\b/iu;

const GET_THE_PLANE_RE =
  /\b(den\s+flieger|den\s+flug|pünktlich.{0,20}flieg|puenktlich.{0,20}flieg|flieger\s+bekomm)\b/iu;

const RETURN_RE =
  /\b(zurück|zurueck|rückflug|rueckflug|heimflieg|heim\s*flieg)\b/iu;

const FROM_CITY_RE =
  /\bvon\s+([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß\-']+(?:\s+[A-Za-zÄÖÜäöüß][\wÄÖÜäöüß\-']+){0,2})/iu;

const TO_CITY_RE =
  /\b(?:nach|richtung)\s+([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß\-']+(?:\s+[A-Za-zÄÖÜäöüß][\wÄÖÜäöüß\-']+){0,2})/iu;

const BAHN_EXPLICIT =
  /\b(bahn|zug|ice|ic\b|re\b|rb\b|s-?bahn|öpnv|oepnv|flixbus|verbindung\s+nach)\b/iu;

const CHECKED_BAG_RE =
  /\b(aufgabegepäck|aufgabegepaeck|koffer\s*(?:aufgeb|eincheck|mit)|gepäck\s*abgeb|gepaeck\s*abgeb|checked\s*bag)\b/iu;

const CARRY_BAG_RE =
  /\b(handgepäck|handgepaeck|nur\s+handgepäck|nur\s+handgepaeck|nur\s+cabin|cabin\s*bag|ohne\s+koffer|ohne\s+aufgabe)\b/iu;

const CLOCK_HM =
  /\b(?:um|gegen)?\s*(\d{1,2})[:.](\d{2})\s*(?:uhr)?\b/iu;
const CLOCK_UHR = /\b(?:um|gegen)?\s*(\d{1,2})\s*uhr(?:\s*(\d{1,2}))?\b/iu;
const CLOCK_UM_HOUR =
  /\b(?:um|gegen)\s+(\d{1,2})\b(?!\s*(?:min|minute|minuten|sek))/iu;

const HOUR_WORDS: Record<string, number> = {
  eins: 1,
  ein: 1,
  zwei: 2,
  drei: 3,
  vier: 4,
  fuenf: 5,
  fünf: 5,
  sechs: 6,
  sieben: 7,
  acht: 8,
  neun: 9,
  zehn: 10,
  elf: 11,
  zwoelf: 12,
  zwölf: 12,
  zwo: 12,
};

const MONTH_WORDS: Record<string, number> = {
  januar: 1,
  februar: 2,
  maerz: 3,
  märz: 3,
  april: 4,
  mai: 5,
  juni: 6,
  juli: 7,
  august: 8,
  september: 9,
  oktober: 10,
  october: 10,
  november: 11,
  dezember: 12,
  december: 12,
};

const STOP_DEST =
  /^(den|die|das|dem|der|mein|meinen|heute|morgen|abend|flughafen|airport|hause|haus|mir|dir)$/iu;

/** Bricht „nach Antalya wann muss ich…“ — Stadt, nicht die Frage. */
const DEST_CUT =
  /^(wann|muss|müsst|muessen|müssen|soll|sollte|sollst|ich|wir|du|los|sein|spätestens|spaetestens)$/iu;

const INSEL_RE =
  /\b(inselflieger|wangerooge|flugplatz\s*harle|frisia\s*luft)\b/iu;

const KNOWN_IDENT =
  /\b((?:LH|LX|OS|BA|AF|KL|EW|U2|FR|W6|SK|AY|IB|TP|AZ|SN|DE|XQ|PC|TK|XC|FH|VF|A3|4M)\s?\d{1,4}[A-Z]?)\b/i;

export function extractFlightIdent(text: string): string | null {
  const u = text.toUpperCase();
  const known = u.match(KNOWN_IDENT);
  if (known?.[1]) return known[1].replace(/\s+/g, '');
  const digitAirline = u.match(/\b(\d[A-Z]\s?\d{2,4}[A-Z]?)\b/);
  if (digitAirline?.[1]) return digitAirline[1].replace(/\s+/g, '');
  const generic = u.match(/\b([A-Z]{2,3}\s?\d{2,4}[A-Z]?)\b/);
  if (!generic?.[1]) return null;
  if (/\b(UM|AM|IM|PM|ZM|NM|BIS|AB)\s?\d/i.test(generic[1])) return null;
  return generic[1].replace(/\s+/g, '');
}

function extractIdent(text: string): string | null {
  return extractFlightIdent(text);
}

function isIslandFlightQuery(text: string): boolean {
  return INSEL_RE.test(text);
}

function cleanHint(raw: string | null): string | null {
  if (!raw) return null;
  const parts = raw
    .replace(/[.,!?]+$/g, '')
    .split(/\s+/)
    .filter(Boolean);
  const kept: string[] = [];
  for (const p of parts) {
    if (STOP_DEST.test(p) || DEST_CUT.test(p)) break;
    if (/^(fliegen|flieg|flieger|flug)$/iu.test(p)) break;
    kept.push(p);
  }
  const s = kept.join(' ').trim();
  if (s.length < 3 || STOP_DEST.test(s)) return null;
  return s.slice(0, 48);
}

function padHm(h: number, m: number): string | null {
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function extractClockHm(text: string): string | null {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;

  const hm = t.match(CLOCK_HM);
  if (hm) {
    const got = padHm(Number(hm[1]), Number(hm[2]));
    if (got) return got;
  }

  // halb drei → 02:30 · viertel nach zwei → 02:15 · viertel vor drei → 02:45
  const halb = t.match(
    /\b(?:um|gegen)?\s*halb\s+(eins|ein|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht|neun|zehn|elf|zwölf|zwoelf|zwo|\d{1,2})\b/iu,
  );
  if (halb?.[1]) {
    const raw = halb[1].toLowerCase().replace('ä', 'ae');
    const hWord = HOUR_WORDS[raw];
    const hNum = /^\d+$/.test(raw) ? Number(raw) : hWord;
    if (hNum != null && hNum >= 1 && hNum <= 23) {
      const hour = hNum === 1 ? 0 : hNum - 1;
      const got = padHm(hour === 0 ? 0 : hour, 30);
      if (got) return got;
    }
  }
  const viertelNach = t.match(
    /\b(?:um|gegen)?\s*viertel\s+nach\s+(eins|ein|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht|neun|zehn|elf|zwölf|zwoelf|zwo|\d{1,2})\b/iu,
  );
  if (viertelNach?.[1]) {
    const raw = viertelNach[1].toLowerCase().replace('ä', 'ae');
    const h = HOUR_WORDS[raw] ?? (/^\d+$/.test(raw) ? Number(raw) : null);
    if (h != null) {
      const got = padHm(h, 15);
      if (got) return got;
    }
  }
  const viertelVor = t.match(
    /\b(?:um|gegen)?\s*viertel\s+vor\s+(eins|ein|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht|neun|zehn|elf|zwölf|zwoelf|zwo|\d{1,2})\b/iu,
  );
  if (viertelVor?.[1]) {
    const raw = viertelVor[1].toLowerCase().replace('ä', 'ae');
    const h = HOUR_WORDS[raw] ?? (/^\d+$/.test(raw) ? Number(raw) : null);
    if (h != null) {
      const hour = h === 1 ? 0 : h - 1;
      const got = padHm(hour, 45);
      if (got) return got;
    }
  }

  const uhr = t.match(CLOCK_UHR);
  if (uhr) {
    const got = padHm(Number(uhr[1]), uhr[2] != null ? Number(uhr[2]) : 0);
    if (got) return got;
  }
  const word = t.match(
    /\b(?:um|gegen)?\s*(eins|ein|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht|neun|zehn|elf|zwölf|zwoelf|zwo)\s*uhr\b/iu,
  );
  if (word?.[1]) {
    const key = word[1].toLowerCase().replace('ä', 'ae');
    const h = HOUR_WORDS[key] ?? HOUR_WORDS[word[1].toLowerCase()];
    if (h != null) return padHm(h, 0);
  }
  // „um 2 30“ / „gegen 14 05“ ohne Doppelpunkt
  const spaced = t.match(
    /\b(?:um|gegen)\s+(\d{1,2})\s+(\d{2})\b(?!\s*(?:min|minute|minuten))/iu,
  );
  if (spaced) {
    const got = padHm(Number(spaced[1]), Number(spaced[2]));
    if (got) return got;
  }
  const um = t.match(CLOCK_UM_HOUR);
  if (um) {
    const got = padHm(Number(um[1]), 0);
    if (got) return got;
  }
  return null;
}

function extractMonthIndex(text: string): number | null {
  const t = text.toLowerCase().replace('ä', 'ae');
  for (const [name, idx] of Object.entries(MONTH_WORDS)) {
    if (new RegExp(`\\b${name}\\b`, 'i').test(t)) return idx;
  }
  return null;
}

function extractDateFlex(
  text: string,
  monthIndex: number | null,
): FlightTripSlots['dateFlex'] {
  const cheap =
    /\b(günstig\w*|guenstig\w*|billigst\w*|billig(?:er)?|cheapest|flexibel)\b/iu.test(
      text,
    );
  if (cheap) return 'cheapest';
  if (monthIndex) return 'month';
  if (/\b(?:die|diese|nächste|naechste)\s+woche\b/iu.test(text)) return 'week';
  return null;
}

export function inferFlightBookingStance(text: string): FlightBookingStance {
  const t = text.replace(/\s+/g, ' ').trim();
  if (/\bschon\s+gebucht|habe\s+(?:den|einen)\s+flieger|habe\s+gebucht\b/iu.test(t)) {
    return 'booked';
  }
  if (/\b(noch\s+keinen|hilf(?:st)?\s+mir.{0,24}buch|flug\s+buchen|flieger\s+buchen)\b/iu.test(t)) {
    return 'wish';
  }
  if (
    LEAVE_BY_RE.test(t) ||
    BOOKED_RE.test(t) ||
    MUST_FLY_RE.test(t) ||
    GET_THE_PLANE_RE.test(t)
  ) {
    return 'booked';
  }
  if (WISH_RE.test(t) && (FLIGHT_VERB.test(t) || findAirportMentionedInText(t))) {
    return 'wish';
  }
  if (extractDateFlex(t, extractMonthIndex(t))) {
    return 'wish';
  }
  if (
    FLIGHT_VERB.test(t) &&
    (/\b(heute|morgen|abend)\b/iu.test(t) ||
      TO_CITY_RE.test(t) ||
      Boolean(findAirportMentionedInText(t)) ||
      Boolean(extractClockHm(t)))
  ) {
    return 'booked';
  }
  return 'ambiguous';
}

export function speechInventedAirportLead(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  return (
    /\b(?:ca\.?\s*)?(?:anderthalb|eineinhalb|zwei|drei|2|3)\s*(?:stunden?|std\.?)\b/iu.test(
      t,
    ) ||
    /\b(?:90|120|180)\s*min(?:uten?)?\b/iu.test(t) ||
    /\bstunden?\s*(?:vorher|früher|frueher|vorab|vor\s+(?:abflug|dem\s+abflug))\b/iu.test(
      t,
    )
  );
}

/** Reise-Lob ohne Flug-Hook — Call 2 würde sonst Tourismus statt Leave-by. */
export function speechFlightTourismOnlyBridge(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  const praise =
    /\bklingt\s+(?:hervorragend|toll|super|richtig gut|spannend|wunderbar|mega|klasse)\b/iu.test(
      t,
    ) ||
    /\b(?:hervorragend|wunderbar)\s+(?:für|für\s+eine\s+reise)\b/iu.test(t);
  const flightHook =
    /\b(flug|flieger|flieg|abflug|flughafen|wann|uhrzeit|leave|losgeh|check.?in|security|gate|terminal|gepäck|gepaeck)\b/iu.test(
      t,
    );
  return praise && !flightHook;
}

export function isFlightTripQuery(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return false;
  try {
    const { extractStreetAddressFromUtterance } = require('../navigation/streetAddressQuery') as {
      extractStreetAddressFromUtterance: (s: string) => string | null;
    };
    if (extractStreetAddressFromUtterance(t) && !FLIGHT_VERB.test(t)) return false;
  } catch {
    /* soft */
  }
  if (isIslandFlightQuery(t)) return false;
  if (BAHN_EXPLICIT.test(t) && !/\b(flug|flieger|fliegen|flughafen)\b/iu.test(t)) {
    return false;
  }
  try {
    const { looksLikeArriveByAppointment } = require('../../module2/kernel/utteranceFamily') as {
      looksLikeArriveByAppointment: (s: string) => boolean;
    };
    if (looksLikeArriveByAppointment(t)) return false;
  } catch {
    /* soft */
  }
  if (FLIGHT_VERB.test(t)) return true;
  const dest = findAirportMentionedInText(t);
  if (dest && (extractMonthIndex(t) || extractDateFlex(t, extractMonthIndex(t)))) {
    return true;
  }
  return false;
}

export function parseFlightTripSlots(text: string): FlightTripSlots {
  const t = text.replace(/\s+/g, ' ').trim();
  const isFlightTrip = isFlightTripQuery(t);
  const returning = RETURN_RE.test(t);
  const fromM = t.match(FROM_CITY_RE);
  const toM = t.match(TO_CITY_RE);
  let destHint = cleanHint(toM?.[1] ?? null);
  let originHint = cleanHint(fromM?.[1] ?? null);
  if (!destHint) {
    const mentioned = findAirportMentionedInText(t);
    if (mentioned) destHint = mentioned.city;
  }
  if (returning && originHint && !destHint) {
    destHint = null;
  }
  let dateHint: FlightTripSlots['dateHint'] = null;
  if (/\bheute\s+abend|heut\s+abend|heute\s+nacht\b/iu.test(t)) dateHint = 'evening';
  else if (/\bheute\b/iu.test(t)) dateHint = 'today';
  else if (/\bmorgen\b/iu.test(t)) dateHint = 'tomorrow';
  const wd = t.match(
    /\b(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/iu,
  );
  if (wd?.[1]) dateHint = 'weekday';

  let luggage: FlightTripSlots['luggage'] = 'unknown';
  if (CHECKED_BAG_RE.test(t)) luggage = 'checked';
  else if (CARRY_BAG_RE.test(t)) luggage = 'carry';

  const monthIndex = extractMonthIndex(t);
  const leaveByAsk = LEAVE_BY_RE.test(t);
  const wantsHelpBooking =
    /\b(hilf(?:st)?\s+mir.{0,30}(?:flug|flieger|buch)|flug\s+buchen|noch\s+buchen)\b/iu.test(
      t,
    );
  const alreadyBookedExplicit =
    /\b(schon\s+gebucht|habe\s+(?:den|einen)\s+(?:flug|flieger)|habe\s+gebucht)\b/iu.test(
      t,
    );

  return {
    isFlightTrip,
    stance: isFlightTrip
      ? inferFlightBookingStance(t)
      : leaveByAsk
        ? 'booked'
        : 'ambiguous',
    destHint,
    originHint,
    returning,
    clockHm: extractClockHm(t),
    dateHint,
    weekdayDe: wd?.[1]?.toLowerCase() ?? null,
    monthIndex,
    dateFlex: extractDateFlex(t, monthIndex),
    flightCode: extractIdent(t),
    luggage,
    wantsHelpBooking,
    alreadyBookedExplicit,
    leaveByAsk,
  };
}

const FOLLOW_RE =
  /\bnimm\s+flug\b|\bschon\s+gebucht\b|\bflug\s+buchen\b|\banderer\s+flieg|\bstimmt\s+nicht\b|\b(hand|aufgabe)gep[äa]ck\b|\bmit\s+koffer\b|\bflug\s+ist\s+(heute|morgen)\b|\b(um|gegen)\s*\d{1,2}|\bgünstig|\bguenstig|\boktober|\bwoche\b|\bpuffer\b|\bzum\s+flughafen\s+mit\b|\b(taxi|öpnv|oepnv)\s+zum\s+flughafen\b|\btimetable\b|\bdurchrechn|\beintragen\b|\bhinzufüg/iu;

export function isFlightIdentAsk(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  return /\b(flugnummer|wie\s+hei[sß](?:t|en)\s+.{0,40}\bflug|welche(?:n)?\s+flug(?:nummer)?)\b/iu.test(
    t,
  );
}

export function isFlightBufferFollowUp(text: string): boolean {
  return /\b(weniger\s+puffer|mehr\s+puffer|puffer\s+passt|passt\s+(?:so|der\s+puffer)|knappere?n?\s+puffer)\b/iu.test(
    text.replace(/\s+/g, ' '),
  );
}

export function isFlightPlanAck(text: string): boolean {
  const t = text.replace(/\s+/g, ' ');
  return /\b(zeitplan|tagesplan)\b.{0,40}\bpasst\b|\bpasst\b.{0,40}\b(zeitplan|tagesplan)\b|\bpasst\s+(?:erstmal|erst\s+mal)\s+so\b/iu.test(
    t,
  );
}

/** Kurzes Danke nach dem Flugplan — nicht in den Stadt-Chat abdriften. */
export function isFlightThanks(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t || t.length > 80) return false;
  if (
    /\b(hafen|hafenrundfahrt|museum|essen|restaurant|hotel\s+suchen|wohin)\b/iu.test(
      t,
    )
  ) {
    return false;
  }
  return /^(?:ja[,.]?\s+)?(?:super|perfekt|klasse|cool|passt|genau)(?:[,.]?\s+)?(?:vielen\s+dank|danke(?:\s+sch[oö]n)?)?[.!]?\s*$/iu.test(
    t,
  ) || /^(?:vielen\s+dank|danke(?:\s+sch[oö]n)?|gerne(?:\s+geschehen)?)[.!]?\s*$/iu.test(
    t,
  );
}

export function isAirportRideFollowUp(text: string): boolean {
  return /\bzum\s+flughafen\s+mit\b|\b(taxi|öpnv|oepnv|bahn|transfer)\s+zum\s+flughafen\b/iu.test(
    text.replace(/\s+/g, ' '),
  );
}

/** Flug-Satz mit Taxi/Uber-Anreise — Kette, kein separates Taxi-Hail. */
export function wantsFlightTaxiAccess(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (!/\b(flug|flieger|fliegen|flieg(?:e|st|t)?|abflug|flughafen)\b/iu.test(t)) {
    return false;
  }
  return (
    /\b(taxi|uber)\b/iu.test(t) ||
    /\bzum\s+flughafen\s+mit\s+(?:dem\s+)?(?:taxi|uber)\b/iu.test(t) ||
    /\b(?:taxi|uber)\s+zum\s+flughafen\b/iu.test(t)
  );
}

/** Nacktes Ja/Nein / Uhr zur letzten Yorro-Frage — nicht zum totigen Thread. */
export function isShortReplyToLastAsk(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t || t.length > 48) return false;
  if (CHECKED_BAG_RE.test(t) || CARRY_BAG_RE.test(t)) return true;
  if (extractClockHm(t)) return true;
  return /^(ja|jo|jap|jup|genau|klar|stimmt|okay|ok|passt|yes|yeah|nein|nee|nö|nope|no)(?:\s+(bitte|genau|klar|ok|okay))?[.!?]*$/iu.test(
    t,
  );
}

/**
 * Offene Flug-Session nicht wegscruben: Follow-up, Uhr, Ja/Nein zur letzten Ask.
 * session=new vom Manager darf den Trip nicht killen.
 */
export function shouldPreserveFlightTripSession(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (isFlightTripQuery(t)) return true;
  try {
    const { hasFlightTripSession, getFlightTripSession } = require('./flightTripSession') as {
      hasFlightTripSession: () => boolean;
      getFlightTripSession: () => { pendingAsk?: string | null } | null;
    };
    if (!hasFlightTripSession()) return false;
    if (isFlightTripFollowUp(t, true)) return true;
    if (extractClockHm(t)) return true;
    if (getFlightTripSession()?.pendingAsk && isShortReplyToLastAsk(t)) return true;
  } catch {
    /* soft */
  }
  return false;
}

/** Topic-Cut: Flug nur bei klar fremder Lane scrubben — nicht bei Trivia/Uhr/Unknown. */
export function shouldScrubFlightOnTopicCut(text: string): boolean {
  if (shouldPreserveFlightTripSession(text)) return false;
  try {
    const { isSupermarketOfferQuery } = require('../research/supermarketProspectGates') as {
      isSupermarketOfferQuery: (s: string) => boolean;
    };
    if (isSupermarketOfferQuery(text)) return true;
  } catch {
    /* soft */
  }
  const fam = classifyUtteranceFamily(text).family;
  if (fam === 'flight' || fam === 'clock' || fam === 'knowledge' || fam === 'unknown') {
    return false;
  }
  return (
    fam === 'nav' ||
    fam === 'pitch' ||
    fam === 'm1' ||
    fam === 'weather' ||
    fam === 'plan' ||
    fam === 'travel_agency'
  );
}

export function luggageFromLastAskReply(
  text: string,
  pendingAsk: string | null | undefined,
): 'carry' | 'checked' | null {
  if (pendingAsk !== 'luggage') return null;
  const t = text.replace(/\s+/g, ' ').trim();
  if (CHECKED_BAG_RE.test(t)) return 'checked';
  if (CARRY_BAG_RE.test(t)) return 'carry';
  if (/^(nein|nee|nö|nope|no)[.!?]*$/iu.test(t)) return 'carry';
  if (
    /^(ja|jo|jap|jup|genau|klar|stimmt|okay|ok|passt|yes|yeah)(?:\s+(bitte|genau|klar))?[.!?]*$/iu.test(
      t,
    )
  ) {
    return 'checked';
  }
  return null;
}

/** Follow-up ohne „fliegen“-Verb, solange eine Trip-Session lebt. */
export function isFlightTripFollowUp(text: string, hasSession: boolean): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return false;
  try {
    const { stickyFlightAllowedForUtterance } = require('../../module2/kernel/utteranceFamily') as {
      stickyFlightAllowedForUtterance: (s: string) => boolean;
    };
    if (!stickyFlightAllowedForUtterance(t)) return false;
  } catch {
    /* soft */
  }
  const slots = parseFlightTripSlots(t);
  if (slots.isFlightTrip || slots.flightCode) return true;
  if (!hasSession) return false;
  return Boolean(
    slots.clockHm ||
      slots.destHint ||
      slots.luggage !== 'unknown' ||
      slots.dateHint ||
      slots.monthIndex ||
      slots.dateFlex ||
      FOLLOW_RE.test(text) ||
      isFlightBufferFollowUp(text) ||
      isFlightIdentAsk(text) ||
      isFlightPlanAck(text) ||
      isFlightThanks(text) ||
      isAirportRideFollowUp(text),
  );
}

/** Manager-Lane darf den Flug-Advisor nicht schlucken (Plan = Timetable des Flugs). */
export function shouldEnterFlightAdvisor(opts: {
  userText: string;
  chatLane?: string | null;
  session?: string | null;
  jobHint?: string | null;
  intentSummary?: string | null;
  hasOpenSession?: boolean;
  flightWorker?: boolean;
}): boolean {
  const t = (opts.userText || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  // Wochenend-/Urlaubs-Reise mit Flug+Hotel/Programm = Reisebüro, nicht Solo-Flug-Advisor
  try {
    const { detectCall1Situation } = require('../../module2/reboot/pipeline/call1AnswerContract') as {
      detectCall1Situation: (s: string) => string;
    };
    if (detectCall1Situation(t) === 'reisebuero_collect') return false;
  } catch {
    /* soft */
  }
  if (isFlightTripQuery(t)) return true;
  if (opts.hasOpenSession && extractClockHm(t)) return true;
  const fam = classifyUtteranceFamily(t).family;
  const steal =
    opts.chatLane === 'nav' || opts.chatLane === 'pitch' || opts.chatLane === 'm1';
  const flightNow = fam === 'flight' || isFlightTripQuery(t);
  if (steal && !flightNow) return false;
  if (fam === 'weather' || fam === 'pitch' || fam === 'm1' || fam === 'travel_agency') {
    return false;
  }
  if (fam === 'nav' && !flightNow) return false;
  if (flightNow) return true;
  if (opts.flightWorker) return true;
  const managerSaysFlight =
    /\b(flug|fliegen|flieger|fliege|flight_trip|airport|flughafen|abflug)\b/iu.test(
      `${opts.jobHint || ''} ${opts.intentSummary || ''}`,
    );
  if (
    (opts.session === 'continue' || opts.session === 'resume') &&
    managerSaysFlight
  ) {
    return true;
  }
  if (opts.hasOpenSession && isFlightTripFollowUp(t, true)) return true;
  if (opts.hasOpenSession && isShortReplyToLastAsk(t)) {
    try {
      const { getFlightTripSession } = require('./flightTripSession') as {
        getFlightTripSession: () => { pendingAsk?: string | null } | null;
      };
      if (getFlightTripSession()?.pendingAsk) return true;
    } catch {
      /* soft */
    }
  }
  return false;
}

/** Offener Stadt-Plan darf einen neuen Flug / die letzte Flugfrage nicht schlucken. */
export function shouldYieldPlanWaitToFlight(opts: {
  userText: string;
  hasOpenSession?: boolean;
  pendingAsk?: string | null;
}): boolean {
  const t = (opts.userText || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (isFlightTripQuery(t)) return true;
  if (opts.hasOpenSession && extractClockHm(t)) return true;
  const fam = classifyUtteranceFamily(t).family;
  if (fam === 'weather' || fam === 'pitch' || fam === 'm1' || fam === 'travel_agency') {
    return false;
  }
  if (fam === 'nav' && !(isFlightTripQuery(t) || fam === 'flight')) {
    return false;
  }
  if (isFlightTripQuery(t) || fam === 'flight') {
    return true;
  }
  if (opts.hasOpenSession && isFlightTripFollowUp(t, true)) return true;
  return Boolean(
    opts.hasOpenSession && opts.pendingAsk && isShortReplyToLastAsk(t),
  );
}
