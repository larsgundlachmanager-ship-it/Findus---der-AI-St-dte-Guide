/**
 * Piper-kompatible deutsche TTS-Prosodie (regelbasiert, ohne Latenz).
 * Piper ist satzzeichen-sensitiv: Punkt/Komma/! /… /– steuern Pausen & Emotion.
 */

/** Gesprochene Kontraktionen für flüssigeren Redefluss. */
const SPOKEN_CONTRACTIONS: [RegExp, string][] = [
  [/\bhaben\s+(wir|ihr|sie|Wir|Ihr|Sie)\b/g, "hab'n $1"],
  [/\b([Hh]at)\s+(er|sie|es)\b/g, "$1 $2"],
  [/\b([Ii]st)\s+es\b/g, "is'es"],
  [/\b([Ww]ar)\s+es\b/g, "war's"],
  [/\b([Ww]ird)\s+es\b/g, "wird's"],
  [/\b([Gg]ibt)\s+es\b/g, "gibt's"],
  [/\b([Mm]achen)\s+wir\b/g, "mach'n wir"],
  [/\b([Gg]ehen)\s+wir\b/g, "geh'n wir"],
  [/\b([Ss]ehen)\s+wir\b/g, "seh'n wir"],
  [/\b([Ee]in)\s+ein\b/g, "ein'n"],
  [/\b([Ee]inen)\s+([A-ZÄÖÜ])/g, "ein'n $2"],
];

/** LLM-Prosodie-Marker → Piper-Interpunktion. */
const LLM_MARKER_REPLACEMENTS: [RegExp, string][] = [
  [/\[Pause:\s*800\s*ms\]/gi, '. '],
  [/\[Pause:\s*500\s*ms\]/gi, '. '],
  [/\[Pause:\s*300\s*ms\]/gi, ', '],
  [/\[Pause:\s*250\s*ms\]/gi, '. '],
  [/\[Pause:\s*200\s*ms\]/gi, ', '],
  [/\[ʔ\]/g, ''],
  [/[↓↑→↗↘]/g, ''],
  [/\*{2,}([^*]+)\*{2,}/g, '$1'],
];

const FOCUS_CONTENT_VERBS =
  'erkl[aä]ren|zeigen|sagen|wissen|verstehen|beschreiben|erz[aä]hlen|merken|sehen|h[oö]ren|lernen|sp[uü]ren|f[uü]hlen|verdeutlichen|klarstellen|darlegen';

const FOCUS_W_WORDS =
  'wie|was|warum|wieso|weshalb|wo|wodurch|worauf|wobei|woran|wozu|woher|wohin|welche[rnms]?|welches';

const EMOTION_ENDINGS =
  'Wahnsinn|Unglaublich|Krass|Hammer|Genial|Absolut|Genau jetzt|Los|Komm|Safe|Peak|Abenteuer|Geheimnis|Jetzt';

function titleCaseFocus(word: string): string {
  if (!word) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** Kontrastive Fokusbetonung: Fokuswort als Satzanfang. */
export function applyContrastiveFocusStress(text: string): string {
  let s = text;

  s = s.replace(
    /,\s*(WIE|WAS|WARUM|WIESO|WESHALB|WO|WODURCH|WORAUF|WOBEI|WORAN|WOZU|WOHER|WOHIN|WELCHER|WELCHE|WELCHES|WELCHEN|WELCHEM)\b/g,
    (_m, focus: string) => `. ${titleCaseFocus(focus)}`,
  );

  s = s.replace(
    new RegExp(
      `\\b(${FOCUS_CONTENT_VERBS})\\s*,\\s*(${FOCUS_W_WORDS})\\b`,
      'gi',
    ),
    (_m, verb: string, focus: string) =>
      `${verb}. ${titleCaseFocus(focus)}`,
  );

  s = s.replace(
    /\b(wei[sß]|zeigt|sagt|erkl[aä]rt|merkt|sieht|h[oö]rt|lernt|sp[uü]rt|f[uü]hlt)\s*,\s*(wie|was|warum|wieso|weshalb|wo)\b/gi,
    (_m, verb: string, focus: string) =>
      `${verb}. ${titleCaseFocus(focus)}`,
  );

  s = s.replace(
    new RegExp(`\\bsondern\\s+(${FOCUS_W_WORDS})\\b`, 'gi'),
    (_m, focus: string) => `sondern. ${titleCaseFocus(focus)}`,
  );

  return s;
}

/** Aufzählungen: Komma → Punkt für klare Pausen. */
export function applyEnumerationRhythm(text: string): string {
  let s = text;

  s = s.replace(
    /((?:\b[\p{L}][\p{L}'-]*(?:\s+[\p{L}][\p{L}'-]*)*)(?:,\s+(?:\b[\p{L}][\p{L}'-]*(?:\s+[\p{L}][\p{L}'-]*)*)){1,})\s+(und|oder)\s+(\b[\p{L}][\p{L}'-]*(?:\s+[\p{L}][\p{L}'-]*)*)/giu,
    (_match, listPart: string, conj: string, lastItem: string) => {
      const items = listPart.split(/,\s*/).filter(Boolean);
      if (items.length < 2) return _match;
      return `${items.join('. ')} ${conj} ${lastItem}`;
    },
  );

  s = s.replace(
    /\b([\p{L}][\p{L}'-]*(?:\s+[\p{L}][\p{L}'-]*)*),\s+([\p{L}][\p{L}'-]*(?:\s+[\p{L}][\p{L}'-]*)*),\s+([\p{L}][\p{L}'-]*(?:\s+[\p{L}][\p{L}'-]*)*)\b/giu,
    (_match, a: string, b: string, c: string) => `${a}. ${b}. ${c}`,
  );

  return s;
}

export function applySpokenContractions(text: string): string {
  let s = text;
  for (const [pattern, replacement] of SPOKEN_CONTRACTIONS) {
    s = s.replace(pattern, replacement);
  }
  return s;
}

export function stripLlmProsodyMarkers(text: string): string {
  let s = text;
  for (const [pattern, replacement] of LLM_MARKER_REPLACEMENTS) {
    s = s.replace(pattern, replacement);
  }
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Satzzeichen-Spacing für Piper — Komma/Punkt/! klar,
 * damit Pausen und Betonung greifen.
 */
export function applyPunctuationSpacing(text: string): string {
  let s = text.normalize('NFKC');

  s = s.replace(/!{3,}/g, '!!');
  s = s.replace(/\?{3,}/g, '??');
  s = s.replace(/,{2,}/g, ',');
  // Ellipsen schützen, bevor Mehrfach-Punkte kollabiert werden
  s = s.replace(/\.{3,}/g, '…');
  s = s.replace(/(\s*\.\s*){2,}/g, '. ');
  s = s.replace(/…/g, '...');

  s = s.replace(/\s*,\s*/g, ', ');
  s = s.replace(/\s*:\s*/g, ': ');
  // ASCII-Bindestrich als Gedankenstrich (langer Strich mit Leerzeichen)
  s = s.replace(/\s+-\s+/g, ' – ');
  s = s.replace(/\s+([.!?])/g, '$1');
  s = s.replace(/([.!?])(?=\p{L})/gu, '$1 ');
  s = s.replace(/([.!?])\s+/g, '$1 ');

  // Gedankenstrich = Atem-Pause
  s = s.replace(/\s*[–—]\s*/g, ' – ');
  // Doppelpunkt klar trennen (Pause kommt per PCM-Split)
  s = s.replace(/:(?=\S)/g, ': ');
  // Doppelte Gedankenstriche bereinigen
  s = s.replace(/(?:\s*–\s*){2,}/g, ' – ');

  // Lange Klauseln ohne Komma: vor Konjunktionen trennen
  s = s.replace(
    /([^\s,.!?;:–—]{12,}?)\s+(und|aber|denn|weil|obwohl|während|doch)\s+/giu,
    (full, left: string, conj: string) => {
      if (/[,;–—]$/.test(left)) return full;
      return `${left}, ${conj} `;
    },
  );

  return s.replace(/\s+/g, ' ').trim();
}

/** Emotion/Betonung: Impulswörter mit !. */
export function applyEmotionalEmphasis(text: string): string {
  let s = text;

  s = s.replace(
    new RegExp(`\\b(${EMOTION_ENDINGS})\\s*\\.`, 'gi'),
    (_m, w: string) => `${w}!`,
  );

  s = s.replace(
    /\b(das ist|das war|hier ist)\s+(unglaublich|wahnsinn|krass|genial)\b\s*\./gi,
    (_m, lead: string, adj: string) => `${lead} ${adj}!`,
  );

  s = s.replace(/\bGenau jetzt\s*\./gi, 'Genau jetzt!');
  s = s.replace(/!{3,}/g, '!!');

  return s;
}

/**
 * Spannung / Cliffhanger — kurze Atemzüge vor Enthüllung
 * (nur Audio-Prosodie-Stufe, nicht Textgen).
 */
export function applySuspenseTension(text: string): string {
  let s = text;

  // Zuerst spezifische Phrasen, dann generische „Und dann –“
  s = s.replace(/\b(ganz plötzlich)\b/gi, '– ganz plötzlich –');
  s = s.replace(/\b(Rate mal)\b\s*[,.]?\s*/gi, 'Rate mal – ');
  s = s.replace(/\b(Warte ab)\b\s*[,.]?\s*/gi, 'Warte ab – ');
  s = s.replace(/\b(Stell dir vor)\b\s*[,.]?\s*/gi, 'Stell dir vor – ');
  s = s.replace(/\b(Und weißt du was)\b\s*[,.]?\s*/gi, 'Und weißt du was – ');
  s = s.replace(/\b(Aber Vorsicht)\b\s*[,.]?\s*/gi, 'Aber Vorsicht – ');

  s = s.replace(/\b(Und dann)\s+(?!–)/gi, '$1 – ');
  s = s.replace(/\b(Doch dann)\s+(?!–)/gi, '$1 – ');
  s = s.replace(/\b(Plötzlich)\s+(?!–)/gi, '$1 – ');

  // Doppelte Gedankenstriche bereinigen
  s = s.replace(/(?:–\s*){2,}/g, '– ');

  return s;
}

export function applyGreetingPauses(text: string): string {
  let s = text;

  s = s.replace(
    /\b(Moin|Hi|Hallo|Hey|Servus)\b\s*[,.]?\s+(?=\p{L})/giu,
    (_m, g: string) =>
      `${g.charAt(0).toUpperCase()}${g.slice(1).toLowerCase()}! `,
  );

  s = s.replace(/\bYo,\s*was geht\s*[!.]?\s*/gi, 'Yo, was geht! ');
  s = s.replace(/\bYo\s+was geht\s*[!.]?\s*/gi, 'Yo, was geht! ');

  s = s.replace(/\b(Schön,\s+dass du da bist)\./gi, '$1!');
  s = s.replace(/\b(Willkommen am Start)\./gi, '$1!');
  s = s.replace(
    /\b(Ich freue mich riesig, dich zu begleiten)\./gi,
    '$1!',
  );
  s = s.replace(/\b(Und mach dich bereit)\./gi, '$1!');

  s = applyNarratorFinale(s);
  return s;
}

export function applyNarratorFinale(text: string): string {
  return text.replace(
    /\b(Leg(?:t)?\s+die\s+Kopfhörer\s+(?:auf|an))\s*[,.:;–—-]?\s*(deine)\s+(Geschichte)\s+(beginnt)\s*,?\s*(genau\s+jetzt)\s*[!.]?/gi,
    (_m, leg: string, _deine: string, gesch: string, beginnt: string) =>
      `${String(leg).replace(/\s+/g, ' ').trim()}. Deine ${gesch} ${beginnt}. Genau jetzt!`,
  );
}

export function isGreetingOrWelcomeSentence(sentence: string): boolean {
  const s = sentence.replace(/\s+/g, ' ').trim();
  if (!s) return false;
  if (/^(Moin|Hi|Hallo|Hey|Servus|Yo)[!.,]*$/i.test(s)) return true;
  if (
    s.length <= 56 &&
    /^(Moin|Hi|Hallo|Hey|Servus|Yo(?:[\s,]+was geht)?|Na(?:,?\s+mein Lieber)?|Tritt näher|Willkommen)\b/i.test(
      s,
    )
  ) {
    return true;
  }
  if (
    s.length <= 90 &&
    /schön,\s+dass du da bist|freue mich riesig|willkommen am start|mach dich bereit|herzlich willkommen|kopfhörer\s+(?:auf|an)|auf\s+lager|mein\s+lieber/i.test(
      s,
    )
  ) {
    return true;
  }
  if (/!$/.test(s) && s.length <= 48) return true;
  return false;
}

/** Satzende-Pause (ms). */
export const SENTENCE_END_PAUSE_MS = 320;
/** Begrüßung / Ausruf (ms). */
export const GREETING_PAUSE_MS = 520;
/** Komma-Klausel (ms) — etwas länger, damit Kokoro nicht durchrauscht. */
export const COMMA_PAUSE_MS = 200;
/** Doppelpunkt (ms) — Aufzählung / Ansage. */
export const COLON_PAUSE_MS = 260;
/** Gedankenstrich / langer Strich (ms). */
export const DASH_PAUSE_MS = 280;

export function sentenceEndPauseMs(
  sentence: string,
  _voiceId?: string | null,
): number {
  const s = sentence.replace(/\s+/g, ' ').trim();
  if (!s) return SENTENCE_END_PAUSE_MS;
  if (isGreetingOrWelcomeSentence(s)) return GREETING_PAUSE_MS;
  if (/!$/.test(s)) return Math.max(SENTENCE_END_PAUSE_MS, 380);
  if (/\?$/.test(s)) return Math.max(SENTENCE_END_PAUSE_MS, 300);
  return SENTENCE_END_PAUSE_MS;
}

/** @deprecated */
export const GEN_Z_PAUSE_MS = SENTENCE_END_PAUSE_MS;

export function applyGenZRunOnProsody(text: string): string {
  return applyPunctuationSpacing(text);
}

/** Vollständige Prosodie-Pipeline für Piper-Audio (nach Aussprache-Fixes). */
export function applyGermanTtsProsodyRules(text: string): string {
  let s = text.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!s) return s;

  s = stripLlmProsodyMarkers(s);
  s = applyGreetingPauses(s);
  s = applyContrastiveFocusStress(s);
  s = applyEnumerationRhythm(s);
  s = applySuspenseTension(s);
  s = applyEmotionalEmphasis(s);
  s = applySpokenContractions(s);
  s = applyPunctuationSpacing(s);

  return s.replace(/\s+/g, ' ').trim();
}

export function applyPiperProsody(text: string): string {
  return applyGermanTtsProsodyRules(text);
}
