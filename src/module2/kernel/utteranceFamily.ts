/**
 * Äußerungs-Familie — Schritt 1, ohne Session/Thread.
 * Kernel-Takt: erst DIESE Frage, dann Kontext. Kein zweites Gehirn.
 */

export type UtteranceFamily =
  | 'flight'
  | 'nav'
  | 'plan'
  | 'pitch'
  | 'm1'
  | 'weather'
  | 'clock'
  | 'travel_agency'
  | 'knowledge'
  | 'unknown';

export type UtteranceFamilyHit = {
  family: UtteranceFamily;
  /** 0–1, nur Weiche — kein Inhalt. */
  confidence: number;
};

const FLIGHT_RE =
  /\b(flugnummer|flüge|fluege|flug|flieger|fliegen|flieg(?:e|st|t)?|abflug|boarding|flughafen|airport|gate|check[\s-]?in|billigflug)\b/iu;

const FLIGHT_IDENT_RE =
  /\b(?:LH|LX|OS|BA|AF|KL|EW|U2|FR|W6|SK|AY|IB|TP|AZ|SN|DE|XQ|PC|TK|XC|FH|VF|A3)\s?\d{1,4}[A-Z]?\b/i;

const NAV_RE =
  /\b(?:bring\s+mich|führ\s+mich|fuehr\s+mich|fahr\s+mich|navigier(?:e|en|t)?(?:\s+(?:mich|werden))?|navi(?:gation)?\s+(?:zu|nach|zum|zur)|route\s+(?:zu|nach|zum|zur|starten)|ich\s+(?:will|möchte|moechte|muss)\s+(?:jetzt\s+)?(?:zum|zur|nach|zu))\b/iu;

const STREET_RE =
  /\b[\wÄÖÜäöüß.\-]*(?:straße|strasse|str\.?|weg|allee|platz|gasse|ring|damm)\s+\d{1,4}[a-zA-Z]?\b/iu;

const CLOCK_RE =
  /\b(wecker|weck\s+mich|wecke\s+mich|timer|stell(?:e)?\s+(?:mir\s+)?(?:einen\s+)?wecker)\b/iu;

const WHERE_AM_I_RE =
  /\b(wo\s+bin\s+ich|wo\s+stehe\s+ich|was\s+ist\s+(?:das|hier)|hier\s+(?:für\s+ein\s+ort|für\s+einen\s+ort))\b/iu;

const M1_RE =
  /\b(mehr\s+(?:historie|dazu)|erzähl.{0,24}(?:geschichte|historie)|stufen|treppen|kirche|turm|denkmal)\b/iu;

const PITCH_RE =
  /\b(spaghetti[-\s]?eis|eis\s+(?:essen|wäre|waere)|gelato|restaurant|essen|hunger|hotel|übernacht|uebernacht|unterkunft|friseur|frisör|frisoer|café|cafe|pizza|imbiss|picknick|picnic|grillen|grillplatz)\b/iu;

const CINEMA_RE =
  /\b(kino|kinoprogramm|welche\s+filme|ins\s+kino|filmtheater)\b/iu;

const WEATHER_RE =
  /\b(wetter|regnen|regnet|regen|regnerisch|schneit|schneien|schnee|temperatur|wie\s+kalt|wie\s+warm|anziehen|outfit)\b/iu;

const TRAVEL_AGENCY_RE =
  /\b(reiseb[uü]ro|irgendwohin|irgendwo.{0,40}(?:warm|hin|weg|fliegen|urlaub)|wo(?:hin)?\s+(?:es\s+)?warm|nächste\s+woche.{0,40}(?:weg|urlaub|fliegen)|weiß\s+nicht\s+wohin|weiss\s+nicht\s+wohin)\b/iu;

const PLAN_VERB_RE =
  /\b(einplanen|eintragen|tagesplan|timeline|kalender|durchplanen|organisiere|mach\s+mir\s+(?:einen\s+)?plan|plane\s+mir|planen|wochenend(?:e|urlaub)|urlaub\s+(?:nach|in)|städtetrip|staedtetrip|kurztrip)\b/iu;

const KNOWLEDGE_RE =
  /\b(wer\s+(?:war|ist)|wann\s+(?:ist|war|starb|gestorben)|wie\s+(?:viele|viel|alt|hoch|breit)|was\s+bedeutet|wurde\s+er|gibt\s+es\s+(?:bilder|fotos))\b/iu;

const CLOCK_HINT_RE =
  /\b(?:um|gegen)\s+\d{1,2}(?:[:.]\d{2})?\s*(?:uhr)?\b|\b\d{1,2}[:.]\d{2}\b/iu;

const BE_THERE_RE =
  /\b(?:sein|ankommen|da\s+sein|pünktlich|puenktlich|einplanen|eintragen|termin)\b/iu;

const PLACE_PREP_RE =
  /\b(?:an\s+der|am\s+|im\s+|in\s+der|beim|bei\s+der|zur|zum|in\s+[A-ZÄÖÜ])/u;

export function looksLikeArriveByAppointment(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (FLIGHT_RE.test(t)) return false;
  if (!CLOCK_HINT_RE.test(t)) return false;
  if (!BE_THERE_RE.test(t)) return false;
  return PLACE_PREP_RE.test(t) || PLAN_VERB_RE.test(t);
}

export function classifyUtteranceFamily(text: string): UtteranceFamilyHit {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return { family: 'unknown', confidence: 0 };

  if (CLOCK_RE.test(t) && !looksLikeArriveByAppointment(t) && !FLIGHT_RE.test(t)) {
    return { family: 'clock', confidence: 0.92 };
  }
  if (FLIGHT_RE.test(t) || FLIGHT_IDENT_RE.test(t)) {
    return { family: 'flight', confidence: 0.94 };
  }
  if (NAV_RE.test(t) || STREET_RE.test(t)) {
    return { family: 'nav', confidence: 0.93 };
  }
  if (
    TRAVEL_AGENCY_RE.test(t) &&
    !FLIGHT_IDENT_RE.test(t) &&
    !/\b(?:nach\s+[A-ZÄÖÜ]|flughafen\s+[A-ZÄÖÜ])/u.test(t)
  ) {
    return { family: 'travel_agency', confidence: 0.88 };
  }
  if (WHERE_AM_I_RE.test(t) || (M1_RE.test(t) && !PITCH_RE.test(t) && !CINEMA_RE.test(t))) {
    return { family: 'm1', confidence: 0.84 };
  }
  // Wetter vor Plan — sonst „regnet? + Städtetrip“ → Sticky Tennis/Plan statt Wetter.
  if (WEATHER_RE.test(t) && !PITCH_RE.test(t)) {
    return { family: 'weather', confidence: 0.88 };
  }
  if (looksLikeArriveByAppointment(t) || PLAN_VERB_RE.test(t) || /\b(\w+\s+erkunden|wie\s+könnte\s+mein\s+tag)\b/iu.test(t)) {
    return { family: 'plan', confidence: 0.93 };
  }
  // Supermarkt-Prospekt / Produktangebot — vor Pitch (Bier ≠ Gastro).
  try {
    const { isSupermarketOfferQuery } = require('../../services/research/supermarketProspectGates') as {
      isSupermarketOfferQuery: (s: string) => boolean;
    };
    if (isSupermarketOfferQuery(t)) {
      return { family: 'knowledge', confidence: 0.9 };
    }
  } catch {
    /* soft */
  }
  if (CINEMA_RE.test(t) || PITCH_RE.test(t)) {
    return { family: 'pitch', confidence: 0.9 };
  }
  if (KNOWLEDGE_RE.test(t)) {
    return { family: 'knowledge', confidence: 0.8 };
  }
  // Nackte Uhrzeit („um 20 Uhr“) — Follow-up, kein Knowledge-Weave.
  if (
    CLOCK_HINT_RE.test(t) &&
    t.length <= 40 &&
    !FLIGHT_RE.test(t) &&
    !NAV_RE.test(t) &&
    !PITCH_RE.test(t) &&
    !WEATHER_RE.test(t) &&
    !PLAN_VERB_RE.test(t)
  ) {
    return { family: 'clock', confidence: 0.72 };
  }
  return { family: 'unknown', confidence: 0.35 };
}

export function familiesCanWeave(
  openFamily: UtteranceFamily,
  nextFamily: UtteranceFamily,
): boolean {
  if (openFamily === nextFamily) return true;
  if (nextFamily === 'unknown') return true;
  // Trivia/Knowledge webt nicht mit Flug/Plan/Nav — sonst Papst im Flieger.
  if (openFamily === 'knowledge' || nextFamily === 'knowledge') return false;
  if (
    (openFamily === 'nav' || openFamily === 'm1' || openFamily === 'plan') &&
    nextFamily === 'pitch'
  ) {
    return true;
  }
  if (openFamily === 'flight' && nextFamily === 'clock') return true;
  if (openFamily === 'pitch' && nextFamily === 'clock') return true;
  if (openFamily === 'plan' && (nextFamily === 'nav' || nextFamily === 'clock')) {
    return true;
  }
  if (openFamily === 'pitch' && nextFamily === 'plan') return true;
  return false;
}

/** Exklusive Familien — toter Thread, kein Weave. */
export function exclusiveFamilyCut(
  openFamily: UtteranceFamily,
  nextFamily: UtteranceFamily,
): boolean {
  if (openFamily === 'unknown' || nextFamily === 'unknown') {
    return false;
  }
  if (openFamily === nextFamily) return false;
  // Offenes Trivia → neuer Flug/Uhr/Plan: Schnitt, kein Papst-Weiterweben.
  if (openFamily === 'knowledge' && nextFamily !== 'knowledge') {
    return true;
  }
  if (familiesCanWeave(openFamily, nextFamily)) return false;
  return true;
}

export function chatLaneForFamily(
  family: UtteranceFamily,
): 'chat' | 'nav' | 'm1' | 'plan' | 'pitch' {
  switch (family) {
    case 'nav':
      return 'nav';
    case 'm1':
      return 'm1';
    case 'plan':
      return 'plan';
    case 'pitch':
      return 'pitch';
    default:
      return 'chat';
  }
}

/**
 * Sticky-Flug nur wenn DIESE Äußerung Flug ist oder unklar (Uhr/Ident).
 * Plan/Nav/Pitch/M1/Wetter dürfen einen offenen Flieger nicht fortsetzen.
 */
export function stickyFlightAllowedForUtterance(text: string): boolean {
  const fam = classifyUtteranceFamily(text).family;
  if (fam === 'flight' || fam === 'unknown' || fam === 'clock') return true;
  const t = (text || '').replace(/\s+/g, ' ');
  // Timetable / Leave-by gehört zum offenen Flug, auch wenn der Manager „plan“ sagt.
  if (
    fam === 'plan' &&
    /\b(timetable|timeline|flughafen|abflug|durchrechn|eintragen|gepäck|gepaeck|handgepäck|aufbrechen|leave.?by)\b/iu.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}
