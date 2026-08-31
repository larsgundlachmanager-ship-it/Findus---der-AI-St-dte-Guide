/**
 * Anti-Nightlife-Guard + Fakten-Vorcheck (kein Antwort-Spezialpfad).
 *
 * isCelestialOrSkyQuery: nur damit „Sonnenfinsternis / Sternschnuppen“
 * NICHT als Party-/Events-Kalender landet. Keine Erinnerungs-/Prompt-Sonderlogik.
 *
 * isCrystalClearFactVorcheck: Manager-LLM nur bei glasklaren Kurzfragen skippen
 * (Mark Forster Alter, Einwohner …) — nicht wegen Himmel-Wörtern.
 */

const ANTI_NIGHTLIFE_SKY_RE =
  /\b(sonnenfinsternis|mondfinsternis|teil(?:weise)?e?\s+sonnenfinsternis|eclipse|sternschnuppe(?:n)?|sternstunde(?:n)?|stern\s*schau|meteor(?:iten)?(?:schauer)?|perseiden|leoniden|geminiden|quadrantiden|lyriden|eta[-\s]?aquariiden|nordlicht|polarlicht|aurora(?:\s+borealis)?|vollmond|supermond|blutmond|planetenparade|komet(?:en)?|milchstraße|milchstrasse|iss\s+(?:sichtbar|überflug|ueberflug)|satelliten[-\s]?(?:überflug|ueberflug))\b/iu;

/** Trivia-Maße/Identität/Bedeutung. „wo ist [Ort]“ ist KEIN Quick-Lookup. */
const QUICK_LOOKUP_RE =
  /\b(wie\s+(?:breit|hoch|alt|tief|groß|gross|viel|viele|heiß|heiss|kalt)|was\s+bedeutet|wer\s+(?:ist|war)|erkläre?\s+(?:mir\s+)?kurz|wann\s+(?:ist|war|sind|wird)\s+(?:die\s+|der\s+|das\s+)?(?:sonnenfinsternis|mondfinsternis|teil(?:weise)?e?\s+sonnenfinsternis|eclipse|sternschnuppe(?:n)?|nordlicht|polarlicht|meteor))\b/iu;

const ARITH_LOOKUP_RE =
  /\d+\s*(?:\+|plus|minus|-|–|×|x|\*|\/|:)\s*\d+/iu;

const NOT_CRYSTAL_CLEAR_RE =
  /\b(navigier|führ\s+mich|fuehr\s+mich|bring\s+mich|route\s+zu|plane\s+mir|tagesplan|restaurant|essen\s+geh|reservier|speisekarte|und\s+dann|außerdem|ausserdem|oder\s+auch|modul|historie|mehr\s+dazu|strand|baden|hingehen|party|feiern|locations?|verbindung|fähre|faehre|museum|café|cafe|toilette|apotheke|wie\s+weit|wie\s+teuer|öffnungs)\b/iu;

const VORCHECK_MAX_WORDS = 16;

/** Nur Anti-Events: diese Wörter ≠ Nightlife-Kalender. */
export function isCelestialOrSkyQuery(text: string): boolean {
  return ANTI_NIGHTLIFE_SKY_RE.test(text.replace(/\s+/g, ' ').trim());
}

export function isQuickLookupQuery(text: string): boolean {
  let t = text.replace(/\s+/g, ' ').trim();
  if (!t || t.length < 4) return false;
  try {
    const { stripSoftLiveChatVocative } = require('../handsFree/liveChatAddress') as {
      stripSoftLiveChatVocative: (s: string) => string;
    };
    t = stripSoftLiveChatVocative(t) || t;
  } catch {
    /* soft */
  }
  try {
    const { shouldForbidQuickChat } = require('../../module2/router/placeGoQuery') as {
      shouldForbidQuickChat: (s: string) => boolean;
    };
    if (shouldForbidQuickChat(t)) return false;
  } catch {
    /* soft */
  }
  if (NOT_CRYSTAL_CLEAR_RE.test(t)) return false;
  if (ARITH_LOOKUP_RE.test(t)) return t.split(/\s+/).length <= 28;
  if (!QUICK_LOOKUP_RE.test(t)) return false;
  return t.split(/\s+/).length <= 28;
}

/**
 * Vorcheck Manager-Skip — glasklare Kurzfragen, unabhängig von Himmel-Wörtern.
 */
export function isCrystalClearFactVorcheck(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t || t.length < 6) return false;
  try {
    const { shouldForbidQuickChat } = require('../../module2/router/placeGoQuery') as {
      shouldForbidQuickChat: (s: string) => boolean;
    };
    if (shouldForbidQuickChat(t)) return false;
  } catch {
    /* soft */
  }
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > VORCHECK_MAX_WORDS) return false;
  if (NOT_CRYSTAL_CLEAR_RE.test(t)) return false;
  if ((t.match(/\?/g) || []).length >= 2) return false;
  if (/\bund\b.+\bund\b/iu.test(t)) return false;
  if (!QUICK_LOOKUP_RE.test(t)) return false;
  return true;
}
