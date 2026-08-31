/**
 * Strict Intent Separation (V7): POI_INFO vs START_NAV.
 * Known POI entity names NEVER auto-start navigation — verbs/question words decide.
 */

/** Informational questions about a place — MUST NOT start navigation. */
const POI_INFO_RE =
  /\b(?:wann|wie\s+viel|wieviel|wie\s+spät|wie\s+spaet|gibt\s+es|hat\s+(?:das|der|die|man|ihr|sein)|haben\s+(?:die|sie|ihr)|öffnungszeit|oeffnungszeit|geöffnet|geoeffnet|geschlossen|frühstück(?:szeit|sbuffet|szeiten)?|fruehstueck(?:szeit|sbuffet)?|breakfast|brunch(?:zeit)?|check[-\s]?in|check[-\s]?out|preis|kosten|uhrzeit|ab\s+wann|bis\s+wann|um\s+wieviel|um\s+wie\s+viel|was\s+kostet|welche\s+zeiten|servier|buffet|wifi|wlan|parkplatz\s+(?:kosten|preis)|hund(?:e)?\s+erlaubt|haustier|spielzeit(?:en)?|vorstellung(?:en)?|kinoprogramm|showtimes?|welcher\s+film|was\s+läuft|was\s+laeuft|(?:film|kino).{0,20}(?:läuft|laeuft|spielt)|(?:läuft|laeuft|spielt).{0,20}(?:film|kino)|was\s+ist\s+das|was\s+soll\s+das\s+(?:sein|darstellen)|was\s+stellt\s+das\s+dar|was\s+stell(?:t|en)\s+das\s+dar|was\s+für\s+ein\s+ding|was\s+sehe\s+ich\s+(?:da|hier)|erzähl\s+(?:mir\s+)?(?:mehr|etwas|was)|wieso\s+steht\s+das|warum\s+(?:steht|ist)\s+das)\b/iu;

/** Deiktische „was ist das vor mir?“ — nearest-POI statt Namenssuche. */
const DEICTIC_POI_RE =
  /\b(?:was\s+ist\s+das|was\s+soll\s+das\s+(?:sein|darstellen)|was\s+stellt\s+das\s+dar|was\s+für\s+ein\s+(?:ding|gebäude|denkmal)|hier\s+vor\s+(?:mir|uns)|direkt\s+vor\s+(?:mir|uns)|das\s+ding\s+(?:da|hier)|vor\s+so\s+einem\s+ding)\b/iu;

export function isDeicticPoiQuestion(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!DEICTIC_POI_RE.test(t)) return false;
  // „Was ist das DRK / Marinedenkmal …?“ = benannter Ort, keine reine Deiktik
  if (
    /\bwas\s+ist\s+das\s+(?!hier\b|da\b|dort\b|vor\b|für\b|fuer\b)([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß.\-]{1,})/iu.test(
      t,
    )
  ) {
    return false;
  }
  return true;
}

/** Explicit movement / go-to verbs — ONLY these may start START_NAV. */
const EXPLICIT_NAV_RE =
  /\b(?:bring\s+mich|nimm\s+mich|nehm\s+mich|führ\s+mich|fuehr\s+mich|fahr\s+mich|lauf\s+(?:mich|uns)|navigier(?:e|en|t)?(?:\s+(?:mich|werden))?|navi(?:gation)?\s+(?:zu|nach|zum|zur)|navigation\s+(?:zu|nach|zum|zur)|wie\s+komm(?:e|en)?\s+ich|lass\s+(?:uns|mich)\s+(?:zum|zur|nach|zu)|geh(?:en)?\s+(?:wir|ich)\s+(?:zum|zur|nach|zu|hin)|zeig\s+mir\s+(?:den\s+weg|die\s+route)|route\s+(?:zu|nach|zum|zur|starten)|kompass\s+(?:zu|nach|an)|ich\s+(?:will|möchte|moechte|muss)\s+(?:jetzt\s+)?(?:zum|zur|nach|zu|ins|hin)|(?:führ|fuehr|bring|fahr|navigier|nimm|nehm)\w*\s+(?:mich\s+)?(?:dahin|dorthin|hin))\b/iu;

/** Soft discovery / meal ROUTES — not pure info questions. */
const MEAL_ROUTE_RE =
  /\b(?:frühstücks?route|fruehstuecks?route|essensroute|restaurant\s+route|wo\s+(?:kann|gibt)\s+(?:ich|es)\s+(?:frühstück|essen)|was\s+(?:kann|soll)\s+(?:ich|wir)\s+essen|zeig\s+mir\s+(?:frühstück|essen|cafés?|restaurants?)|ich\s+(?:will|möchte|moechte|brauch(?:e)?)\s+(?:frühstück|essen|brunch)|hunger|wo\s+frühstücken|wo\s+fruehstuecken)\b/iu;

/** User correcting a wrong nav start — abort + answer the real question. */
const NAV_CORRECTION_RE =
  /\b(?:nein[,.]?\s*(?:ich\s+meinte|ich\s+wollte|falsch|nicht\s+(?:navigier|fahren|gehen|dahin|zum|zur))|falsch[,.]?\s*(?:ich\s+meinte)?|stopp?[,.]?\s*(?:ich\s+meinte|frage)|nicht\s+navigier|nicht\s+die\s+route|ich\s+(?:meinte|wollte)\s+(?:fragen|wissen|nur)|das\s+war\s+(?:eine\s+)?frage|das\s+war\s+gar\s+nicht|nicht\s+mein\s+(?:wille|plan|wunsch)|ich\s+wollte\s+(?:eigentlich\s+)?wissen|rückgängig|rueckgaengig)\b/iu;

export type PoiUserIntent = 'POI_INFO' | 'START_NAV' | 'MEAL_ROUTE' | 'OTHER';

export function isPoiInfoQuestion(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return false;
  // Explicit nav verbs win over info words when both present
  // ("Bring mich zum Hotel — wann ist Frühstück?" is rare; prefer nav)
  if (EXPLICIT_NAV_RE.test(t) && !NAV_CORRECTION_RE.test(t)) return false;
  return POI_INFO_RE.test(t);
}

export function isExplicitNavIntent(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (isPoiInfoQuestion(t)) return false;
  try {
    const gate = require('../../module2/planning/planUtteranceGate') as {
      looksLikeChaoticDayPlanUtterance: (s: string) => boolean;
      looksLikeModul5PlanUtterance: (s: string) => boolean;
    };
    if (
      gate.looksLikeChaoticDayPlanUtterance(t) ||
      gate.looksLikeModul5PlanUtterance(t)
    ) {
      return false;
    }
  } catch {
    /* soft */
  }
  return EXPLICIT_NAV_RE.test(t);
}

export function isMealRouteIntent(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t || isPoiInfoQuestion(t)) return false;
  return MEAL_ROUTE_RE.test(t);
}

export function isNavCorrectionIntent(text: string): boolean {
  return NAV_CORRECTION_RE.test(text.replace(/\s+/g, ' ').trim());
}

/**
 * After "Nein, ich meinte wann das Frühstück ist" → extract the real question.
 */
export function extractCorrectedQuestion(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  const m = t.match(
    /(?:nein[,.]?\s*)?(?:ich\s+meinte|ich\s+wollte|falsch[,.]?\s*)[,:]?\s*(.+)$/iu,
  );
  if (m?.[1]) {
    const q = m[1].replace(/^(fragen|wissen|nur)\s+/iu, '').trim();
    if (q.length >= 4) return q;
  }
  // "Stopp — wann ist Frühstück?"
  const m2 = t.match(
    /(?:stopp?|falsch|nicht\s+navigier)[,.\s]+(.+)$/iu,
  );
  const afterStop = m2?.[1]?.trim();
  if (afterStop && afterStop.length >= 4) return afterStop;
  return t;
}

/** Classify for routers that need a single label. */
export function classifyPoiUserIntent(text: string): PoiUserIntent {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return 'OTHER';
  if (isNavCorrectionIntent(t)) {
    const inner = extractCorrectedQuestion(t);
    if (isPoiInfoQuestion(inner)) return 'POI_INFO';
  }
  if (isPoiInfoQuestion(t)) return 'POI_INFO';
  if (isExplicitNavIntent(t)) return 'START_NAV';
  if (isMealRouteIntent(t)) return 'MEAL_ROUTE';
  return 'OTHER';
}

/** Block auto-nav when utterance is clearly a fact question. */
export function shouldBlockAutoNavigation(text: string): boolean {
  return classifyPoiUserIntent(text) === 'POI_INFO';
}
