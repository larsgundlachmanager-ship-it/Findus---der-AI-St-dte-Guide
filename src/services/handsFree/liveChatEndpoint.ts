/**
 * Live-Chat Endpointing — adaptive Stable-Delay + Soft-Commit-Konstanten.
 * Stadt-/Wortlaut-agnostisch: nur Struktur (Länge, offenes Ende, Klarheit).
 */

/** Default / Standard-Utterance */
export const ENDPOINT_BASE_MS = 450;
/** Kurze klare Turns („Ja.“ / „Wetter?“) */
export const ENDPOINT_FAST_MS = 350;
/** Offenes Ende / Denkpause („und dann…“, „ähm…“) */
export const ENDPOINT_SLOW_MS = 800;
/**
 * Nach Stable: kurze Gnadenfrist — wenn User doch weiterredet, Cut abbrechen.
 * Verhindert False Cuts ohne den Base-Delay wieder auf 700 zu heben.
 */
export const SOFT_COMMIT_MS = 160;
/** Klare Satzenden: kürzere Gnadenfrist */
export const SOFT_COMMIT_CLEAR_MS = 90;
/** VAD: so lange unter Schwelle, bevor Stille „echt“ zählt */
export const MIN_VAD_SILENCE_MS = 220;
/** Nach Mic-Resume: Volume ignorieren (TTS-Nachhall / Speaker-Echo) */
export const VAD_WARMUP_MS = 450;
/** Längerer Warmup wenn Mic während TTS wieder aufgeht */
export const VAD_ECHO_WARMUP_MS = 750;

/**
 * Capture/Reisebüro: Briefing-Sätze brauchen Denk-/Lufthol-Pausen.
 * Normale Modul-2-Werte bleiben aggressiver.
 * Lange Monologe (bis ~5 Min) sind ok — Cut nur bei echter Pause, nie wegen Wortzahl.
 */
export const CAPTURE_ENDPOINT_FLOOR_MS = 1600;
export const CAPTURE_ENDPOINT_EXTRA_MS = 900;
export const CAPTURE_MIN_VAD_SILENCE_MS = 1400;
export const CAPTURE_SOFT_COMMIT_MS = 900;
/** Viele Defers: User kann Minuten reden, solange VAD Stimme sieht */
export const CAPTURE_MAX_ENDPOINT_DEFERS = 240;
/**
 * STT oft sekundenlang „stabil“ mitten im Monolog — Force nur als Totzeit-Cap,
 * und nie während VAD noch Stimme hört (siehe liveChatSession).
 * 4.5s reicht für Denkpause; längere Monologe wachsen weiter im Transcript.
 */
export const CAPTURE_STABLE_FORCE_MS = 4_500;

const OPEN_TRAIL =
  /\b(und|oder|also|ähm|ah|äh|hm+|dann|weil|dass|daß|mit|von|zu|für|nach|aber|noch|bzw|halt|mal|vielleicht|eigentlich|irgendwie|einfach|ziemlich)\s*[.,]?\s*$/iu;
/** Hängendes „so/richtig“ ohne Satzende — mit Punkt darf fertig sein */
const OPEN_TRAIL_SOFT = /\b(so|richtig)\s*$/iu;
/** STT liefert oft nur Komma mitten im Gedanken */
const TRAILING_COMMA = /,\s*$/u;
const CLEAR_END = /[?!…]\s*$/u;
const PERIOD_END = /\.\s*$/u;
const SHORT_ACK =
  /^(ja|nein|nee|nö|ok|okay|klar|danke|super|genau|richtig|passt|gut|weiter|stopp)\b/iu;
/** Frage-/Imperativ-Start ohne Satzzeichen (STT liefert oft keins). */
const CLEAR_START =
  /^(wo|was|wie|wann|wer|welch\w*|wieso|warum|gibt\s+es|kannst\s+du|kann\s+ich|zeig|zeig\s+mir|such|suche|finde|bring|f[uü]hr|navigier|geh|lauf|start|stopp|erz[aä]hl|erkl[aä]r|sag|mach|hilf|check|pr[uü]f)\b/iu;
/** Kurze Uhrzeit-Antworten auf Rückfragen („20:10“, „um 20 Uhr“). */
const BARE_CLOCK_RE =
  /^(?:um\s+|gegen\s+)?\d{1,2}(?:[:.]\d{2})?\s*(?:uhr)?\.?$/iu;
/**
 * Kurze Slot-Antworten auf Concierge-/Flug-Rückfragen
 * („Handgepäck“, „Aufgabegepäck“, „ÖPNV“, „Taxi“, „heute“).
 */
const SHORT_SLOT_ANSWER_RE =
  /^(?:(?:nur\s+)?handgep[äa]ck|(?:mit\s+)?aufgabegep[äa]ck|(?:mit\s+)?koffer|cabin\s*bag|checked\s*bag|öpnv|oepnv|taxi|uber|transfer|heute|morgen|mehr\s+puffer|weniger\s+puffer|puffer\s+passt(?:\s+so)?)\.?$/iu;

/**
 * Unvollständige Trivia-/Alter-Frames („Wie alt ist“, „Wie alt ist der“) —
 * STT holt Subjekt noch nach; nicht als fertig endpointen.
 */
const INCOMPLETE_TRIVIA_FRAME_RE =
  /^(?:wie|was|wer)\s+(?:alt|groß|gross|hoch|schwer|lang|breit|tief|weit|teuer)\s+(?:ist|sind|war|waren)(?:\s+(?:der|die|das|den|dem|ein|eine|einer|eines))?\s*[.,]?\s*$/iu;
/** Hängender Artikel / Präposition ohne Subjekt am Ende */
const TRAILING_ARTICLE_RE =
  /\b(?:der|die|das|den|dem|des|ein|eine|einer|eines|einem|einen|vom|zum|zur|im|am|beim)\s*[.,]?\s*$/iu;

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Noch kein Subjekt — Cut würde Klarfragen wie „Wie alt ist wer?“ auslösen. */
export function looksLikeIncompleteTriviaFrame(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (INCOMPLETE_TRIVIA_FRAME_RE.test(t)) return true;
  if (
    /^(?:wie|was)\s+(?:alt|groß|gross|hoch|schwer)\b/iu.test(t) &&
    TRAILING_ARTICLE_RE.test(t) &&
    wordCount(t) <= 6
  ) {
    return true;
  }
  return false;
}

/** Adaptive Stable-Zeit bis Soft-Commit / Cut. */
export function computeEndpointDelayMs(text: string): number {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return ENDPOINT_BASE_MS;
  const words = wordCount(t);

  if (looksLikeIncompleteTriviaFrame(t)) return ENDPOINT_SLOW_MS;
  if (OPEN_TRAIL.test(t) || OPEN_TRAIL_SOFT.test(t) || TRAILING_COMMA.test(t)) {
    return ENDPOINT_SLOW_MS;
  }

  if (words <= 4 && (CLEAR_END.test(t) || SHORT_ACK.test(t))) {
    return ENDPOINT_FAST_MS;
  }
  if (SHORT_SLOT_ANSWER_RE.test(t) || BARE_CLOCK_RE.test(t)) {
    return ENDPOINT_FAST_MS;
  }
  if (words <= 8 && CLEAR_END.test(t)) return ENDPOINT_FAST_MS;
  if (words >= 6 && PERIOD_END.test(t) && !OPEN_TRAIL.test(t)) {
    return ENDPOINT_FAST_MS;
  }
  // Unpunktierte Fragen/Befehle: nicht auf Lärm-VAD warten
  if (words >= 3 && CLEAR_START.test(t)) return ENDPOINT_FAST_MS;
  if (words >= 6 && !OPEN_TRAIL.test(t)) return ENDPOINT_FAST_MS;

  // Lange Monologe: etwas Geduld, aber nicht zurück auf 700+
  if (words >= 20) return Math.min(ENDPOINT_SLOW_MS, ENDPOINT_BASE_MS + 120);

  return ENDPOINT_BASE_MS;
}

/**
 * User ist klar fertig → VAD-Stille-Wait überspringen (sonst hängt Cut bei Lärm).
 * Offenes Ende („und…“) nie forcen.
 * STT liefert oft kein ?/. → Struktur reicht (Fragewort, Imperativ, genug Wörter).
 */
export function looksLikeFinishedUtterance(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t || t.length < 2) return false;
  if (OPEN_TRAIL.test(t) || OPEN_TRAIL_SOFT.test(t) || TRAILING_COMMA.test(t)) return false;
  if (looksLikeIncompleteTriviaFrame(t)) return false;
  if (CLEAR_END.test(t)) return true;
  if (SHORT_ACK.test(t) && wordCount(t) <= 4) return true;
  if (BARE_CLOCK_RE.test(t)) return true;
  if (SHORT_SLOT_ANSWER_RE.test(t)) return true;
  if (PERIOD_END.test(t) && wordCount(t) >= 4) return true;
  const words = wordCount(t);
  // Unpunktierte, aber klare Turns (häufigster STT-Fall)
  if (words >= 3 && CLEAR_START.test(t)) return true;
  if (words >= 6) return true;
  if (words >= 4 && /\b(bitte|danke|heute|jetzt|hier|in\s+der\s+n[aä]he)\b/iu.test(t)) {
    return true;
  }
  return false;
}

/**
 * Capture/Reisebüro: nur echtes Satzende — nicht „ab 6 Wörtern fertig“.
 * Kurze Acks / ?!… / klarer Punkt; sonst auf echte Pause warten.
 */
export function looksLikeClearSentenceEnd(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t || t.length < 2) return false;
  if (OPEN_TRAIL.test(t) || OPEN_TRAIL_SOFT.test(t) || TRAILING_COMMA.test(t)) return false;
  if (looksLikeIncompleteTriviaFrame(t)) return false;
  if (CLEAR_END.test(t)) return true;
  if (SHORT_ACK.test(t) && wordCount(t) <= 4) return true;
  if (BARE_CLOCK_RE.test(t) || SHORT_SLOT_ANSWER_RE.test(t)) return true;
  if (PERIOD_END.test(t) && wordCount(t) >= 3) return true;
  return false;
}

export function softCommitMsForText(text: string): number {
  return looksLikeFinishedUtterance(text) ? SOFT_COMMIT_CLEAR_MS : SOFT_COMMIT_MS;
}
