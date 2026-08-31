/**
 * Turn-Kernel SSOT — Topic-Cut, Isolation, Split, Bridge-Pace, Speech-Weave.
 * Kein RN/Expo: Node-Smoke + CI-Gate.
 *
 * Isolation = toter Thread raus. Aktueller Auftrag (Amsterdam, Wien-Flug JETZT)
 * darf in der Bridge stehen.
 */

import {
  chatLaneForFamily,
  classifyUtteranceFamily,
  exclusiveFamilyCut,
  familiesCanWeave,
  looksLikeArriveByAppointment,
} from './utteranceFamily';

export type TopicCutMode = 'new' | 'continue' | 'weave' | 'closed_new';

export type TurnIntentLite = {
  id: string;
  lane: 'chat' | 'nav' | 'm1' | 'plan' | 'pitch';
  brief: string;
  dependsOn: string | null;
};

const WHERE_AM_I_RE =
  /\b(wo\s+bin\s+ich|wo\s+stehe\s+ich|was\s+ist\s+(?:das|hier)|hier\s+(?:für\s+ein\s+ort|für\s+einen\s+ort)|was\s+ist\s+das\s+hier)\b/iu;

const EXPLICIT_NAV_RE =
  /\b(?:bring\s+mich|führ\s+mich|fuehr\s+mich|fahr\s+mich|navigier(?:e|en|t)?(?:\s+(?:mich|werden))?|navi(?:gation)?\s+(?:zu|nach|zum|zur)|route\s+(?:zu|nach|zum|zur|starten)|ich\s+(?:will|möchte|moechte|muss)\s+(?:jetzt\s+)?(?:zum|zur|nach|zu))\b/iu;

const STREET_ADDR_RE =
  /\b[\wÄÖÜäöüß.\-]*(?:straße|strasse|str\.?|weg|allee|platz|gasse|ring|damm|hof|hoop|berg)\s+\d{1,4}[a-zA-Z]?\b/iu;

const CLOCK_RE =
  /\b(wecker|weck\s+mich|wecke\s+mich|timer|stell(?:e)?\s+(?:mir\s+)?(?:einen\s+)?wecker|um\s+\d{1,2}(?:[:.]\d{2})?\s+uhr.{0,24}wecker)\b/iu;

const TAXI_RE = /\b(taxi|uber|bolt|freenow)\b/iu;

const SLOW_RESEARCH_RE =
  /\b(flug|flüge|fluege|kino|filme|hotel|übernacht|uebernacht|kinoprogramm|günstigste\s+flüge|guenstigste\s+fluege|stay22|spielzeit|heimspiel|basketball|handball|towers|spielplan|spiel(?:en|t)|ticket(?:s)?|eis|gelato|spaghetti|restaurant|italiener|eisdiele|gelateria)\b/iu;

const FOLLOW_UP_RE =
  /\b(wie\s+(?:viele|viel|weit|lange|teuer|alt)|warum|wieso|weshalb|mehr\s+(?:dazu|historie)|erzähl|erzaehl|und\s+das\s+popcorn|stufen|treppen)\b/iu;

const ANAPHORA_RE =
  /\b(der|die|das|dort|da|davon|dazu|dahin|der\s+turm|die\s+kirche|dieser|dieses)\b/iu;

const LIST_LEAD_RE =
  /^(?:\s*)(?:info\s*\d|erstens|zweitens|drittens|punkt\s*\d|1\)|1\.)/iu;

const SPLIT_RE =
  /\b(?:und\s+dann|danach|außerdem|ausserdem|zusätzlich|zusaetzlich|sowie|und\s+auch|,?\s+und\s+)\b/giu;

export function looksLikeWhereAmIQuery(text: string): boolean {
  return WHERE_AM_I_RE.test((text || '').replace(/\s+/g, ' ').trim());
}

export function looksLikeExplicitNavOrAddress(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (EXPLICIT_NAV_RE.test(t)) return true;
  // Straße+Hausnummer ist ein neues Ziel — auch ohne „navigier/zum“.
  if (STREET_ADDR_RE.test(t)) return true;
  try {
    const { looksLikeSpokenCityCorrection } = require('../../services/navigation/navDestCityCorrection') as {
      looksLikeSpokenCityCorrection: (s: string) => boolean;
    };
    if (looksLikeSpokenCityCorrection(t)) return true;
  } catch {
    /* soft */
  }
  return false;
}

/** Offenes Ziel (Nav/Plan läuft noch) — nicht dasselbe wie eine beantwortete Frage. */
export function looksLikeOpenDestinationCommit(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (looksLikeExplicitNavOrAddress(t)) return true;
  return /\b(?:gehen\s+wir|lass\s+(?:uns\s+)?(?:gehen|fahren|laufen)|auf\s+zum|wir\s+gehen)\s+(?:zum|zur|nach|zu)\b/iu.test(
    t,
  );
}

/** Aktueller Satz ist Flug/Bahn-Auftrag — darf in der Bridge stehen. */
export function looksLikeCurrentFlightUtterance(text: string): boolean {
  return classifyUtteranceFamily(text).family === 'flight';
}

export function looksLikeClockIntentLite(text: string): boolean {
  return CLOCK_RE.test((text || '').replace(/\s+/g, ' ').trim());
}

export function looksLikeSlowResearch(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (looksLikeExplicitNavOrAddress(t) || looksLikeClockIntentLite(t)) return false;
  if (looksLikeWhereAmIQuery(t) && !SLOW_RESEARCH_RE.test(t)) return false;
  return SLOW_RESEARCH_RE.test(t);
}

/**
 * Genanntes Trivia-Subjekt („Wie alt ist … Name?“ / „Wer war …?“) —
 * neuer Knowledge-Thread, kein POI-/Sport-Follow-up.
 */
export function looksLikeNamedTriviaSubject(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  // Eigenname / Titel nach ist/war/sind (auch „der Papst“, „Manuel Neuer“).
  if (
    /\b(?:wie\s+(?:alt|groß|gross|hoch|breit)|wer|wann)\b/iu.test(t) &&
    /\b(?:ist|war|sind)\s+(?:(?:der|die|das)\s+)?[A-ZÄÖÜ][\wÄÖÜäöüß\-]/u.test(t)
  ) {
    return true;
  }
  try {
    const { isQuickLookupQuery } = require('../../services/concierge/celestialSkyQuery') as {
      isQuickLookupQuery: (s: string) => boolean;
    };
    if (
      isQuickLookupQuery(t) &&
      /\b(?:ist|war|sind)\s+(?:(?:der|die|das)\s+)?[A-ZÄÖÜ]/u.test(t)
    ) {
      return true;
    }
  } catch {
    /* soft */
  }
  return false;
}

export function looksLikeFollowUpLite(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (looksLikeExplicitNavOrAddress(t) || looksLikeWhereAmIQuery(t)) return false;
  // „Wie alt ist Manuel Neuer?“ ≠ Follow-up an Towers/Pitch.
  if (looksLikeNamedTriviaSubject(t)) return false;
  try {
    const { classifyUtteranceFamily } = require('./utteranceFamily') as {
      classifyUtteranceFamily: (s: string) => { family: string };
    };
    const fam = classifyUtteranceFamily(t).family;
    // „Wie wird das Wetter?“ enthält „das“ — kein Anaphora-Follow-up an Flug.
    if (fam === 'weather') return false;
    if (fam === 'knowledge' && looksLikeNamedTriviaSubject(t)) {
      return false;
    }
  } catch {
    /* soft */
  }
  return FOLLOW_UP_RE.test(t) || (t.length <= 48 && ANAPHORA_RE.test(t));
}

function laneForClause(clause: string): TurnIntentLite['lane'] {
  const fam = classifyUtteranceFamily(clause).family;
  if (fam !== 'unknown' && fam !== 'knowledge' && fam !== 'clock') {
    return chatLaneForFamily(fam);
  }
  const t = clause.toLowerCase();
  if (EXPLICIT_NAV_RE.test(t) || STREET_ADDR_RE.test(t)) return 'nav';
  if (WHERE_AM_I_RE.test(t) || /\b(stufen|turm|kirche|historie|was\s+ist\s+das)\b/.test(t)) {
    return 'm1';
  }
  if (/\b(hotel|übernacht|uebernacht|unterkunft|friseur|frisör|frisoer|restaurant|essen|hunger|café|cafe|kino|film|eis|picknick|picnic|grillen|grillplatz)\b/.test(t)) {
    return 'pitch';
  }
  if (/\b(tagesplan|planen|timeline|vormittag|nachmittag|abendplan|kalender|einplanen)\b/.test(t)) {
    return 'plan';
  }
  return 'chat';
}

/** Teilaufträge in EINEM Satz — max 8. */
export function splitTurnIntents(userText: string): TurnIntentLite[] {
  const t = (userText || '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  SPLIT_RE.lastIndex = 0;
  const hasSplit = SPLIT_RE.test(t);
  SPLIT_RE.lastIndex = 0;

  if (!hasSplit) {
    return [
      {
        id: 'i1',
        lane: laneForClause(t),
        brief: t.slice(0, 120),
        dependsOn: null,
      },
    ];
  }

  const parts = t
    .split(SPLIT_RE)
    .map((p) => p.replace(/^[\s,.;:!?]+|[\s,.;:!?]+$/g, '').trim())
    .filter((p) => p.length >= 6);

  if (parts.length < 2) {
    return [
      {
        id: 'i1',
        lane: laneForClause(t),
        brief: t.slice(0, 120),
        dependsOn: null,
      },
    ];
  }

  const seen = new Set<string>();
  const out: TurnIntentLite[] = [];
  for (let i = 0; i < parts.length && out.length < 8; i++) {
    const brief = parts[i]!.slice(0, 120);
    const key = brief.toLowerCase().slice(0, 40);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: `i${out.length + 1}`,
      lane: laneForClause(brief),
      brief,
      dependsOn: out.length > 0 ? `i${out.length}` : null,
    });
  }
  return out.length ? out : [{ id: 'i1', lane: laneForClause(t), brief: t.slice(0, 120), dependsOn: null }];
}

export function hasMultipleIntents(userText: string): boolean {
  return splitTurnIntents(userText).length > 1;
}

/**
 * Early-Just-Do-It darf den Turn nur fressen, wenn es EIN Auftrag ist.
 * Wecker+Spot / Wetter+Plan weiterreichen.
 */
export function shouldAbortTurnForEarlyJustDoIt(userText: string): boolean {
  if (hasMultipleIntents(userText)) return false;
  return true;
}

export type TopicCutInput = {
  userText: string;
  /** Offener Auftrag (Nav zur Kirche läuft, Plan unerledigt). */
  openLoop?: string | null;
  /** Letztes abgeschlossenes Thema (Stufen-Frage beantwortet). */
  lastClosedTopic?: string | null;
  /** Vordergrund-Thread-Label (z. B. „Flug Wien“). */
  foregroundLabel?: string | null;
};

/**
 * neu | continue | weave (offener Auftrag + neuer Wunsch) | closed_new (altes Thema durch).
 */
export function decideTopicCut(input: TopicCutInput): TopicCutMode {
  const t = (input.userText || '').replace(/\s+/g, ' ').trim();
  if (!t) return 'new';

  if (looksLikeExplicitNavOrAddress(t) || looksLikeWhereAmIQuery(t)) {
    return 'new';
  }
  if (TAXI_RE.test(t) && /\b(zum|zur|nach|rufen|bestellen)\b/iu.test(t)) {
    return 'new';
  }

  const open = (input.openLoop || '').trim();
  const closed = (input.lastClosedTopic || '').trim();
  const fgLabel = (input.foregroundLabel || '').trim();

  // Toter Taxi-Thread: Essenswunsch ist ein neuer Auftrag, kein Weave.
  if (
    (TAXI_RE.test(open) || TAXI_RE.test(fgLabel)) &&
    !TAXI_RE.test(t) &&
    /\b(essen|restaurant|hunger|fisch|steak|pizza|sushi|pann|pfann|gastro|speisekarte)\b/iu.test(
      t,
    )
  ) {
    return 'new';
  }
  // Anderes Gericht als offener Pitch → tot, kein „kein Steak, sondern …“.
  // Ablehnung / „was noch“ am offenen Pitch ist Continue, kein Cut.
  if (open && foodDishShift(open, t) && !looksLikePitchRejectOrMore(t)) {
    return 'new';
  }
  const nextFam = classifyUtteranceFamily(t).family;

  // Trivia/Faktenfrage: immer Schnitt — nie Gurkenzeit/Pitch in Papst-Antwort weben.
  // Follow-up nur wenn der offene Faden selbst Knowledge ist („und wann geboren?“).
  // Nicht bei M1-POI-Fakten („wie viele Stufen“) — das bleibt Follow-up am Ort.
  if (nextFam === 'knowledge') {
    const openFam = open ? classifyUtteranceFamily(open).family : null;
    const fgFam = fgLabel ? classifyUtteranceFamily(fgLabel).family : null;
    const sameKnowledgeThread =
      looksLikeFollowUpLite(t) &&
      (openFam === 'knowledge' || fgFam === 'knowledge');
    if (!sameKnowledgeThread) return 'new';
  }

  // Offener Flug-Trip: Uhr/Slots weiterführen — kein Weave mit totem Trivia.
  try {
    const { hasFlightTripSession } = require('../../services/flights/flightTripSession') as {
      hasFlightTripSession: () => boolean;
    };
    const {
      isFlightTripFollowUp,
      extractClockHm,
      isFlightTripQuery,
    } = require('../../services/flights/flightTripIntent') as {
      isFlightTripFollowUp: (s: string, has: boolean) => boolean;
      extractClockHm: (s: string) => string | null;
      isFlightTripQuery: (s: string) => boolean;
    };
    if (hasFlightTripSession()) {
      if (
        !isFlightTripQuery(t) &&
        (isFlightTripFollowUp(t, true) || extractClockHm(t) || nextFam === 'clock')
      ) {
        return 'continue';
      }
    }
  } catch {
    /* soft */
  }

  // Offener Pitch/Hotel-Live-Auftrag: Ablehnung / mehr Optionen / Uhr → continue.
  try {
    const { isInventoryFollowUp, resolveLiveInventoryUserText } = require('../router/liveInventoryGate') as {
      isInventoryFollowUp: (s: string) => boolean;
      resolveLiveInventoryUserText: (s: string) => { inherited: boolean; kind: string | null };
    };
    const inv = resolveLiveInventoryUserText(t);
    if (
      inv.inherited ||
      (isInventoryFollowUp(t) &&
        (classifyUtteranceFamily(open).family === 'pitch' ||
          classifyUtteranceFamily(fgLabel).family === 'pitch'))
    ) {
      return 'continue';
    }
  } catch {
    /* soft */
  }

  if (open) {
    const openFam = classifyUtteranceFamily(open).family;
    if (exclusiveFamilyCut(openFam, nextFam)) {
      return 'new';
    }
    // Flug nach Gastro/Wetter/Plan: immer Schnitt — auch wenn OpenLoop „unknown“ ist
    // (sonst → Weave und Bridge bleibt beim Mittagessen).
    if (
      nextFam === 'flight' &&
      openFam !== 'flight' &&
      openFam !== 'clock'
    ) {
      return 'new';
    }
  }
  if (fgLabel && (!open || classifyUtteranceFamily(open).family === classifyUtteranceFamily(fgLabel).family)) {
    const fgFam = classifyUtteranceFamily(fgLabel).family;
    if (exclusiveFamilyCut(fgFam, nextFam)) {
      return 'new';
    }
    if (
      nextFam === 'flight' &&
      fgFam !== 'flight' &&
      fgFam !== 'clock'
    ) {
      return 'new';
    }
  }

  // Frischer Opener (Wetter, Hotel, „was geht“, neues Thema) schneidet,
  // bevor unknown+OpenLoop alles webt. Eis nach Kirche bleibt Weave.
  if (looksLikeFreshOpener(t) && !looksLikeFollowUpLite(t)) {
    if (open) {
      const openFam = classifyUtteranceFamily(open).family;
      const weavableKnown =
        familiesCanWeave(openFam, nextFam) &&
        nextFam !== 'unknown' &&
        nextFam !== 'knowledge';
      if (!weavableKnown) return 'new';
      if (openFam === 'pitch' && nextFam === 'pitch' && pitchKindsDiffer(open, t)) {
        return 'new';
      }
    } else if (fgLabel) {
      const fgFam = classifyUtteranceFamily(fgLabel).family;
      const weavableKnown =
        familiesCanWeave(fgFam, nextFam) &&
        nextFam !== 'unknown' &&
        nextFam !== 'knowledge';
      if (!weavableKnown) return 'new';
      if (fgFam === 'pitch' && nextFam === 'pitch' && pitchKindsDiffer(fgLabel, t)) {
        return 'new';
      }
    } else {
      return 'new';
    }
  }

  if (open && !looksLikeFollowUpLite(t)) {
    const openFam = classifyUtteranceFamily(open).family;
    if (
      nextFam === 'flight' &&
      openFam !== 'flight' &&
      openFam !== 'clock'
    ) {
      return 'new';
    }
    if (exclusiveFamilyCut(openFam, nextFam)) {
      return 'new';
    }
    const openKey = significantKey(open);
    const textKey = significantKey(t);
    const stillAboutOpen = openKey.length > 3 && textKey.includes(openKey);
    if (!stillAboutOpen) return 'weave';
  }

  if (looksLikeFollowUpLite(t)) return 'continue';

  if (closed) {
    const closedKey = significantKey(closed);
    if (closedKey.length > 3 && !significantKey(t).includes(closedKey)) {
      return 'closed_new';
    }
  }

  const fg = fgLabel;
  if (fg && looksLikeFreshOpener(t) && !significantKey(t).includes(significantKey(fg))) {
    return 'new';
  }

  if (looksLikeFreshOpener(t)) return 'new';
  return 'continue';
}

function looksLikeFreshOpener(t: string): boolean {
  if (looksLikeArriveByAppointment(t)) return true;
  return /\b(?:welche\s+filme|ins\s+kino|kino|hotel|friseur|frisör|eis|fliegen|flug|tagesplan|was\s+geht|einplanen|eintragen|wetter|party|konzert|festival|restaurant|picknick|picnic|grillen|neues\s+thema|anderes\s+thema|was\s+anderes|ganz\s+was\s+neues)\b/iu.test(
    t,
  );
}

function pitchKindsDiffer(openText: string, nextText: string): boolean {
  try {
    const { detectPitchKind } = require('../pitch/parentBrief') as {
      detectPitchKind: (s: string) => string;
    };
    const a = detectPitchKind(openText);
    const b = detectPitchKind(nextText);
    if (!a || !b || a === 'generic' || b === 'generic') return false;
    return a !== b;
  } catch {
    return false;
  }
}

function foodDishShift(openText: string, nextText: string): boolean {
  try {
    const { parseWishesFromText } = require('../pitch/parentBrief') as {
      parseWishesFromText: (s: string) => Array<{ kind?: string; text: string }>;
    };
    if (looksLikePitchRejectOrMore(nextText)) return false;
    const dishes = (s: string) =>
      parseWishesFromText(s)
        .filter((w) => w.kind === 'dish')
        .map((w) => w.text.toLowerCase())
        .sort()
        .join('|');
    const a = dishes(openText);
    const b = dishes(nextText);
    return Boolean(a && b && a !== b);
  } catch {
    return false;
  }
}

/** Ablehnung / mehr Optionen am offenen Pitch — kein Topic-Cut. */
function looksLikePitchRejectOrMore(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  return /\b(?:(?:das|die|den|es)\s+)?(?:mag\s+ich\s+nicht|gefällt\s+mir\s+nicht|gefaellt\s+mir\s+nicht|will\s+ich\s+nicht|nichts\s+für\s+mich|nicht\s+so\s+gerne|nicht\s+gerne)|(?:nee|nö|nein)(?:\s+(?:das|die|den))?(?:\s+mag\s+ich\s+nicht)?|\b(?:was\s+gibt(?:'s|s|\s+es)\s+noch|was\s+noch|andere(?:s|n)?\s+option(?:en)?|andere(?:r|s)?\s+vorschlag|neu\s*suchen|beides\s+nicht|lieber\s+was\s+anderes|etwas\s+anderes|was\s+anderes|wie\s+geht(?:'s|s|\s+es)\s+(?:denn\s+)?(?:da\s+)?weiter|kein(?:e|en)?\s+\w{3,20}\s+(?:so\s+)?gerne)\b/iu.test(
    t,
  );
}

function significantKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-zäöüß0-9]+/giu, ' ')
    .replace(
      /\b(der|die|das|und|ein|eine|zum|zur|nach|wir|ich|ist|hat|den|dem|mit|für|fuer)\b/giu,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/** Toter Thread aus Prompt/Bridge — aktueller Satz behält seine Städte. */
export function shouldScrubDeadThread(mode: TopicCutMode): boolean {
  return mode === 'new' || mode === 'closed_new';
}

export function cityTokensInText(text: string): string[] {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  const found: string[] = [];
  const re = /\b([A-ZÄÖÜ][a-zäöüß]{2,}(?:burg|stadt|haven|dam|dorf|ingen|heim|kirchen)?)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const w = m[1]!;
    if (/^(Bring|Navigier|Heute|Morgen|Bitte|Alles|Klar)$/u.test(w)) continue;
    found.push(w);
  }
  return found;
}

/**
 * Darf `token` in Bridge/Speech stehen?
 * Ja wenn im aktuellen User-Satz. Nein wenn nur im toten Thread.
 */
export function tokenAllowedInBridge(opts: {
  userText: string;
  token: string;
  topicMode: TopicCutMode;
}): boolean {
  const tok = (opts.token || '').trim();
  if (!tok) return true;
  const user = (opts.userText || '').toLowerCase();
  if (user.includes(tok.toLowerCase())) return true;
  if (shouldScrubDeadThread(opts.topicMode)) return false;
  return true;
}

export type BridgePaceKind = 'instant' | 'standard' | 'cover';

export function resolveTurnBridgePace(userText: string): {
  pace: BridgePaceKind;
  bridgeMaxWords: number;
  fastDeadlineMs: number;
} {
  const t = (userText || '').replace(/\s+/g, ' ').trim();
  // Named Trivia / Quick-Lookup: Cover + frühe Floskel (Alter recherchieren dauert).
  try {
    const { isQuickLookupQuery } = require('../../services/concierge/celestialSkyQuery') as {
      isQuickLookupQuery: (s: string) => boolean;
    };
    if (isQuickLookupQuery(t) || looksLikeNamedTriviaSubject(t)) {
      return { pace: 'cover', bridgeMaxWords: 28, fastDeadlineMs: 8000 };
    }
  } catch {
    if (looksLikeNamedTriviaSubject(t)) {
      return { pace: 'cover', bridgeMaxWords: 28, fastDeadlineMs: 8000 };
    }
  }
  if (classifyUtteranceFamily(t).family === 'knowledge' && !looksLikeFollowUpLite(t)) {
    return { pace: 'cover', bridgeMaxWords: 28, fastDeadlineMs: 8000 };
  }
  // Wetter: kurze Lookup-Bridge (nicht null) — Call 2 liefert die Fakten.
  if (
    classifyUtteranceFamily(t).family === 'weather' &&
    !looksLikeSlowResearch(t)
  ) {
    return { pace: 'instant', bridgeMaxWords: 14, fastDeadlineMs: 1200 };
  }
  if (looksLikeFollowUpLite(t) && !looksLikeSlowResearch(t)) {
    return { pace: 'instant', bridgeMaxWords: 8, fastDeadlineMs: 1500 };
  }
  if (looksLikeClockIntentLite(t) && !hasMultipleIntents(t)) {
    return { pace: 'instant', bridgeMaxWords: 8, fastDeadlineMs: 1500 };
  }
  if (looksLikeExplicitNavOrAddress(t)) {
    return { pace: 'instant', bridgeMaxWords: 8, fastDeadlineMs: 1500 };
  }
  if (looksLikeSlowResearch(t)) {
    return { pace: 'cover', bridgeMaxWords: 36, fastDeadlineMs: 8000 };
  }
  // Genannter Spiel-/Termin-Wunsch: Cover + frühe Bridge (Recherche dauert).
  try {
    const { looksLikeNamedScheduleQuery } = require('../../services/concierge/sportsScheduleQuery') as {
      looksLikeNamedScheduleQuery: (s: string) => boolean;
    };
    if (looksLikeNamedScheduleQuery(t)) {
      return { pace: 'cover', bridgeMaxWords: 28, fastDeadlineMs: 8000 };
    }
  } catch {
    /* soft */
  }
  return { pace: 'standard', bridgeMaxWords: 14, fastDeadlineMs: 1500 };
}

/** Speech webt Fakten — kein Listen-Lead. */
export function speechLooksWoven(speech: string): boolean {
  const s = (speech || '').replace(/\s+/g, ' ').trim();
  if (!s) return false;
  if (LIST_LEAD_RE.test(s)) return false;
  if (/\b(?:info\s*1|info\s*2|erstens|zweitens)\b/iu.test(s)) return false;
  return true;
}

export function stripListLead(speech: string): string {
  return (speech || '')
    .replace(/^(?:\s*)(?:info\s*\d\s*[:.–-]+\s*)+/giu, '')
    .replace(/^(?:\s*)(?:erstens|zweitens|drittens)[,:]?\s+/giu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** ~80 m/min Fuß. Puffer 5 Min. */
export function walkEtaMinFromMeters(distanceM: number): number {
  if (!Number.isFinite(distanceM) || distanceM <= 0) return 0;
  return Math.max(1, Math.round(distanceM / 80));
}

/** "heute 17:30, 20:15" → Minuten ab Mitternacht. */
export function parseClockMinutesFromLabel(whenLabel: string): number[] {
  const raw = (whenLabel || '').replace(/\s+/g, ' ');
  const out: number[] = [];
  const re = /\b(\d{1,2})[:.](\d{2})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) out.push(h * 60 + min);
  }
  return out;
}

export function isShowtimeReachable(opts: {
  whenLabel: string;
  now: Date;
  walkEtaMin: number;
  bufferMin?: number;
}): boolean {
  const clocks = parseClockMinutesFromLabel(opts.whenLabel);
  if (!clocks.length) return true;
  const buffer = opts.bufferMin ?? 5;
  const nowMin = opts.now.getHours() * 60 + opts.now.getMinutes();
  const earliest = nowMin + Math.max(0, opts.walkEtaMin) + buffer;
  return clocks.some((c) => c >= earliest);
}

export function looksLikeDietSelfId(text: string): {
  diet: 'vegetarisch' | 'vegan' | null;
} {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (/\bich\s+bin\s+vegan(?:er|erin)?\b/iu.test(t) || /\bwir\s+sind\s+vegan\b/iu.test(t)) {
    return { diet: 'vegan' };
  }
  if (
    /\bich\s+bin\s+vegetarier(?:in)?\b/iu.test(t) ||
    /\bich\s+bin\s+vegetarisch\b/iu.test(t) ||
    /\bwir\s+sind\s+vegetarier\b/iu.test(t)
  ) {
    return { diet: 'vegetarisch' };
  }
  return { diet: null };
}
